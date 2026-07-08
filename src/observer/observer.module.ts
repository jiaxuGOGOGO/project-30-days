import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ObserverController } from './observer.controller.js';
import { ObserverService } from './observer.service.js';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [ObserverController],
  providers: [ObserverService],
  exports: [ObserverService],
})
export class ObserverModule {}
