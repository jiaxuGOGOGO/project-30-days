import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Media Service
 *
 * Phase 0 Security: Server-side video privacy protection.
 *
 * Architecture:
 * 1. User uploads original video → stored encrypted in object storage
 * 2. Server generates 4 pre-processed variants at different blur levels
 * 3. Client only receives signed temporary URLs for the appropriate level
 * 4. Original video URL is NEVER exposed to the client until Day 30 (FULL reveal)
 * 5. When connection is DESTROYED, all video assets are scheduled for deletion
 *
 * Reveal Level Mapping:
 *   - SILHOUETTE (Day 1-6):   High-contrast silhouette, no identifiable features
 *   - FROSTED (Day 7-14):     Heavy Gaussian blur (radius 30px equivalent)
 *   - NEAR (Day 15-29):       Light blur (radius 8px equivalent), partial color
 *   - FULL (Day 30):          Original video with temporary signed URL
 */

export type RevealLevel = 'SILHOUETTE' | 'FROSTED' | 'NEAR' | 'FULL';

export interface VideoVariant {
  level: RevealLevel;
  /** Storage key for this variant (e.g., "videos/{userId}/frosted.mp4") */
  storageKey: string;
}

export interface SignedVideoUrl {
  url: string;
  level: RevealLevel;
  expiresAt: string;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly storageBucket: string;
  private readonly signedUrlTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.storageBucket = this.configService.get<string>('MEDIA_STORAGE_BUCKET', 'project30-media');
    this.signedUrlTtlSeconds = this.configService.get<number>('SIGNED_URL_TTL_SECONDS', 3600);
  }

  /**
   * Determine the reveal level based on connected_days.
   */
  resolveRevealLevel(connectedDays: number): RevealLevel {
    if (connectedDays <= 6) return 'SILHOUETTE';
    if (connectedDays <= 14) return 'FROSTED';
    if (connectedDays <= 29) return 'NEAR';
    return 'FULL';
  }

  /**
   * Get a signed video URL for the appropriate reveal level.
   * This is the ONLY way the frontend can access video content.
   */
  async getVideoUrl(connectionId: string, requestingUserId: string): Promise<SignedVideoUrl> {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
      include: { user_a: true, user_b: true },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    // Determine which user's video to show (show the OTHER user's video)
    const isUserA = connection.user_a_id === requestingUserId;
    const isUserB = connection.user_b_id === requestingUserId;
    if (!isUserA && !isUserB) {
      throw new NotFoundException('User is not part of this connection');
    }

    const targetUser = isUserA ? connection.user_b : connection.user_a;

    // Check if video has been destroyed
    if (targetUser.video_destroyed_at) {
      throw new NotFoundException('Video has been destroyed');
    }

    const level = this.resolveRevealLevel(connection.connected_days);
    const storageKey = this.buildStorageKey(targetUser.id, level);
    const expiresAt = new Date(Date.now() + this.signedUrlTtlSeconds * 1000);

    // Generate signed URL (implementation depends on cloud provider)
    const url = await this.generateSignedUrl(storageKey, this.signedUrlTtlSeconds);

    return {
      url,
      level,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Process uploaded video into 4 blur-level variants.
   * Called after user uploads their shadow video.
   *
   * In production, this would invoke a cloud media processing service
   * (e.g., Tencent Cloud MPS, AWS MediaConvert, or FFmpeg on a worker).
   */
  async processVideoVariants(userId: string, originalVideoUrl: string): Promise<VideoVariant[]> {
    const variants: VideoVariant[] = [
      { level: 'SILHOUETTE', storageKey: this.buildStorageKey(userId, 'SILHOUETTE') },
      { level: 'FROSTED', storageKey: this.buildStorageKey(userId, 'FROSTED') },
      { level: 'NEAR', storageKey: this.buildStorageKey(userId, 'NEAR') },
      { level: 'FULL', storageKey: this.buildStorageKey(userId, 'FULL') },
    ];

    // TODO: In production, submit transcoding jobs to cloud media service
    // Each job applies different blur/filter levels:
    //   SILHOUETTE: -vf "colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3,threshold"
    //   FROSTED:    -vf "boxblur=30:5,hue=s=0"
    //   NEAR:       -vf "boxblur=8:3,hue=s=0.6"
    //   FULL:       Copy original (encrypted at rest)

    this.logger.log(`Queued video processing for user ${userId}: 4 variants`);
    return variants;
  }

  /**
   * Destroy all video variants for a user.
   * Called when connection is DESTROYED or user requests deletion.
   */
  async destroyUserVideos(userId: string): Promise<void> {
    const levels: RevealLevel[] = ['SILHOUETTE', 'FROSTED', 'NEAR', 'FULL'];
    const keys = levels.map((level) => this.buildStorageKey(userId, level));

    // TODO: In production, delete objects from cloud storage
    // await Promise.all(keys.map(key => this.storageClient.deleteObject(key)));

    await this.prisma.user.update({
      where: { id: userId },
      data: { video_destroyed_at: new Date() },
    });

    this.logger.log(`Destroyed all video variants for user ${userId}`);
  }

  /**
   * Destroy videos for both users in a destroyed connection.
   */
  async destroyConnectionVideos(connectionId: string): Promise<void> {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection || connection.status !== ConnectionStatus.DESTROYED) {
      return;
    }

    await Promise.all([
      this.destroyUserVideos(connection.user_a_id),
      this.destroyUserVideos(connection.user_b_id),
    ]);
  }

  private buildStorageKey(userId: string, level: RevealLevel): string {
    return `videos/${userId}/${level.toLowerCase()}.mp4`;
  }

  /**
   * Generate a signed URL for a storage object.
   * In production, this would use the cloud provider's SDK.
   */
  private async generateSignedUrl(storageKey: string, ttlSeconds: number): Promise<string> {
    // TODO: Replace with actual cloud storage signed URL generation
    // Example for Tencent Cloud COS:
    //   const cosClient = new COS({ SecretId, SecretKey });
    //   return cosClient.getObjectUrl({ Bucket, Region, Key: storageKey, Sign: true, Expires: ttlSeconds });
    //
    // Example for AWS S3:
    //   const command = new GetObjectCommand({ Bucket: this.storageBucket, Key: storageKey });
    //   return getSignedUrl(s3Client, command, { expiresIn: ttlSeconds });

    const expires = Date.now() + ttlSeconds * 1000;
    const signature = Buffer.from(`${storageKey}:${expires}`).toString('base64url');
    return `https://${this.storageBucket}.cos.ap-shanghai.myqcloud.com/${storageKey}?sign=${signature}&expires=${expires}`;
  }
}
