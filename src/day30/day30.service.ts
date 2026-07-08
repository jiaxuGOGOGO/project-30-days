import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Connection, ConnectionStatus, Decision, Prisma } from '@prisma/client';
import { EventsGateway } from '../events/events.gateway.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubmitDay30JudgmentDto } from './dto/submit-day30-judgment.dto.js';

/**
 * Progressive Trust Reveal outcomes:
 * - LEGACY: Both chose STAY → connection succeeds
 * - ASH: Final destruction after extension/cooldown exhausted
 * - PENDING: Waiting for peer's decision
 * - EXTENSION: One STAY + One PAUSE → 7-day extension period
 * - COOLDOWN: Both PAUSE → 14-day cooling period
 */
export type Day30Outcome = 'LEGACY' | 'ASH' | 'PENDING' | 'EXTENSION' | 'COOLDOWN';

export interface Day30JudgmentResponse {
  connectionId: string;
  outcome: Day30Outcome;
  msgCount: number;
  userDecision: Decision;
  peerDecision: Decision;
  status: ConnectionStatus;
  ticketTitle?: string;
  /** ISO timestamp when extension period ends (7 days from now) */
  extensionEndsAt?: string;
  /** ISO timestamp when cooldown period ends (14 days from now) */
  cooldownEndsAt?: string;
}

const EXTENSION_DAYS = 7;
const COOLDOWN_DAYS = 14;

@Injectable()
export class Day30Service {
  private readonly logger = new Logger(Day30Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    private readonly mediaService: MediaService,
  ) {}

