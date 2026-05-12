# Project 30-Days

ACKNOWLEDGED. PHASE 1 COMPLETE. PHASE 2 COMPLETE.

本仓库当前完成上传指令中的 **PHASE 1: DB SCHEMA & PRISMA MODEL** 与 **PHASE 2: BACKEND STATE MACHINE & DOUBLE-BLIND MATCHING**。项目为匿名限时社交系统定义 PostgreSQL/Prisma 数据层、Redis/PostgreSQL 本地开发环境、10 条 FateCard 种子数据，并实现 NestJS 后端中的 Redis 双盲匹配锁、24 小时沙漏状态机、第 15 天角色坍缩、每日聊天模式切换与 WebSocket 事件广播。

## 当前交付范围

| 文件或目录 | 作用 |
|---|---|
| `prisma/schema.prisma` | 定义 User、InstanceRoom、FateCard、Connection 及所需枚举、关系与索引。 |
| `prisma/migrations/000001_phase1_init/migration.sql` | 使用 PostgreSQL 原生 CHECK、FOREIGN KEY、UNIQUE INDEX 约束补强 Prisma Schema，严格保证房间 `end_date = start_date + 30 days`。 |
| `prisma/seed.ts` | 写入 10 条 FateCard 两难题种子数据，并包含数量完整性校验与错误处理。 |
| `docker-compose.yml` | 启动 PostgreSQL 16 与 Redis 7，本地保留持久化卷与健康检查。 |
| `src/yomi` | 提供 FateCard 双盲答案提交接口、Redis 24 小时答案缓存、成对分布式锁与 12 小时冷却黑名单。 |
| `src/chronos` | 提供 NestJS 定时状态机：沙漏 24 小时过期碎裂、Deep Link 每日天数递增、第 15 天未连接用户坍缩为 WATCHER、8/20 点聊天模式切换。 |
| `src/events` | 提供 `/events` WebSocket 命名空间，支持房间加入与状态事件广播。 |
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
pnpm start:dev
```

## PHASE 2 API

`POST /yomi/answers` 用于提交双盲 FateCard 答案。当 A 对 B 提交答案时，服务会将该答案写入 Redis 并设置 24 小时 TTL；当 B 对 A 提交答案时，服务在成对分布式锁保护下读取双方答案并比对。若答案一致，服务在 PostgreSQL 事务中创建或更新 `SANDGLASS_24H` 连接，并触发 `matching:succeeded` 事件；若答案不一致，服务会清除双方临时答案并写入 12 小时有向冷却黑名单，同时触发 `matching:failed` 事件。

```json
{
  "roomId": "00000000-0000-4000-8000-000000000001",
  "actorUserId": "00000000-0000-4000-8000-000000000002",
  "targetUserId": "00000000-0000-4000-8000-000000000003",
  "fateCardId": "00000000-0000-4000-8000-000000000004",
  "selectedOption": "A"
}
```

## 定时状态机

| Cron 表达式 | 行为 |
|---|---|
| `*/1 * * * *` | 每分钟扫描 `SANDGLASS_24H` 且 `sandglass_started_at` 已超过 24 小时的连接，将其更新为 `DESTROYED` 并广播 `connection:shattered`。 |
| `0 0 * * *` | 每天零点递增 `DEEP_LINK` 连接的 `connected_days`，并在房间到达第 15 天后把未进入 `DEEP_LINK` 的 ACTIVE 用户坍缩为 `WATCHER`。 |
| `0 8,20 * * *` | 每天 08:00 将 Redis `CHAT_MODE` 设置为 `ICE`，每天 20:00 设置为 `FIRE`，并广播 `chat:mode-updated`。 |

## 数据模型要点

`User` 以 `wechat_openid` 作为唯一微信身份键，拥有 `shadow_video_url`、默认 `fire_points = 3`、`role = ACTIVE` 与创建时间。`InstanceRoom` 使用数据库级 CHECK 约束强制 `end_date` 必须等于 `start_date + interval '30 days'`，并将 `max_users` 限制在 1 到 100 之间。`Connection` 表保存双人羁绊状态机，从 `YOMI_MATCHING` 到 `SANDGLASS_24H`、`DEEP_LINK`、`JUDGMENT` 与 `DESTROYED`，并通过部分唯一索引避免同一房间内同一对用户产生多个非销毁连接。

## 验证命令

```bash
pnpm prisma:validate
pnpm prisma:generate
pnpm typecheck
pnpm build
```
