import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Connection, ConnectionStatus, Decision, Prisma, RoomStatus, UserRole } from '@prisma/client';
import { EventsGateway } from '../events/events.gateway.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { FateCardChoice, SubmitYomiAnswerDto } from './dto/submit-yomi-answer.dto.js';
import { canonicalPair, yomiAnswerKey, yomiCooldownKey, yomiPairLockKey } from './yomi-key.util.js';

const ANSWER_TTL_SECONDS = 24 * 60 * 60;
const COOLDOWN_TTL_SECONDS = 12 * 60 * 60;
const LOCK_TTL_MILLISECONDS = 5_000;

type YomiSubmissionStatus = 'WAITING_FOR_COUNTERPART' | 'MATCHED' | 'REJECTED_AND_COOLDOWN';

interface StoredYomiAnswer {
  roomId: string;
  actorUserId: string;
  targetUserId: string;
  fateCardId: string;
  selectedOption: FateCardChoice;
  submittedAt: string;
}

export interface YomiSubmissionResult {
  status: YomiSubmissionStatus;
  roomId: string;
  actorUserId: string;
  targetUserId: string;
  fateCardId: string;
  cooldownExpiresInSeconds?: number;
  connectionId?: string;
  connectionStatus?: ConnectionStatus;
}

@Injectable()
export class YomiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async submitAnswer(dto: SubmitYomiAnswerDto): Promise<YomiSubmissionResult> {
    if (dto.actorUserId === dto.targetUserId) {
      throw new BadRequestException('actorUserId and targetUserId must be different users');
    }

    const lock = await this.redisService.acquireLock(
      yomiPairLockKey(dto.roomId, dto.fateCardId, dto.actorUserId, dto.targetUserId),
      LOCK_TTL_MILLISECONDS,
    );
    if (!lock) {
      throw new ConflictException('The pair is being matched by another request; retry shortly');
    }

