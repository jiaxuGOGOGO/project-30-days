import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { SessionService } from './session.service.js';
import { SessionGuard } from './session.guard.js';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [SessionService, { provide: APP_GUARD, useClass: SessionGuard }],
  exports: [SessionService],
})
export class AuthModule {}
