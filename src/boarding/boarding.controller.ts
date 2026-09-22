import { Access } from '../auth/access.js';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { BoardingService, JoinBoardingDto } from './boarding.service.js';

@Controller('boarding')
@Access('session')
export class BoardingController {
  constructor(private readonly boardingService: BoardingService) {}

  @Get('current')
  async getCurrentBoardingRoom() {
    return this.boardingService.getOrCreateBoardingRoom();
  }

  @Post('join')
  @Access('disabled')
  async joinBoarding(@Body() dto: JoinBoardingDto) {
    return this.boardingService.joinBoarding(dto);
  }
}