    try {
      await this.assertSubmissionEntities(dto);
      const redis = this.redisService.getClient();
      const currentAnswerKey = yomiAnswerKey(dto);
      const counterpartAnswerKey = yomiAnswerKey({
        roomId: dto.roomId,
        fateCardId: dto.fateCardId,
        actorUserId: dto.targetUserId,
        targetUserId: dto.actorUserId,
      });
      const actorCooldownKey = yomiCooldownKey(dto.roomId, dto.actorUserId, dto.targetUserId);
      const targetCooldownKey = yomiCooldownKey(dto.roomId, dto.targetUserId, dto.actorUserId);

      const cooldownTtl = await redis.ttl(actorCooldownKey);
      if (cooldownTtl > 0) {
        throw new ConflictException(`This directed pair is cooling down for ${cooldownTtl} seconds`);
      }

      const counterpartRaw = await redis.get(counterpartAnswerKey);
      const currentAnswer: StoredYomiAnswer = {
        roomId: dto.roomId,
        actorUserId: dto.actorUserId,
        targetUserId: dto.targetUserId,
        fateCardId: dto.fateCardId,
        selectedOption: dto.selectedOption,
        submittedAt: new Date().toISOString(),
      };

      if (!counterpartRaw) {
        await redis
          .multi()
          .set(currentAnswerKey, JSON.stringify(currentAnswer), 'EX', ANSWER_TTL_SECONDS)
          .exec();
        return {
          status: 'WAITING_FOR_COUNTERPART',
          roomId: dto.roomId,
          actorUserId: dto.actorUserId,
          targetUserId: dto.targetUserId,
          fateCardId: dto.fateCardId,
        };
      }

      const counterpart = this.parseStoredAnswer(counterpartRaw);
      if (counterpart.selectedOption === dto.selectedOption) {
        const connection = await this.createSandglassConnection(dto);
        await redis.multi().del(currentAnswerKey, counterpartAnswerKey).exec();
        this.eventsGateway.emitMatchingSucceeded(dto.roomId, {
          connectionId: connection.id,
          roomId: dto.roomId,
          userAId: connection.user_a_id,
          userBId: connection.user_b_id,
          status: connection.status,
          sandglassStartedAt: connection.sandglass_started_at?.toISOString() ?? null,
        });
        return {
          status: 'MATCHED',
          roomId: dto.roomId,
          actorUserId: dto.actorUserId,
          targetUserId: dto.targetUserId,
          fateCardId: dto.fateCardId,
          connectionId: connection.id,
          connectionStatus: connection.status,
        };
      }

      await redis
        .multi()
        .set(actorCooldownKey, '1', 'EX', COOLDOWN_TTL_SECONDS)
        .set(targetCooldownKey, '1', 'EX', COOLDOWN_TTL_SECONDS)
        .del(currentAnswerKey, counterpartAnswerKey)
        .exec();
      this.eventsGateway.emitMatchingFailed(dto.roomId, {
        roomId: dto.roomId,
        fateCardId: dto.fateCardId,
        actorUserId: dto.actorUserId,
        targetUserId: dto.targetUserId,
        cooldownSeconds: COOLDOWN_TTL_SECONDS,
      });

      return {
        status: 'REJECTED_AND_COOLDOWN',
        roomId: dto.roomId,
        actorUserId: dto.actorUserId,
        targetUserId: dto.targetUserId,
        fateCardId: dto.fateCardId,
        cooldownExpiresInSeconds: COOLDOWN_TTL_SECONDS,
      };
    } finally {
      await this.redisService.releaseLock(lock);
    }
  }

  private parseStoredAnswer(raw: string): StoredYomiAnswer {
    try {
      const parsed = JSON.parse(raw) as StoredYomiAnswer;
      if (parsed.selectedOption !== FateCardChoice.A && parsed.selectedOption !== FateCardChoice.B) {
        throw new Error('stored selectedOption is invalid');
      }
      return parsed;
    } catch (error) {
      throw new ServiceUnavailableException(`Stored Redis Yomi answer is corrupt: ${(error as Error).message}`);
    }
  }

  private async assertSubmissionEntities(dto: SubmitYomiAnswerDto): Promise<void> {
    const [room, fateCard, actor, target] = await Promise.all([
      this.prisma.instanceRoom.findUnique({ where: { id: dto.roomId } }),
      this.prisma.fateCard.findUnique({ where: { id: dto.fateCardId } }),
      this.prisma.user.findUnique({ where: { id: dto.actorUserId } }),
      this.prisma.user.findUnique({ where: { id: dto.targetUserId } }),
    ]);

    if (!room) {
      throw new NotFoundException('room not found');
    }
    if (room.status !== RoomStatus.RUNNING) {
      throw new ConflictException('Yomi matching is allowed only in RUNNING rooms');
    }
    if (new Date() >= room.end_date) {
      throw new ConflictException('room already reached its 30-day end date');
    }
    if (!fateCard) {
      throw new NotFoundException('fate card not found');
    }
    if (!actor || actor.role !== UserRole.ACTIVE) {
      throw new ConflictException('actor user must exist and be ACTIVE');
    }
    if (!target || target.role !== UserRole.ACTIVE) {
      throw new ConflictException('target user must exist and be ACTIVE');
    }
  }

  private async createSandglassConnection(dto: SubmitYomiAnswerDto): Promise<Connection> {
    const [userAId, userBId] = canonicalPair(dto.actorUserId, dto.targetUserId);
    const now = new Date();

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.connection.findFirst({
        where: {
          room_id: dto.roomId,
          status: { not: ConnectionStatus.DESTROYED },
          OR: [
            { user_a_id: userAId, user_b_id: userBId },
            { user_a_id: userBId, user_b_id: userAId },
          ],
        },
        orderBy: { created_at: 'desc' },
      });

      if (existing) {
        return tx.connection.update({
          where: { id: existing.id },
          data: {
            status: ConnectionStatus.SANDGLASS_24H,
            connected_days: 0,
            user_a_decision: Decision.NULL,
            user_b_decision: Decision.NULL,
            sandglass_started_at: now,
            deep_link_started_at: null,
            judgment_started_at: null,
            destroyed_at: null,
          },
        });
      }

      return tx.connection.create({
        data: {
          room_id: dto.roomId,
          user_a_id: userAId,
          user_b_id: userBId,
          status: ConnectionStatus.SANDGLASS_24H,
          connected_days: 0,
          user_a_decision: Decision.NULL,
          user_b_decision: Decision.NULL,
          sandglass_started_at: now,
        },
      });
    });
  }
}
