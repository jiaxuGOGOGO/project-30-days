import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Connection, ConnectionStatus, Decision, Prisma } from '@prisma/client';
import { EventsGateway } from '../events/events.gateway.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubmitDay30JudgmentDto } from './dto/submit-day30-judgment.dto.js';

export type Day30Outcome = 'LEGACY' | 'ASH' | 'PENDING';

export interface Day30JudgmentResponse {
  connectionId: string;
  outcome: Day30Outcome;
  msgCount: number;
  userDecision: Decision;
  peerDecision: Decision;
  status: ConnectionStatus;
  ticketTitle?: string;
}

@Injectable()
export class Day30Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
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
          ...this.finalizeConnection(dto.choice, peerDecision),
        },
      });

      const latestUserDecision = userSide === 'A' ? updated.user_a_decision : updated.user_b_decision;
      const latestPeerDecision = userSide === 'A' ? updated.user_b_decision : updated.user_a_decision;
      return this.toResponse(updated, latestUserDecision, latestPeerDecision);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.emitJudgment(response);
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

  private finalizeConnection(userDecision: Decision, peerDecision: Decision): Prisma.ConnectionUpdateInput {
    if (peerDecision === Decision.NULL) {
      return {};
    }

    const bothCooperated = userDecision === Decision.COOPERATE && peerDecision === Decision.COOPERATE;
    if (bothCooperated) {
      return {
        status: ConnectionStatus.DEEP_LINK,
        connected_days: 30,
      };
    }

    return {
      status: ConnectionStatus.DESTROYED,
      destroyed_at: new Date(),
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

    const outcome: Day30Outcome = connection.status === ConnectionStatus.DESTROYED ? 'ASH' : 'LEGACY';
    return {
      connectionId: connection.id,
      outcome,
      msgCount: 0,
      userDecision,
      peerDecision,
      status: connection.status,
      ticketTitle: outcome === 'ASH' ? 'STARDUST TICKET' : undefined,
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
    };

    if (response.outcome === 'ASH') {
      this.events.emitConnectionShattered(response.connectionId, payload);
      return;
    }
    this.events.emitChatModeUpdated(response.connectionId, payload);
  }
}
