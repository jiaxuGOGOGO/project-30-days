import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { EventsGateway } from '../events/events.gateway.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * P2: WATCHER/OBSERVER Role Redesign
 *
 * Instead of being a punishment, WATCHER becomes "OBSERVER" with special privileges:
 * - View anonymized global hall dynamics (collisions, matches)
 * - Preview next season's FateCards
 * - Accumulate "observer fragments" for daily login
 * - Send anonymous blessings to active users (system-preset phrases)
 */

export interface ObserverDailyReward {
  userId: string;
  fragmentsEarned: number;
  totalFragments: number;
  message: string;
}

export interface BlessingDto {
  observerUserId: string;
  targetConnectionId: string;
  blessingType: BlessingType;
}

export type BlessingType = 'COURAGE' | 'PATIENCE' | 'TRUST' | 'HOPE';

const BLESSING_MESSAGES: Record<BlessingType, string> = {
  COURAGE: '一位观察者为你送来了勇气的祝福',
  PATIENCE: '一位观察者祝愿你们拥有耐心',
  TRUST: '一位观察者相信你们之间的信任',
  HOPE: '一位观察者为你们点亮了希望之光',
};

const DAILY_OBSERVER_FRAGMENTS = 1;

@Injectable()
export class ObserverService {
  private readonly logger = new Logger(ObserverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * Daily login reward for observers.
   * Each day an observer logs in, they earn 1 observer fragment.
   * Fragments can be redeemed next season for extra hourglass freezes.
   */
  async claimDailyReward(userId: string): Promise<ObserverDailyReward> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== UserRole.WATCHER && user.role !== UserRole.OBSERVER) {
      throw new BadRequestException('Only WATCHER/OBSERVER users can claim observer rewards');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        role: UserRole.OBSERVER, // Upgrade from WATCHER to OBSERVER on first interaction
        observer_fragments: { increment: DAILY_OBSERVER_FRAGMENTS },
      },
    });

    return {
      userId,
      fragmentsEarned: DAILY_OBSERVER_FRAGMENTS,
      totalFragments: updated.observer_fragments,
      message: '观察者碎片 +1。下赛季可兑换额外沙漏冻结。',
    };
  }

  /**
   * Send an anonymous blessing to an active connection.
   * Observers can encourage others without revealing their identity.
   */
  async sendBlessing(dto: BlessingDto): Promise<{ sent: boolean; message: string }> {
    const observer = await this.prisma.user.findUnique({ where: { id: dto.observerUserId } });
    if (!observer) {
      throw new NotFoundException('Observer not found');
    }

    if (observer.role !== UserRole.WATCHER && observer.role !== UserRole.OBSERVER) {
      throw new BadRequestException('Only observers can send blessings');
    }

    const connection = await this.prisma.connection.findUnique({
      where: { id: dto.targetConnectionId },
    });
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    const message = BLESSING_MESSAGES[dto.blessingType];

    // Emit blessing event to the connection's room
    this.eventsGateway.emitObserverBlessing(connection.room_id, {
      connectionId: dto.targetConnectionId,
      blessingType: dto.blessingType,
      message,
      sentAt: new Date().toISOString(),
    });

    this.logger.log(`Observer ${dto.observerUserId} sent ${dto.blessingType} blessing to connection ${dto.targetConnectionId}`);

    return { sent: true, message };
  }

  /**
   * Redeem observer fragments for hourglass freezes in the new season.
   * Rate: 5 observer fragments = 1 extra hourglass freeze (max 2 extra per season).
   */
  async redeemFragments(userId: string, fragmentsToRedeem: number): Promise<{ freezesGained: number; remainingFragments: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const freezesGained = Math.floor(fragmentsToRedeem / 5);
    if (freezesGained <= 0) {
      throw new BadRequestException('Need at least 5 fragments to redeem 1 freeze');
    }

    const maxExtraFreezes = 2;
    const actualFreezes = Math.min(freezesGained, maxExtraFreezes);
    const actualFragmentsUsed = actualFreezes * 5;

    if (user.observer_fragments < actualFragmentsUsed) {
      throw new BadRequestException('Insufficient observer fragments');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        observer_fragments: { decrement: actualFragmentsUsed },
        freeze_remaining: { increment: actualFreezes },
      },
    });

    return {
      freezesGained: actualFreezes,
      remainingFragments: updated.observer_fragments,
    };
  }
}
