import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConnectionStatus, Prisma } from '@prisma/client';
import { EventsGateway } from '../events/events.gateway.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * DailyEcho Service
 *
 * Manages the daily double-blind Q&A mechanism that maintains user engagement
 * during the Day 2-29 "middle period". Both users must answer before they can
 * see each other's response. Video reveal progress only advances when both answer.
 */

const DAILY_PROMPTS: string[] = [
  '今天让你微笑的一件事是什么？',
  '如果明天世界暂停一天，你会做什么？',
  '你最近一次感到被理解是什么时候？',
  '用一个词形容你此刻的心情。',
  '你童年最温暖的记忆是什么？',
  '如果可以给五年前的自己说一句话，你会说什么？',
  '你最近读到/看到的让你有感触的一句话是什么？',
  '深夜睡不着的时候，你通常在想什么？',
  '你觉得"勇敢"是什么样子的？',
  '如果你的生活是一首歌，现在是什么旋律？',
  '你最珍惜的一段关系教会了你什么？',
  '你觉得什么样的沉默是舒服的？',
  '如果可以拥有一种超能力，你选什么？为什么？',
  '你最近一次对自己感到骄傲是因为什么？',
  '你理想中的一个普通周末是什么样的？',
  '有没有一个你一直想去但还没去的地方？',
  '你觉得"安全感"来自哪里？',
  '如果要用一道菜来形容你自己，会是什么？',
  '你最近一次流泪是因为什么？',
  '你觉得两个人之间最重要的是什么？',
  '如果今天是你生命的最后一天，你想和谁在一起？',
  '你有没有一个从未告诉别人的小习惯？',
  '你觉得什么时候的自己最真实？',
  '如果可以回到人生的某一天重新过，你选哪天？',
  '你觉得"陪伴"最好的形式是什么？',
  '你最近一次被一个陌生人温暖到是什么时候？',
  '你觉得孤独和独处的区别是什么？',
  '如果要给这30天起一个名字，你会叫它什么？',
];

export interface SubmitEchoAnswerDto {
  connectionId: string;
  userId: string;
  dayNumber: number;
  answer: string;
}

export interface DailyEchoResult {
  id: string;
  dayNumber: number;
  promptText: string;
  myAnswer: string | null;
  partnerAnswer: string | null;
  bothAnswered: boolean;
  canReveal: boolean;
}

