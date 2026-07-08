import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SeasonService } from './season.service.js';

@Controller('season')
export class SeasonController {
  constructor(private readonly seasonService: SeasonService) {}

  /**
   * Get the currently active season.
   * GET /season/active
   */
  @Get('active')
  async getActiveSeason() {
    return this.seasonService.getActiveSeason();
  }

  /**
   * Get cross-season assets for a user.
   * GET /season/assets/:userId
   */
  @Get('assets/:userId')
  async getCrossSeasonAssets(@Param('userId') userId: string) {
    return this.seasonService.getCrossSeasonAssets(userId);
  }

  /**
   * Transition to a new season (admin operation).
   * POST /season/transition
   */
  @Post('transition')
  async transitionToNewSeason(@Body() body: { theme: string }) {
    return this.seasonService.transitionToNewSeason(body.theme);
  }
}
