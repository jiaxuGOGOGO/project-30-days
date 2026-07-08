import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SeasonController } from './season.controller.js';
import { SeasonService } from './season.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [SeasonController],
  providers: [SeasonService],
  exports: [SeasonService],
})
export class SeasonModule {}
