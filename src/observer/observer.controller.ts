import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Access, CurrentUser, type SessionPrincipal } from '../auth/access.js';
import { ActorQueryDto, RedeemRequestDto } from '../auth/request.dto.js';
import { BlessingDto, ObserverService } from './observer.service.js';

@Controller('observer')
@Access('self')
export class ObserverController {
  constructor(private readonly observerService: ObserverService) {}

  @Post('daily-reward/:userId')
  async claimDailyReward(@Param('userId', ParseUUIDPipe) _userId: string,
    @Body() _body: ActorQueryDto, @CurrentUser() actor: SessionPrincipal) {
    return this.observerService.claimDailyReward(actor.userId);
  }

  // No approved cross-relationship visibility contract yet.
  @Post('bless')
  @Access('disabled')
  async sendBlessing(@Body() dto: BlessingDto) {
    return this.observerService.sendBlessing(dto);
  }

  @Post('redeem/:userId')
  async redeemFragments(@Param('userId', ParseUUIDPipe) _userId: string,
    @Body() body: RedeemRequestDto, @CurrentUser() actor: SessionPrincipal) {
    return this.observerService.redeemFragments(actor.userId, body.fragmentsToRedeem);
  }
}
