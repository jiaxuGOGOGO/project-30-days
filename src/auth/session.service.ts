import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SessionPrincipal } from './access.js';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  // Only a trusted identity provider may call this after verifying identity.
  // U02-A deliberately exposes NO login/issue endpoint and NO dev impersonation switch.
  async issueForVerifiedUser(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await this.prisma.$transaction(async tx => {
      const user = await tx.user.findFirst({ where: { id: userId, auth_disabled_at: null }, select: { id: true } });
      if (!user) throw new UnauthorizedException('Invalid identity');
      await tx.authSession.create({ data: { user_id: user.id, token_hash: this.digest(token), expires_at: expiresAt } });
    });
    return { token, expiresAt };
  }

  async authenticate(header: unknown): Promise<SessionPrincipal> {
    if (typeof header !== 'string') throw new UnauthorizedException('Session required');
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(header);
    if (!match?.[1]) throw new UnauthorizedException('Invalid session');
    const session = await this.prisma.authSession.findFirst({
      where: { token_hash: this.digest(match[1]), revoked_at: null, expires_at: { gt: new Date() }, user: { auth_disabled_at: null } },
      select: { id: true, user_id: true, expires_at: true },
    });
    if (!session) throw new UnauthorizedException('Invalid session');
    return { sessionId: session.id, userId: session.user_id, expiresAt: session.expires_at };
  }

  async revoke(principal: SessionPrincipal, all = false): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { user_id: principal.userId, ...(all ? {} : { id: principal.sessionId }), revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  private digest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
}
