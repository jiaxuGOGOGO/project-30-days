import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Day30JudgmentResponse, Day30Service } from './day30.service.js';
import { SubmitDay30JudgmentDto } from './dto/submit-day30-judgment.dto.js';

@Controller('api/day30')
export class Day30Controller {
  constructor(private readonly day30Service: Day30Service) {}

  @Post('judgment')
  @HttpCode(200)
  async submitJudgment(@Body() dto: SubmitDay30JudgmentDto): Promise<Day30JudgmentResponse> {
    return this.day30Service.submitJudgment(dto);
  }
}
