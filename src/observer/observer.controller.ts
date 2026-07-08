import { Body, Controller, Param, Post } from '@nestjs/common';
import { BlessingDto, ObserverService } from './observer.service.js';

@Controller('observer')
export class ObserverController {
  constructor(private readonly observerService: ObserverService) {}

  /**
   * Claim daily observer reward (1 fragment per day).
   * POST /observer/daily-reward/:userId
   */
  @Post('daily-reward/:userId')
  async claimDailyReward(@Param('userId') userId: string) {
    return this.observerService.claimDailyReward(userId);
  }

  /**
   * Send anonymous blessing to an active connection.
   * POST /observer/bless
   */
  @Post('bless')
  async sendBlessing(@Body() dto: BlessingDto) {
    return this.observerService.sendBlessing(dto);
  }

  /**
   * Redeem observer fragments for hourglass freezes.
   * POST /observer/redeem/:userId
   */
  @Post('redeem/:userId')
  async redeemFragments(
    @Param('userId') userId: string,
    @Body() body: { fragmentsToRedeem: number },
  ) {
    return this.observerService.redeemFragments(userId, body.fragmentsToRedeem);
  }
}
