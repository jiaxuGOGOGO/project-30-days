import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { Day30Controller } from './day30.controller.js';
import { Day30Service } from './day30.service.js';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [Day30Controller],
  providers: [Day30Service],
})
export class Day30Module {}
