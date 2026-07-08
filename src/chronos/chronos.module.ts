import { Module } from '@nestjs/common';
import { BoardingModule } from '../boarding/boarding.module.js';
import { DailyEchoModule } from '../daily-echo/daily-echo.module.js';
import { EventsModule } from '../events/events.module.js';
import { HourglassModule } from '../hourglass/hourglass.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { ChronosService } from './chronos.service.js';

@Module({
  imports: [EventsModule, PrismaModule, RedisModule, DailyEchoModule, BoardingModule, HourglassModule],
  providers: [ChronosService],
  exports: [ChronosService],
})
export class ChronosModule {}
