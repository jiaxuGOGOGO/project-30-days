import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DailyEchoService, SubmitEchoAnswerDto } from './daily-echo.service.js';

@Controller('daily-echo')
export class DailyEchoController {
  constructor(private readonly dailyEchoService: DailyEchoService) {}

  @Post('answer')
  async submitAnswer(@Body() dto: SubmitEchoAnswerDto) {
    return this.dailyEchoService.submitAnswer(dto);
  }

  @Get('current/:connectionId')
  async getCurrentEcho(
    @Param('connectionId') connectionId: string,
    @Query('userId') userId: string,
  ) {
    return this.dailyEchoService.getCurrentEcho(connectionId, userId);
  }

  @Get('history/:connectionId')
  async getEchoHistory(
    @Param('connectionId') connectionId: string,
    @Query('userId') userId: string,
  ) {
    return this.dailyEchoService.getEchoHistory(connectionId, userId);
  }
}
