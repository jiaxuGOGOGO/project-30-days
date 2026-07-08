import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';

/**
 * P2 WebSocket Degradation:
 * Switched from Socket.IO to native ws adapter for better WeChat mini-program compatibility.
 * Socket.IO's long-polling fallback and custom protocol headers cause issues in
 * WeChat's restricted WebSocket environment.
 *
 * Communication strategy:
 * - Physical hall position sync: native WebSocket + binary protocol (2 fps)
 * - State change notifications: WeChat subscription messages + polling
 * - Day 30 judgment sync: native WebSocket (short-lived connection)
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: true });

  // Use native ws adapter instead of Socket.IO for WeChat compatibility
  app.useWebSocketAdapter(new WsAdapter(app));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
