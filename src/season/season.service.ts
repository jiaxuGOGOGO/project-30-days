import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * P2: Season Service
 *
 * Manages the seasonal cycle system. Each 30-day period is a "season".
 * Between seasons, partial progress is preserved:
 * - Stardust fragments (earned from DailyEcho completion)
 * - Soul graph (personality profile from choices)
 * - LEGACY badge (glow effect for previous season winners)
 */

export interface SeasonSummary {
  seasonNumber: number;
  theme: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

export interface CrossSeasonAssets {
  userId: string;
  stardustFragments: number;
  legacyBadge: boolean;
  observerFragments: number;
  freezeRemaining: number;
}

@Injectable()
export class SeasonService {
  private readonly logger = new Logger(SeasonService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get the currently active season.
   */
  async getActiveSeason(): Promise<SeasonSummary | null> {
    const season = await this.prisma.season.findFirst({
      where: { is_active: true },
    });
    if (!season) return null;
    return {
      seasonNumber: season.season_number,
      theme: season.theme,
      startsAt: season.starts_at.toISOString(),
      endsAt: season.ends_at.toISOString(),
      isActive: season.is_active,
    };
  }

  /**
   * Transition to a new season.
   * Called when the current season ends (30 days elapsed).
   *
   * Steps:
   * 1. Deactivate current season
   * 2. Create new season with incremented number
   * 3. Reset user freeze counts (2 per season)
   * 4. Award LEGACY badges to users who achieved LEGACY last season
   * 5. Preserve stardust fragments and observer fragments
   */
  async transitionToNewSeason(newTheme: string): Promise<SeasonSummary> {
    const currentSeason = await this.prisma.season.findFirst({
      where: { is_active: true },
    });

    const nextSeasonNumber = currentSeason ? currentSeason.season_number + 1 : 1;
    const now = new Date();
    const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Transaction: deactivate old, create new, reset users
    const newSeason = await this.prisma.$transaction(async (tx) => {
      // Deactivate current season
      if (currentSeason) {
        await tx.season.update({
          where: { id: currentSeason.id },
          data: { is_active: false },
        });
      }

      // Create new season
      const season = await tx.season.create({
        data: {
          season_number: nextSeasonNumber,
          theme: newTheme,
          starts_at: now,
          ends_at: endsAt,
          is_active: true,
        },
      });

      // Reset freeze counts for all users (2 per season)
      await tx.user.updateMany({
        data: {
          freeze_remaining: 2,
          current_season: nextSeasonNumber,
        },
      });

      // Award LEGACY badges: users who had DEEP_LINK connections at day 30
      // in the previous season
      if (currentSeason) {
        const legacyUsers = await tx.connection.findMany({
          where: {
            season: currentSeason.season_number,
            status: 'DEEP_LINK',
            connected_days: 30,
          },
          select: { user_a_id: true, user_b_id: true },
        });

        const legacyUserIds = new Set<string>();
        for (const conn of legacyUsers) {
          legacyUserIds.add(conn.user_a_id);
          legacyUserIds.add(conn.user_b_id);
        }

        if (legacyUserIds.size > 0) {
          await tx.user.updateMany({
            where: { id: { in: Array.from(legacyUserIds) } },
            data: { legacy_badge: true },
          });
        }

        // Clear legacy badges for users who didn't achieve LEGACY
        await tx.user.updateMany({
          where: { id: { notIn: Array.from(legacyUserIds) } },
          data: { legacy_badge: false },
        });
      }

      return season;
    });

    this.logger.log(`Season ${nextSeasonNumber} started: "${newTheme}"`);

    return {
      seasonNumber: newSeason.season_number,
      theme: newSeason.theme,
      startsAt: newSeason.starts_at.toISOString(),
      endsAt: newSeason.ends_at.toISOString(),
      isActive: newSeason.is_active,
    };
  }

  /**
   * Get cross-season assets for a user.
   */
  async getCrossSeasonAssets(userId: string): Promise<CrossSeasonAssets> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      userId: user.id,
      stardustFragments: user.stardust_fragments,
      legacyBadge: user.legacy_badge,
      observerFragments: user.observer_fragments,
      freezeRemaining: user.freeze_remaining,
    };
  }

  /**
   * Award stardust fragment to a user (called when DailyEcho is completed).
   */
  async awardStardustFragment(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { stardust_fragments: { increment: 1 } },
    });
  }
}
