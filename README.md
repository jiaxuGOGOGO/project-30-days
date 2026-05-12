# Project 30-Days

ACKNOWLEDGED. BEGINNING PHASE 1.

本仓库当前完成上传指令中的 **PHASE 1: DB SCHEMA & PRISMA MODEL**。它为匿名限时社交系统定义了 PostgreSQL 数据模型、Prisma Schema、Redis/PostgreSQL 本地开发环境，以及 10 条具有高人性冲突强度的 FateCard 种子数据。

## 当前交付范围

| 文件 | 作用 |
|---|---|
| `prisma/schema.prisma` | 定义 User、InstanceRoom、FateCard、Connection 及所需枚举、关系与索引。 |
| `prisma/migrations/000001_phase1_init/migration.sql` | 使用 PostgreSQL 原生 CHECK、FOREIGN KEY、UNIQUE INDEX 约束补强 Prisma Schema，严格保证房间 `end_date = start_date + 30 days`。 |
| `prisma/seed.ts` | 写入 10 条 FateCard 两难题种子数据，并包含数量完整性校验与错误处理。 |
| `docker-compose.yml` | 启动 PostgreSQL 16 与 Redis 7，本地保留持久化卷与健康检查。 |
| `.env.example` | 提供数据库与 Redis 连接字符串示例，不提交真实环境变量。 |

## 快速启动

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm prisma:validate
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
```

## 数据模型要点

`User` 以 `wechat_openid` 作为唯一微信身份键，拥有 `shadow_video_url`、默认 `fire_points = 3`、`role = ACTIVE` 与创建时间。`InstanceRoom` 使用数据库级 CHECK 约束强制 `end_date` 必须等于 `start_date + interval '30 days'`，并将 `max_users` 限制在 1 到 100 之间。`Connection` 表保存双人羁绊状态机，从 `YOMI_MATCHING` 到 `SANDGLASS_24H`、`DEEP_LINK`、`JUDGMENT` 与 `DESTROYED`，并通过部分唯一索引避免同一房间内同一对用户产生多个非销毁连接。

> PHASE 2 将在此数据模型基础上实现 Redis 双盲匹配锁、NestJS 定时状态机与 WebSocket 事件触发。
