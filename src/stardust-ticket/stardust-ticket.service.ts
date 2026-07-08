import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConnectionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * P2: Stardust Ticket Service — Redesigned as "Growth Record"
 *
 * The ticket is no longer just "proof of failure". Regardless of outcome (LEGACY or ASH),
 * the ticket contains positive, self-reflective content:
 * - Soul graph summary (personality profile from choices)
 * - Top 3 DailyEcho answers
 * - Connection statistics
 * - Growth tags (e.g., "深度倾听者", "勇敢表达者", "稳定陪伴者")
 */

export interface TicketContent {
  id: string;
  userId: string;
  connectionId: string;
  season: number;
  outcome: string;
  participatedDays: number;
  echoCount: number;
  growthTags: string[];
  highlightAnswers: string[];
  soulSummary: string | null;
}

/** Growth tag determination based on DailyEcho patterns */
const GROWTH_TAGS = {
  DEEP_LISTENER: '深度倾听者',
  BRAVE_EXPRESSER: '勇敢表达者',
  STEADY_COMPANION: '稳定陪伴者',
  CURIOUS_EXPLORER: '好奇探索者',
  WARM_ENCOURAGER: '温暖鼓励者',
  PHILOSOPHICAL_THINKER: '哲思者',
};

@Injectable()
export class StardustTicketService {
  private readonly logger = new Logger(StardustTicketService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate a stardust ticket for a user when their connection ends.
   * Called after LEGACY or ASH outcome.
   */
  async generateTicket(userId: string, connectionId: string): Promise<TicketContent> {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
      include: { daily_echoes: { orderBy: { day_number: 'asc' } } },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    const isUserA = connection.user_a_id === userId;
    const isUserB = connection.user_b_id === userId;
    if (!isUserA && !isUserB) {
      throw new NotFoundException('User not part of this connection');
    }

    // Calculate statistics
    const completedEchoes = connection.daily_echoes.filter((e) => e.both_answered);
    const echoCount = completedEchoes.length;
    const participatedDays = connection.connected_days;

    // Determine outcome
    const outcome = connection.status === ConnectionStatus.DESTROYED ? 'ASH' : 'LEGACY';

    // Select top 3 highlight answers (longest/most thoughtful)
    const userAnswers = completedEchoes
      .map((e) => ({
        dayNumber: e.day_number,
        answer: isUserA ? e.user_a_answer : e.user_b_answer,
        prompt: e.prompt_text,
      }))
      .filter((a) => a.answer !== null)
      .sort((a, b) => (b.answer?.length ?? 0) - (a.answer?.length ?? 0))
      .slice(0, 3)
      .map((a) => `Day ${a.dayNumber}: "${a.answer}"`);

    // Generate growth tags based on participation patterns
    const growthTags = this.determineGrowthTags(echoCount, participatedDays, completedEchoes.length);

    // Generate soul summary
    const soulSummary = this.generateSoulSummary(growthTags, participatedDays, outcome);

    // Create or update ticket in database
    const ticket = await this.prisma.stardustTicket.upsert({
      where: {
        user_id_connection_id: {
          user_id: userId,
          connection_id: connectionId,
        },
      },
      create: {
        user_id: userId,
        connection_id: connectionId,
        season: connection.season,
        outcome,
        participated_days: participatedDays,
        echo_count: echoCount,
        growth_tags: JSON.stringify(growthTags),
        highlight_answers: JSON.stringify(userAnswers),
        soul_summary: soulSummary,
      },
      update: {
        outcome,
        participated_days: participatedDays,
        echo_count: echoCount,
        growth_tags: JSON.stringify(growthTags),
        highlight_answers: JSON.stringify(userAnswers),
        soul_summary: soulSummary,
      },
    });

    this.logger.log(`Generated stardust ticket for user ${userId}, connection ${connectionId}: ${outcome}`);

    return {
      id: ticket.id,
      userId: ticket.user_id,
      connectionId: ticket.connection_id,
      season: ticket.season,
      outcome: ticket.outcome,
      participatedDays: ticket.participated_days,
      echoCount: ticket.echo_count,
      growthTags,
      highlightAnswers: userAnswers,
      soulSummary,
    };
  }

  /**
   * Get existing ticket for a user-connection pair.
   */
  async getTicket(userId: string, connectionId: string): Promise<TicketContent | null> {
    const ticket = await this.prisma.stardustTicket.findUnique({
      where: {
        user_id_connection_id: {
          user_id: userId,
          connection_id: connectionId,
        },
      },
    });

    if (!ticket) return null;

    return {
      id: ticket.id,
      userId: ticket.user_id,
      connectionId: ticket.connection_id,
      season: ticket.season,
      outcome: ticket.outcome,
      participatedDays: ticket.participated_days,
      echoCount: ticket.echo_count,
      growthTags: JSON.parse(ticket.growth_tags) as string[],
      highlightAnswers: JSON.parse(ticket.highlight_answers) as string[],
      soulSummary: ticket.soul_summary,
    };
  }

  private determineGrowthTags(echoCount: number, participatedDays: number, completedEchoes: number): string[] {
    const tags: string[] = [];

    // Steady companion: participated most days
    if (participatedDays >= 25) {
      tags.push(GROWTH_TAGS.STEADY_COMPANION);
    }

    // Deep listener: completed many echoes
    if (completedEchoes >= 20) {
      tags.push(GROWTH_TAGS.DEEP_LISTENER);
    }

    // Brave expresser: answered early and consistently
    if (echoCount >= 15) {
      tags.push(GROWTH_TAGS.BRAVE_EXPRESSER);
    }

    // Curious explorer: participated even when not required
    if (participatedDays >= 20 && echoCount >= 10) {
      tags.push(GROWTH_TAGS.CURIOUS_EXPLORER);
    }

    // Default tag if none earned
    if (tags.length === 0) {
      tags.push(GROWTH_TAGS.PHILOSOPHICAL_THINKER);
    }

    return tags.slice(0, 3); // Max 3 tags
  }

  private generateSoulSummary(tags: string[], days: number, outcome: string): string {
    const tagStr = tags.join('、');
    if (outcome === 'LEGACY') {
      return `在 ${days} 天的旅程中，你展现了${tagStr}的特质。你选择了信任，而信任也回应了你。这段连接将成为你灵魂图谱中永恒的一笔。`;
    }
    return `在 ${days} 天的旅程中，你展现了${tagStr}的特质。虽然这段连接最终各自远行，但你在过程中的每一次真诚回应，都是对自我的深度探索。`;
  }
}
