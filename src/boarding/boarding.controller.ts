import { Body, Controller, Get, Post } from '@nestjs/common';
import { BoardingService, JoinBoardingDto } from './boarding.service.js';

@Controller('boarding')
export class BoardingController {
  constructor(private readonly boardingService: BoardingService) {}

  @Get('current')
  async getCurrentBoardingRoom() {
    return this.boardingService.getOrCreateBoardingRoom();
  }

  @Post('join')
  async joinBoarding(@Body() dto: JoinBoardingDto) {
    return this.boardingService.joinBoarding(dto);
  }
}
