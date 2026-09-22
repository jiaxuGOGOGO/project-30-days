import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Access, CurrentUser, type SessionPrincipal } from './access.js';
import { ActorQueryDto } from './request.dto.js';
import { SessionService } from './session.service.js';

@Controller('auth')
@Access('session')
export class AuthController {
  constructor(private readonly sessions: SessionService) {}

  @Get('session')
  current(@CurrentUser() principal: SessionPrincipal) {
    return { userId: principal.userId, expiresAt: principal.expiresAt };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() _body: ActorQueryDto, @CurrentUser() principal: SessionPrincipal) {
    await this.sessions.revoke(principal);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@Body() _body: ActorQueryDto, @CurrentUser() principal: SessionPrincipal) {
    await this.sessions.revoke(principal, true);
  }
}
