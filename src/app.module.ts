import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BoardingModule } from './boarding/boarding.module.js';
import { ChronosModule } from './chronos/chronos.module.js';
import { DailyEchoModule } from './daily-echo/daily-echo.module.js';
import { Day30Module } from './day30/day30.module.js';
import { EventsModule } from './events/events.module.js';
import { HourglassModule } from './hourglass/hourglass.module.js';
import { MediaModule } from './media/media.module.js';
import { ObserverModule } from './observer/observer.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { SeasonModule } from './season/season.module.js';
import { StardustTicketModule } from './stardust-ticket/stardust-ticket.module.js';
import { YomiModule } from './yomi/yomi.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '.env.local'] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    EventsModule,
    YomiModule,
    ChronosModule,
    Day30Module,
    DailyEchoModule,
    BoardingModule,
    MediaModule,
    HourglassModule,
    ObserverModule,
    SeasonModule,
    StardustTicketModule,
  ],
})
export class AppModule {}
