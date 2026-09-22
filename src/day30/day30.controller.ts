import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Access, CurrentUser, type SessionPrincipal } from '../auth/access.js';
import { JudgmentRequestDto } from '../auth/request.dto.js';
import { Day30JudgmentResponse, Day30Service } from './day30.service.js';

@Controller('api/day30')
@Access('connection')
export class Day30Controller {
  constructor(private readonly day30Service: Day30Service) {}

  @Post('judgment')
  @HttpCode(200)
  async submitJudgment(@Body() dto: JudgmentRequestDto, @CurrentUser() actor: SessionPrincipal): Promise<Day30JudgmentResponse> {
    return this.day30Service.submitJudgment({ ...dto, userId: actor.userId });
  }
}
