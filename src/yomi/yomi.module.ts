import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { YomiController } from './yomi.controller.js';
import { YomiService } from './yomi.service.js';

@Module({
  imports: [EventsModule],
  controllers: [YomiController],
  providers: [YomiService],
  exports: [YomiService],
})
export class YomiModule {}
