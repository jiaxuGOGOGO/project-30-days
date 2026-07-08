import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StardustTicketController } from './stardust-ticket.controller.js';
import { StardustTicketService } from './stardust-ticket.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [StardustTicketController],
  providers: [StardustTicketService],
  exports: [StardustTicketService],
})
export class StardustTicketModule {}
