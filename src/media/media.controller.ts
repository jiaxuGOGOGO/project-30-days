import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MediaService } from './media.service.js';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Get signed video URL for a connection.
   * Returns the appropriate blur-level variant based on connected_days.
   */
  @Get('video/:connectionId')
  async getVideoUrl(
    @Param('connectionId') connectionId: string,
    @Query('userId') userId: string,
  ) {
    return this.mediaService.getVideoUrl(connectionId, userId);
  }

  /**
   * Trigger video variant processing after upload.
   */
  @Post('process/:userId')
  async processVideo(
    @Param('userId') userId: string,
    @Query('originalUrl') originalUrl: string,
  ) {
    return this.mediaService.processVideoVariants(userId, originalUrl);
  }
}
