import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RoomStatus } from '@prisma/client';
import { EventsGateway } from '../events/events.gateway.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Boarding Service
 *
 * Implements the "定时发车" (scheduled departure) cold-start strategy.
 * Users join a BOARDING room's waitlist. When the room reaches its min_users
 * threshold OR the scheduled departure time arrives, the room transitions
 * to RUNNING status and the 30-day countdown begins.
 */

export interface JoinBoardingDto {
  userId: string;
  roomId: string;
}

export interface BoardingStatus {
  roomId: string;
  status: RoomStatus;
  currentCount: number;
  minUsers: number;
  maxUsers: number;
  scheduledAt: string | null;
  estimatedWaitMessage: string;
}

@Injectable()
export class BoardingService {
  private readonly logger = new Logger(BoardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * Get the next available BOARDING room, or create one if none exists.
   */
  async getOrCreateBoardingRoom(): Promise<BoardingStatus> {
    let room = await this.prisma.instanceRoom.findFirst({
      where: { status: RoomStatus.BOARDING },
      orderBy: { created_at: 'desc' },
    });

    if (!room) {
      // Create a new boarding room with scheduled departure
      const now = new Date();
      // Schedule departure for next Friday 20:00 CST
      const scheduledAt = this.getNextFridayEvening(now);
      const startDate = scheduledAt; // Room starts when it departs
      const endDate = new Date(scheduledAt.getTime() + 30 * 24 * 60 * 60 * 1000);

      room = await this.prisma.instanceRoom.create({
        data: {
          status: RoomStatus.BOARDING,
          min_users: 50,
          max_users: 100,
          start_date: startDate,
          end_date: endDate,
          scheduled_at: scheduledAt,
          boarding_count: 0,
        },
      });
    }

    return this.formatBoardingStatus(room);
  }

  /**
   * User joins the boarding queue for a room.
   */
  async joinBoarding(dto: JoinBoardingDto): Promise<BoardingStatus> {
    const room = await this.prisma.instanceRoom.findUnique({
      where: { id: dto.roomId },
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }
    if (room.status !== RoomStatus.BOARDING) {
      throw new ConflictException('Room is no longer in BOARDING status');
    }
    if (room.boarding_count >= room.max_users) {
      throw new ConflictException('Room is full');
    }

    const updated = await this.prisma.instanceRoom.update({
      where: { id: dto.roomId },
      data: { boarding_count: { increment: 1 } },
    });

    // Emit boarding update
    this.eventsGateway.emitBoardingUpdate(dto.roomId, {
      roomId: dto.roomId,
      currentCount: updated.boarding_count,
      minUsers: updated.min_users,
      maxUsers: updated.max_users,
    });

    // Check if we should auto-depart (reached min_users)
    if (updated.boarding_count >= updated.min_users) {
      this.logger.log(`Room ${dto.roomId} reached min_users (${updated.min_users}), ready for departure`);
    }

    return this.formatBoardingStatus(updated);
  }

  /**
   * Depart a BOARDING room: transition to RUNNING.
   * Called by Chronos at scheduled time, or when min_users is reached.
   */
  async departRoom(roomId: string): Promise<void> {
    const room = await this.prisma.instanceRoom.findUnique({
      where: { id: roomId },
    });

    if (!room || room.status !== RoomStatus.BOARDING) {
      return;
    }

    if (room.boarding_count < 2) {
      this.logger.warn(`Room ${roomId} has fewer than 2 users, postponing departure`);
      return;
    }

    const now = new Date();
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.instanceRoom.update({
      where: { id: roomId },
      data: {
        status: RoomStatus.RUNNING,
        start_date: now,
        end_date: endDate,
      },
    });

    this.eventsGateway.emitRoomDeparted(roomId, {
      roomId,
      departedAt: now.toISOString(),
      userCount: room.boarding_count,
    });

    this.logger.log(`Room ${roomId} departed with ${room.boarding_count} users`);
  }

  /**
   * Check all BOARDING rooms and depart those that have reached their scheduled time.
   * Called by Chronos cron job.
   */
  async checkAndDepartScheduledRooms(): Promise<void> {
    const now = new Date();
    const readyRooms = await this.prisma.instanceRoom.findMany({
      where: {
        status: RoomStatus.BOARDING,
        scheduled_at: { lte: now },
      },
    });

    for (const room of readyRooms) {
      await this.departRoom(room.id);
    }
  }

  private getNextFridayEvening(from: Date): Date {
    const result = new Date(from);
    // Set to next Friday
    const dayOfWeek = result.getDay();
    const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
    result.setDate(result.getDate() + daysUntilFriday);
    // Set to 20:00 CST (UTC+8)
    result.setUTCHours(12, 0, 0, 0); // 20:00 CST = 12:00 UTC
    return result;
  }

  private formatBoardingStatus(room: any): BoardingStatus {
    const remaining = room.min_users - room.boarding_count;
    let estimatedWaitMessage: string;

    if (remaining > 0) {
      estimatedWaitMessage = `还需 ${remaining} 人即可发车`;
    } else {
      estimatedWaitMessage = '即将发车，请等待...';
    }

    if (room.scheduled_at) {
      const scheduledDate = new Date(room.scheduled_at);
      const now = new Date();
      const hoursUntil = Math.max(0, Math.ceil((scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60)));
      if (hoursUntil > 0 && remaining > 0) {
        estimatedWaitMessage += ` · 最迟 ${hoursUntil} 小时后发车`;
      }
    }

    return {
      roomId: room.id,
      status: room.status,
      currentCount: room.boarding_count,
      minUsers: room.min_users,
      maxUsers: room.max_users,
      scheduledAt: room.scheduled_at?.toISOString() ?? null,
      estimatedWaitMessage,
    };
  }
}
