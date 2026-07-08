import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { HourglassController } from './hourglass.controller.js';
import { HourglassService } from './hourglass.service.js';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [HourglassController],
  providers: [HourglassService],
  exports: [HourglassService],
})
export class HourglassModule {}
