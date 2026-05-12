import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Connection, ConnectionStatus, Prisma, RoomStatus, UserRole } from '@prisma/client';
import { EventsGateway } from '../events/events.gateway.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const ONE_DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

@Injectable()
export class ChronosService {
  private readonly logger = new Logger(ChronosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  @Cron('*/1 * * * *')
  async shatterExpiredSandglassConnections(): Promise<void> {
    const cutoff = new Date(Date.now() - ONE_DAY_MILLISECONDS);
    const expiredConnections = await this.prisma.connection.findMany({
      where: {
        status: ConnectionStatus.SANDGLASS_24H,
        sandglass_started_at: { lte: cutoff },
        destroyed_at: null,
      },
      take: 500,
      orderBy: { sandglass_started_at: 'asc' },
    });

    for (const connection of expiredConnections) {
      const destroyed = await this.destroySandglassConnection(connection.id);
      if (destroyed) {
        this.eventsGateway.emitConnectionShattered(destroyed.room_id, {
          connectionId: destroyed.id,
          roomId: destroyed.room_id,
          userAId: destroyed.user_a_id,
          userBId: destroyed.user_b_id,
          destroyedAt: destroyed.destroyed_at?.toISOString() ?? null,
          reason: 'SANDGLASS_24H_EXPIRED',
        });
      }
    }
  }

  @Cron('0 0 * * *', { timeZone: 'Asia/Shanghai' })
  async advanceDeepLinkDaysAndCollapseDayFifteen(): Promise<void> {
    await this.prisma.connection.updateMany({
      where: {
        status: ConnectionStatus.DEEP_LINK,
        connected_days: { lt: 30 },
        destroyed_at: null,
      },
      data: {
        connected_days: { increment: 1 },
      },
    });

    const dayFifteenRooms = await this.prisma.instanceRoom.findMany({
      where: {
        status: RoomStatus.RUNNING,
        start_date: { lte: new Date(Date.now() - 15 * ONE_DAY_MILLISECONDS) },
        end_date: { gt: new Date() },
      },
      select: { id: true },
    });

    for (const room of dayFifteenRooms) {
      const collapsedUserIds = await this.collapseUnlinkedUsersToWatchers(room.id);
      if (collapsedUserIds.length > 0) {
        this.eventsGateway.emitRoleCollapsed(room.id, {
          roomId: room.id,
          role: UserRole.WATCHER,
          userIds: collapsedUserIds,
          collapsedAt: new Date().toISOString(),
        });
      }
    }
  }

  @Cron('0 8,20 * * *', { timeZone: 'Asia/Shanghai' })
  async switchChatMode(): Promise<void> {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: 'Asia/Shanghai',
      }).format(new Date()),
    );
    const mode = hour === 8 ? 'ICE' : 'FIRE';
    const redis = this.redisService.getClient();
    await redis.set('CHAT_MODE', mode);

    const runningRooms = await this.prisma.instanceRoom.findMany({
      where: { status: RoomStatus.RUNNING },
      select: { id: true },
      take: 1_000,
    });
    for (const room of runningRooms) {
      this.eventsGateway.emitChatModeUpdated(room.id, {
        roomId: room.id,
        mode,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private async destroySandglassConnection(connectionId: string): Promise<Connection | null> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const latest = await tx.connection.findUnique({ where: { id: connectionId } });
      if (!latest || latest.status !== ConnectionStatus.SANDGLASS_24H || latest.destroyed_at !== null) {
        return null;
      }
      return tx.connection.update({
        where: { id: connectionId },
        data: {
          status: ConnectionStatus.DESTROYED,
          destroyed_at: new Date(),
        },
      });
    });
  }

  private async collapseUnlinkedUsersToWatchers(roomId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH target_room AS (
        SELECT id, start_date, end_date
        FROM instance_rooms
        WHERE id = ${roomId}::uuid
      ), protected_users AS (
        SELECT user_a_id AS id
        FROM connections
        WHERE room_id = ${roomId}::uuid AND status IN ('DEEP_LINK', 'SANDGLASS_24H')
        UNION
        SELECT user_b_id AS id
        FROM connections
        WHERE room_id = ${roomId}::uuid AND status IN ('DEEP_LINK', 'SANDGLASS_24H')
      ), candidates AS (
        SELECT u.id
        FROM users u
        CROSS JOIN target_room r
        LEFT JOIN protected_users pu ON pu.id = u.id
        WHERE u.role = 'ACTIVE'
          AND pu.id IS NULL
          AND u.created_at >= r.start_date
          AND u.created_at < r.end_date
      ), updated AS (
        UPDATE users
        SET role = 'WATCHER'
        WHERE id IN (SELECT id FROM candidates)
        RETURNING id
      )
      SELECT id::text FROM updated
    `;
    return rows.map((row) => row.id);
  }
}
