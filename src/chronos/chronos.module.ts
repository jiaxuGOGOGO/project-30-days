import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { ChronosService } from './chronos.service.js';

@Module({
  imports: [EventsModule],
  providers: [ChronosService],
  exports: [ChronosService],
})
export class ChronosModule {}
