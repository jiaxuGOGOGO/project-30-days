import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCESS_POLICY, type AccessPolicy, type SessionPrincipal } from './access.js';
import { SessionService } from './session.service.js';

interface HttpRequest {
  headers: { authorization?: string };
  body?: Record<string, unknown>;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  principal?: SessionPrincipal;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly sessions: SessionService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') throw new ForbiddenException('Transport unavailable');
    const policy = this.reflector.getAllAndOverride<AccessPolicy>(ACCESS_POLICY, [context.getHandler(), context.getClass()]);
    const http = context.switchToHttp();
    http.getResponse<{ setHeader(name: string, value: string): void }>().setHeader('Cache-Control', 'no-store');
    if (policy === 'public') return true;
    const request = http.getRequest<HttpRequest>();
    const principal = await this.sessions.authenticate(request.headers.authorization);
    request.principal = principal;
    if (!policy || policy === 'disabled') throw new ForbiddenException('Feature unavailable pending authorization prerequisites');

    // Compatibility aliases are never a source of identity; mismatches are rejected.
    for (const source of [request.params, request.query, request.body]) {
      if (source === undefined) continue;
      if (source === null || typeof source !== 'object' || Array.isArray(source)) throw new BadRequestException('Expected an object');
      for (const key of ['userId', 'actorUserId', 'observerUserId']) {
        if (Object.hasOwn(source, key) && source[key] !== principal.userId) throw new ForbiddenException('Identity mismatch');
      }
    }
    if (policy === 'connection') {
      const id = request.params.connectionId ?? request.body?.connectionId;
      if (typeof id !== 'string' || !isUUID(id)) throw new BadRequestException('Invalid connectionId');
      const connection = await this.prisma.connection.findFirst({
        where: { id, status: { not: 'DESTROYED' }, destroyed_at: null,
          room: { status: { not: 'DESTROYED' } },
          OR: [{ user_a_id: principal.userId }, { user_b_id: principal.userId }] },
        select: { id: true },
      });
      // Same response for nonexistent, closed and someone else's relationship.
      if (!connection) throw new NotFoundException('Connection unavailable');
    }
    return true;
  }
}
