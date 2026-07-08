import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'ws';

/**
 * P2 WebSocket Degradation:
 * Migrated from Socket.IO to native ws for WeChat mini-program compatibility.
 *
 * Native ws doesn't have built-in "rooms", so we implement a lightweight
 * room subscription system using a Map<roomChannel, Set<WebSocket>>.
 */

interface WsClient {
  send: (data: string) => void;
  readyState: number;
  _rooms?: Set<string>;
}

interface RoomJoinPayload {
  roomId: string;
}

@WebSocketGateway({ cors: true, path: '/events' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  private server!: Server;

  /** Room subscriptions: roomChannel → Set of connected clients */
  private rooms = new Map<string, Set<WsClient>>();

  handleConnection(client: WsClient): void {
    (client as any)._rooms = new Set<string>();
    this.logger.debug('ws client connected');
  }

  handleDisconnect(client: WsClient): void {
    // Remove client from all rooms
    const clientRooms = (client as any)._rooms as Set<string> | undefined;
    if (clientRooms) {
      for (const room of clientRooms) {
        const roomSet = this.rooms.get(room);
        if (roomSet) {
          roomSet.delete(client);
          if (roomSet.size === 0) {
            this.rooms.delete(room);
          }
        }
      }
    }
    this.logger.debug('ws client disconnected');
  }

  @SubscribeMessage('room:join')
  handleRoomJoin(@MessageBody() payload: RoomJoinPayload, @ConnectedSocket() client: WsClient): { joined: string } {
    if (!payload?.roomId || payload.roomId.trim().length === 0) {
      throw new Error('roomId is required');
    }
    const roomChannel = this.roomChannel(payload.roomId);

    // Add client to room
    if (!this.rooms.has(roomChannel)) {
      this.rooms.set(roomChannel, new Set());
    }
    this.rooms.get(roomChannel)!.add(client);

    // Track rooms on client
    const clientRooms = (client as any)._rooms as Set<string>;
    clientRooms.add(roomChannel);

    return { joined: roomChannel };
  }

  // --- Broadcast helper ---

  private broadcastToRoom(roomChannel: string, event: string, payload: Record<string, unknown>): void {
    const roomClients = this.rooms.get(roomChannel);
    if (!roomClients || roomClients.size === 0) return;

    const message = JSON.stringify({ event, data: payload });
    for (const client of roomClients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(message);
        } catch {
          // Client disconnected, will be cleaned up on disconnect
        }
      }
    }
  }

  // --- Matching Events ---

  emitMatchingSucceeded(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'matching:succeeded', payload);
  }

  emitMatchingFailed(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'matching:failed', payload);
  }

  // --- Connection Lifecycle Events ---

  emitConnectionShattered(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'connection:shattered', payload);
  }

  emitRoleCollapsed(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'room:role-collapsed', payload);
  }

  emitChatModeUpdated(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'chat:mode-updated', payload);
  }

  // --- Day 30 Events ---

  emitDay30JudgmentResult(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'day30:judgment-result', payload);
  }

  // --- Daily Echo Events ---

  /** Emitted when a daily echo prompt is created for a connection */
  emitDailyEchoCreated(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'daily-echo:created', payload);
  }

  /** Emitted when both users have answered a daily echo */
  emitDailyEchoCompleted(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'daily-echo:completed', payload);
  }

  // --- Boarding Events ---

  /** Emitted when a boarding room's user count changes */
  emitBoardingUpdate(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'boarding:update', payload);
  }

  /** Emitted when a boarding room transitions to RUNNING */
  emitRoomDeparted(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'room:departed', payload);
  }

  // --- P2: Hourglass Freeze Events ---

  /** Emitted when a user uses an hourglass freeze */
  emitHourglassFrozen(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'hourglass:frozen', payload);
  }

  // --- P2: Observer Events ---

  /** Emitted when an observer sends a blessing to an active connection */
  emitObserverBlessing(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'observer:blessing', payload);
  }

  // --- P1: Extension/Cooldown Events ---

  /** Emitted when a judgment enters extension or cooldown period */
  emitJudgmentExtension(roomId: string, payload: Record<string, unknown>): void {
    this.broadcastToRoom(this.roomChannel(roomId), 'judgment:extension', payload);
  }

  private roomChannel(roomId: string): string {
    return `room:${roomId}`;
  }
}
