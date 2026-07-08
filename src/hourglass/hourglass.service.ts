import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConnectionStatus } from '@prisma/client';
import { EventsGateway } from '../events/events.gateway.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface UseFreezeDto {
  userId: string;
  connectionId: string;
}

export interface FreezeStatus {
  userId: string;
  connectionId: string;
  freezeRemaining: number;
  frozenToday: boolean;
  partnerNotified: boolean;
}

@Injectable()
export class HourglassService {
  private readonly logger = new Logger(HourglassService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * Use one hourglass freeze for the current day.
   * Prevents the sandglass from destroying the connection if the user is absent.
   *
   * Constraints:
   * - Max 2 freezes per season per user
   * - Cannot accumulate across seasons
   * - Partner is notified transparently
   * - DailyEcho still pushes but non-response won't freeze progress
   */
  async useFreeze(dto: UseFreezeDto): Promise<FreezeStatus> {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.freeze_remaining <= 0) {
      throw new BadRequestException('No hourglass freezes remaining this season');
    }

    const connection = await this.prisma.connection.findUnique({
      where: { id: dto.connectionId },
    });
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.status !== ConnectionStatus.SANDGLASS_24H && connection.status !== ConnectionStatus.DEEP_LINK) {
      throw new BadRequestException('Connection is not in a freezable state');
    }

    const isUserA = connection.user_a_id === dto.userId;
    const isUserB = connection.user_b_id === dto.userId;
    if (!isUserA && !isUserB) {
      throw new BadRequestException('User is not part of this connection');
    }

    // Check if already frozen today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existingFreeze = await this.prisma.hourglassFreeze.findFirst({
      where: {
        user_id: dto.userId,
        connection_id: dto.connectionId,
        created_at: { gte: today },
      },
    });

    if (existingFreeze) {
      throw new BadRequestException('Already used a freeze today');
    }

    // Create freeze record and decrement remaining
    const [freeze, updatedUser] = await this.prisma.$transaction([
      this.prisma.hourglassFreeze.create({
        data: {
          user_id: dto.userId,
          connection_id: dto.connectionId,
          used_on_day: connection.connected_days,
          season: connection.season,
        },
      }),
      this.prisma.user.update({
        where: { id: dto.userId },
        data: { freeze_remaining: { decrement: 1 } },
      }),
    ]);

    // Notify partner
    const partnerId = isUserA ? connection.user_b_id : connection.user_a_id;
    this.eventsGateway.emitHourglassFrozen(connection.room_id, {
      connectionId: dto.connectionId,
      frozenByUserId: dto.userId,
      partnerId,
      dayNumber: connection.connected_days,
      freezeRemaining: updatedUser.freeze_remaining,
    });

    this.logger.log(`User ${dto.userId} used hourglass freeze on day ${connection.connected_days}`);

    return {
      userId: dto.userId,
      connectionId: dto.connectionId,
      freezeRemaining: updatedUser.freeze_remaining,
      frozenToday: true,
      partnerNotified: true,
    };
  }

  /**
   * Check if a connection has an active freeze for today.
   * Used by Chronos before destroying sandglass connections.
   */
  async isConnectionFrozenToday(connectionId: string): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const freeze = await this.prisma.hourglassFreeze.findFirst({
      where: {
        connection_id: connectionId,
        created_at: { gte: today },
      },
    });
    return freeze !== null;
  }

  /**
   * Get freeze status for a user in a connection.
   */
  async getFreezeStatus(userId: string, connectionId: string): Promise<FreezeStatus> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayFreeze = await this.prisma.hourglassFreeze.findFirst({
      where: {
        user_id: userId,
        connection_id: connectionId,
        created_at: { gte: today },
      },
    });

    return {
      userId,
      connectionId,
      freezeRemaining: user.freeze_remaining,
      frozenToday: todayFreeze !== null,
      partnerNotified: todayFreeze !== null,
    };
  }
}
