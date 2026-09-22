import { Access, CurrentUser, type SessionPrincipal } from '../auth/access.js';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SeasonService } from './season.service.js';

@Controller('season')
@Access('self')
export class SeasonController {
  constructor(private readonly seasonService: SeasonService) {}

  /**
   * Get the currently active season.
   * GET /season/active
   */
  @Get('active')
  @Access('public')
  async getActiveSeason() {
    return this.seasonService.getActiveSeason();
  }

  /**
   * Get cross-season assets for a user.
   * GET /season/assets/:userId
   */
  @Get('assets/:userId')
  async getCrossSeasonAssets(@Param('userId') _userId: string, @CurrentUser() actor: SessionPrincipal) {
    return this.seasonService.getCrossSeasonAssets(actor.userId);
  }

  /**
   * Transition to a new season (admin operation).
   * POST /season/transition
   */
  @Post('transition')
  @Access('disabled')
  async transitionToNewSeason(@Body() body: { theme: string }) {
    return this.seasonService.transitionToNewSeason(body.theme);
  }
}
