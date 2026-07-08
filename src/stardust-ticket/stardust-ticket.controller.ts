import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { StardustTicketService } from './stardust-ticket.service.js';

@Controller('stardust-ticket')
export class StardustTicketController {
  constructor(private readonly ticketService: StardustTicketService) {}

  /**
   * Generate a stardust ticket for a completed connection.
   * POST /stardust-ticket/generate/:connectionId?userId=xxx
   */
  @Post('generate/:connectionId')
  async generateTicket(
    @Param('connectionId') connectionId: string,
    @Query('userId') userId: string,
  ) {
    return this.ticketService.generateTicket(userId, connectionId);
  }

  /**
   * Get existing ticket for a user-connection pair.
   * GET /stardust-ticket/:connectionId?userId=xxx
   */
  @Get(':connectionId')
  async getTicket(
    @Param('connectionId') connectionId: string,
    @Query('userId') userId: string,
  ) {
    return this.ticketService.getTicket(userId, connectionId);
  }
}
