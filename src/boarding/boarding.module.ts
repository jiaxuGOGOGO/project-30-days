import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BoardingController } from './boarding.controller.js';
import { BoardingService } from './boarding.service.js';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [BoardingController],
  providers: [BoardingService],
  exports: [BoardingService],
})
export class BoardingModule {}