  async submitJudgment(dto: SubmitDay30JudgmentDto): Promise<Day30JudgmentResponse> {
    const response = await this.prisma.$transaction(async (tx) => {
      const connection = await tx.connection.findUnique({ where: { id: dto.connectionId } });
      if (!connection) {
        throw new NotFoundException('Connection was not found.');
      }
      if (connection.status !== ConnectionStatus.JUDGMENT) {
        throw new BadRequestException('Connection is not in DAY30 judgment state.');
      }

      const userSide = this.resolveUserSide(connection, dto.userId);
      const decisionField = userSide === 'A' ? 'user_a_decision' : 'user_b_decision';
      const peerDecision = userSide === 'A' ? connection.user_b_decision : connection.user_a_decision;
      const currentDecision = userSide === 'A' ? connection.user_a_decision : connection.user_b_decision;

      if (currentDecision !== Decision.NULL && currentDecision !== dto.choice) {
        throw new BadRequestException('Final judgment has already been locked for this user.');
      }

      const updated = await tx.connection.update({
        where: { id: dto.connectionId },
        data: {
          [decisionField]: dto.choice,
          ...this.finalizeConnection(dto.choice, peerDecision, connection),
        },
      });

      const latestUserDecision = userSide === 'A' ? updated.user_a_decision : updated.user_b_decision;
      const latestPeerDecision = userSide === 'A' ? updated.user_b_decision : updated.user_a_decision;
      return this.toResponse(updated, latestUserDecision, latestPeerDecision);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.emitJudgment(response);

    // P0 Security: Auto-destroy videos when connection is destroyed (ASH outcome)
    if (response.outcome === 'ASH') {
      this.mediaService.destroyConnectionVideos(dto.connectionId).catch((err) => {
        this.logger.error(`Failed to destroy videos for connection ${dto.connectionId}: ${err.message}`);
      });
    }

    return response;
  }

  private resolveUserSide(connection: Connection, userId: string): 'A' | 'B' {
    if (connection.user_a_id === userId) {
      return 'A';
    }
    if (connection.user_b_id === userId) {
      return 'B';
    }
    throw new ForbiddenException('User does not belong to this connection.');
  }

  /**
   * Progressive Trust Reveal finalization logic:
   *
   * | User A    | User B    | Result                              |
   * |-----------|-----------|-------------------------------------|
   * | STAY      | STAY      | LEGACY (success)                    |
   * | STAY      | PAUSE     | 7-day extension period              |
   * | PAUSE     | STAY      | 7-day extension period              |
   * | PAUSE     | PAUSE     | 14-day cooldown period              |
   *
   * After extension/cooldown expires, Chronos triggers re-vote.
   * If the second round also fails to produce mutual STAY, ASH is final.
   */
  private finalizeConnection(
    userDecision: Decision,
    peerDecision: Decision,
    existingConnection: Connection,
  ): Prisma.ConnectionUpdateInput {
    if (peerDecision === Decision.NULL) {
      return {};
    }

    const bothCooperated = userDecision === Decision.COOPERATE && peerDecision === Decision.COOPERATE;
    if (bothCooperated) {
      // Both STAY → LEGACY
      return {
        status: ConnectionStatus.DEEP_LINK,
        connected_days: 30,
      };
    }

    // Check if this is a second-round judgment (extension/cooldown already used)
    // If judgment_started_at is in the future, this is already an extension/cooldown re-vote
    const isSecondRound = existingConnection.judgment_started_at !== null &&
      existingConnection.judgment_started_at.getTime() > existingConnection.created_at.getTime() + 29 * 24 * 60 * 60 * 1000;

    if (isSecondRound) {
      // Second round failure → true ASH (final destruction)
      return {
        status: ConnectionStatus.DESTROYED,
        destroyed_at: new Date(),
      };
    }

    // First round: grant extension or cooldown
    const bothDefected = userDecision === Decision.DEFECT && peerDecision === Decision.DEFECT;
    const extensionMs = bothDefected
      ? COOLDOWN_DAYS * 24 * 60 * 60 * 1000
      : EXTENSION_DAYS * 24 * 60 * 60 * 1000;

    // Reset decisions for re-vote after extension/cooldown period
    // judgment_started_at is set to future date = when re-vote becomes available
    return {
      judgment_started_at: new Date(Date.now() + extensionMs),
      user_a_decision: Decision.NULL,
      user_b_decision: Decision.NULL,
    };
  }

  private toResponse(connection: Connection, userDecision: Decision, peerDecision: Decision): Day30JudgmentResponse {
    if (peerDecision === Decision.NULL) {
      return {
        connectionId: connection.id,
        outcome: 'PENDING',
        msgCount: 0,
        userDecision,
        peerDecision,
        status: connection.status,
      };
    }

    // DESTROYED → ASH
    if (connection.status === ConnectionStatus.DESTROYED) {
      return {
        connectionId: connection.id,
        outcome: 'ASH',
        msgCount: 0,
        userDecision,
        peerDecision,
        status: connection.status,
        ticketTitle: 'STARDUST TICKET',
      };
    }

    // DEEP_LINK with 30 days → LEGACY
    if (connection.status === ConnectionStatus.DEEP_LINK && connection.connected_days === 30) {
      return {
        connectionId: connection.id,
        outcome: 'LEGACY',
        msgCount: 0,
        userDecision,
        peerDecision,
        status: connection.status,
      };
    }

    // Still in JUDGMENT with reset decisions → Extension or Cooldown
    const bothDefected = userDecision === Decision.DEFECT && peerDecision === Decision.DEFECT;
    const outcome: Day30Outcome = bothDefected ? 'COOLDOWN' : 'EXTENSION';
    const periodMs = bothDefected
      ? COOLDOWN_DAYS * 24 * 60 * 60 * 1000
      : EXTENSION_DAYS * 24 * 60 * 60 * 1000;
    const endsAt = new Date(Date.now() + periodMs).toISOString();

    return {
      connectionId: connection.id,
      outcome,
      msgCount: 0,
      userDecision,
      peerDecision,
      status: connection.status,
      extensionEndsAt: outcome === 'EXTENSION' ? endsAt : undefined,
      cooldownEndsAt: outcome === 'COOLDOWN' ? endsAt : undefined,
    };
  }

  private emitJudgment(response: Day30JudgmentResponse): void {
    const payload = {
      connectionId: response.connectionId,
      outcome: response.outcome,
      userDecision: response.userDecision,
      peerDecision: response.peerDecision,
      status: response.status,
      ticketTitle: response.ticketTitle,
      extensionEndsAt: response.extensionEndsAt,
      cooldownEndsAt: response.cooldownEndsAt,
    };

    if (response.outcome === 'ASH') {
      this.events.emitConnectionShattered(response.connectionId, payload);
      return;
    }
    if (response.outcome === 'EXTENSION' || response.outcome === 'COOLDOWN') {
      this.events.emitDay30JudgmentResult(response.connectionId, payload);
      return;
    }
    this.events.emitChatModeUpdated(response.connectionId, payload);
  }
}
