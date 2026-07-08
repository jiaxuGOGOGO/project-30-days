import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { HourglassService, UseFreezeDto } from './hourglass.service.js';

@Controller('hourglass')
export class HourglassController {
  constructor(private readonly hourglassService: HourglassService) {}

  /**
   * Use one hourglass freeze for today.
   * POST /hourglass/freeze
   */
  @Post('freeze')
  async useFreeze(@Body() dto: UseFreezeDto) {
    return this.hourglassService.useFreeze(dto);
  }

  /**
   * Get freeze status for a user in a connection.
   * GET /hourglass/status/:connectionId?userId=xxx
   */
  @Get('status/:connectionId')
  async getFreezeStatus(
    @Param('connectionId') connectionId: string,
    @Query('userId') userId: string,
  ) {
    return this.hourglassService.getFreezeStatus(userId, connectionId);
  }
}
