import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Access, CurrentUser, type SessionPrincipal } from '../auth/access.js';
import { ActorQueryDto, EchoRequestDto } from '../auth/request.dto.js';
import { DailyEchoService } from './daily-echo.service.js';

@Controller('daily-echo')
@Access('connection')
export class DailyEchoController {
  constructor(private readonly dailyEchoService: DailyEchoService) {}

  @Post('answer')
  async submitAnswer(@Body() dto: EchoRequestDto, @CurrentUser() actor: SessionPrincipal) {
    return this.dailyEchoService.submitAnswer({ ...dto, userId: actor.userId });
  }

  @Get('current/:connectionId')
  async getCurrentEcho(@Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Query() _query: ActorQueryDto, @CurrentUser() actor: SessionPrincipal) {
    return this.dailyEchoService.getCurrentEcho(connectionId, actor.userId);
  }

  @Get('history/:connectionId')
  async getEchoHistory(@Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Query() _query: ActorQueryDto, @CurrentUser() actor: SessionPrincipal) {
    return this.dailyEchoService.getEchoHistory(connectionId, actor.userId);
  }
}