@Injectable()
export class DailyEchoService {
  private readonly logger = new Logger(DailyEchoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * Create daily echo prompts for all active DEEP_LINK connections.
   * Called by Chronos at 20:00 daily.
   */
  async generateDailyEchoes(): Promise<number> {
    const activeConnections = await this.prisma.connection.findMany({
      where: {
        status: ConnectionStatus.DEEP_LINK,
        connected_days: { gte: 2, lte: 29 },
        destroyed_at: null,
      },
      select: { id: true, connected_days: true, room_id: true },
    });

    let created = 0;
    for (const conn of activeConnections) {
      const dayNumber = conn.connected_days;
      const promptIndex = (dayNumber - 2) % DAILY_PROMPTS.length;
      const promptText = DAILY_PROMPTS[promptIndex];

      try {
        await this.prisma.dailyEcho.create({
          data: {
            connection_id: conn.id,
            day_number: dayNumber,
            prompt_text: promptText,
          },
        });
        created++;

        // Notify both users
        this.eventsGateway.emitDailyEchoCreated(conn.room_id, {
          connectionId: conn.id,
          dayNumber,
          promptText,
        });
      } catch (error) {
        // Unique constraint violation means echo already exists for this day
        if ((error as any)?.code === 'P2002') {
          continue;
        }
        this.logger.error(`Failed to create echo for connection ${conn.id} day ${dayNumber}`, error);
      }
    }

    this.logger.log(`Generated ${created} daily echoes`);
    return created;
  }

  /**
   * Submit an answer to a daily echo.
   * When both users have answered, mark as complete and emit reveal event.
   */
  async submitAnswer(dto: SubmitEchoAnswerDto): Promise<DailyEchoResult> {
    if (!dto.answer || dto.answer.trim().length === 0) {
      throw new BadRequestException('Answer cannot be empty');
    }
    if (dto.answer.length > 500) {
      throw new BadRequestException('Answer must be 500 characters or less');
    }

    const echo = await this.prisma.dailyEcho.findUnique({
      where: {
        connection_id_day_number: {
          connection_id: dto.connectionId,
          day_number: dto.dayNumber,
        },
      },
      include: { connection: true },
    });

    if (!echo) {
      throw new NotFoundException('Daily echo not found');
    }
    if (echo.both_answered) {
      throw new BadRequestException('Both users have already answered this echo');
    }

    const connection = echo.connection;
    const isUserA = connection.user_a_id === dto.userId;
    const isUserB = connection.user_b_id === dto.userId;

    if (!isUserA && !isUserB) {
      throw new BadRequestException('User is not part of this connection');
    }

    // Determine which field to update
    const updateData: Prisma.DailyEchoUpdateInput = {};
    if (isUserA) {
      if (echo.user_a_answer !== null) {
        throw new BadRequestException('You have already answered this echo');
      }
      updateData.user_a_answer = dto.answer.trim();
    } else {
      if (echo.user_b_answer !== null) {
        throw new BadRequestException('You have already answered this echo');
      }
      updateData.user_b_answer = dto.answer.trim();
    }

    // Check if this completes the pair
    const otherAnswered = isUserA ? echo.user_b_answer !== null : echo.user_a_answer !== null;
    if (otherAnswered) {
      updateData.both_answered = true;
      updateData.answered_at = new Date();
    }

    const updated = await this.prisma.dailyEcho.update({
      where: { id: echo.id },
      data: updateData,
    });

    // If both answered, emit event for video reveal advancement
    if (updated.both_answered) {
      this.eventsGateway.emitDailyEchoCompleted(connection.room_id, {
        connectionId: connection.id,
        dayNumber: dto.dayNumber,
        completedAt: new Date().toISOString(),
      });
    }

    return {
      id: updated.id,
      dayNumber: updated.day_number,
      promptText: updated.prompt_text,
      myAnswer: isUserA ? updated.user_a_answer : updated.user_b_answer,
      partnerAnswer: updated.both_answered
        ? (isUserA ? updated.user_b_answer : updated.user_a_answer)
        : null,
      bothAnswered: updated.both_answered,
      canReveal: updated.both_answered,
    };
  }

  /**
   * Get the current day's echo for a connection.
   */
  async getCurrentEcho(connectionId: string, userId: string): Promise<DailyEchoResult | null> {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    const isUserA = connection.user_a_id === userId;
    const isUserB = connection.user_b_id === userId;
    if (!isUserA && !isUserB) {
      throw new BadRequestException('User is not part of this connection');
    }

    const echo = await this.prisma.dailyEcho.findUnique({
      where: {
        connection_id_day_number: {
          connection_id: connectionId,
          day_number: connection.connected_days,
        },
      },
    });

    if (!echo) return null;

    return {
      id: echo.id,
      dayNumber: echo.day_number,
      promptText: echo.prompt_text,
      myAnswer: isUserA ? echo.user_a_answer : echo.user_b_answer,
      partnerAnswer: echo.both_answered
        ? (isUserA ? echo.user_b_answer : echo.user_a_answer)
        : null,
      bothAnswered: echo.both_answered,
      canReveal: echo.both_answered,
    };
  }

  /**
   * Get all echoes history for a connection (for the legacy ticket).
   */
  async getEchoHistory(connectionId: string, userId: string): Promise<DailyEchoResult[]> {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    const isUserA = connection.user_a_id === userId;
    const isUserB = connection.user_b_id === userId;
    if (!isUserA && !isUserB) {
      throw new BadRequestException('User is not part of this connection');
    }

    const echoes = await this.prisma.dailyEcho.findMany({
      where: { connection_id: connectionId },
      orderBy: { day_number: 'asc' },
    });

    return echoes.map((echo) => ({
      id: echo.id,
      dayNumber: echo.day_number,
      promptText: echo.prompt_text,
      myAnswer: isUserA ? echo.user_a_answer : echo.user_b_answer,
      partnerAnswer: echo.both_answered
        ? (isUserA ? echo.user_b_answer : echo.user_a_answer)
        : null,
      bothAnswered: echo.both_answered,
      canReveal: echo.both_answered,
    }));
  }
}
