import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DailyEchoController } from './daily-echo.controller.js';
import { DailyEchoService } from './daily-echo.service.js';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [DailyEchoController],
  providers: [DailyEchoService],
  exports: [DailyEchoService],
})
export class DailyEchoModule {}
