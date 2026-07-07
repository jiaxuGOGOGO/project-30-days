import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface RoomJoinPayload {
  roomId: string;
}

@WebSocketGateway({ cors: true, namespace: '/events' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  private server!: Server;

  handleConnection(client: Socket): void {
    this.logger.debug(`socket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`socket disconnected: ${client.id}`);
  }

  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @SubscribeMessage('room:join')
  async handleRoomJoin(@MessageBody() payload: RoomJoinPayload, @ConnectedSocket() client: Socket): Promise<{ joined: string }> {
    if (!payload.roomId || payload.roomId.trim().length === 0) {
      throw new Error('roomId is required');
    }
    const roomChannel = this.roomChannel(payload.roomId);
    await client.join(roomChannel);
    return { joined: roomChannel };
  }

  // --- Matching Events ---

  emitMatchingSucceeded(roomId: string, payload: Record<string, unknown>): void {
    this.server.to(this.roomChannel(roomId)).emit('matching:succeeded', payload);
  }

  emitMatchingFailed(roomId: string, payload: Record<string, unknown>): void {
    this.server.to(this.roomChannel(roomId)).emit('matching:failed', payload);
  }

  // --- Connection Lifecycle Events ---

  emitConnectionShattered(roomId: string, payload: Record<string, unknown>): void {
    this.server.to(this.roomChannel(roomId)).emit('connection:shattered', payload);
  }

  emitRoleCollapsed(roomId: string, payload: Record<string, unknown>): void {
    this.server.to(this.roomChannel(roomId)).emit('room:role-collapsed', payload);
  }

  emitChatModeUpdated(roomId: string, payload: Record<string, unknown>): void {
    this.server.to(this.roomChannel(roomId)).emit('chat:mode-updated', payload);
  }

  // --- Day 30 Events ---

  emitDay30JudgmentResult(roomId: string, payload: Record<string, unknown>): void {
    this.server.to(this.roomChannel(roomId)).emit('day30:judgment-result', payload);
  }

  // --- Phase 0: Daily Echo Events ---

  /** Emitted when a daily echo prompt is created for a connection */
  emitDailyEchoCreated(roomId: string, payload: Record<string, unknown>): void {
    this.server.to(this.roomChannel(roomId)).emit('daily-echo:created', payload);
  }

  /** Emitted when both users have answered a daily echo */
  emitDailyEchoCompleted(roomId: string, payload: Record<string, unknown>): void {
    this.server.to(this.roomChannel(roomId)).emit('daily-echo:completed', payload);
  }

  // --- Phase 0: Boarding Events ---

  /** Emitted when a boarding room's user count changes */
  emitBoardingUpdate(roomId: string, payload: Record<string, unknown>): void {
    this.server.to(this.roomChannel(roomId)).emit('boarding:update', payload);
  }

  /** Emitted when a boarding room transitions to RUNNING */
  emitRoomDeparted(roomId: string, payload: Record<string, unknown>): void {
    this.server.to(this.roomChannel(roomId)).emit('room:departed', payload);
  }

  private roomChannel(roomId: string): string {
    return `room:${roomId}`;
  }
}
