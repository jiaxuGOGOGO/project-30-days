import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type AccessPolicy = 'public' | 'session' | 'self' | 'connection' | 'disabled';
export const ACCESS_POLICY = 'app:access-policy';
// Missing metadata is deliberately denied by the global guard.
export const Access = (policy: AccessPolicy) => SetMetadata(ACCESS_POLICY, policy);
export interface SessionPrincipal {
  sessionId: string;
  userId: string;
  expiresAt: Date;
}
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): SessionPrincipal =>
  context.switchToHttp().getRequest<{ principal: SessionPrincipal }>().principal,
);
