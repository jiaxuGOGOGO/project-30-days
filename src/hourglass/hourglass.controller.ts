import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Access, CurrentUser, type SessionPrincipal } from '../auth/access.js';
import { ActorQueryDto, ConnectionRequestDto } from '../auth/request.dto.js';
import { HourglassService } from './hourglass.service.js';

@Controller('hourglass')
@Access('connection')
export class HourglassController {
  constructor(private readonly hourglassService: HourglassService) {}

  @Post('freeze')
  async useFreeze(@Body() dto: ConnectionRequestDto, @CurrentUser() actor: SessionPrincipal) {
    return this.hourglassService.useFreeze({ ...dto, userId: actor.userId });
  }

  @Get('status/:connectionId')
  async getFreezeStatus(@Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Query() _query: ActorQueryDto, @CurrentUser() actor: SessionPrincipal) {
    return this.hourglassService.getFreezeStatus(actor.userId, connectionId);
  }
}
