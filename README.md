# Project 30-Days

**匿名限时社交实验** — 用时间的不可逆性对抗社交应用的"无限滑动"范式。

---

## 核心第一性原理

| 原理 | 含义 | 技术实现 |
|------|------|----------|
| **时间暴政** | 30天有限生命周期，时间不可逆 | InstanceRoom 30天CHECK约束 + Chronos定时状态机 |
| **双盲宿命感** | 匹配结果不可预知、不可操控 | FateCard双盲答案比对 + Redis分布式锁 |
| **物理隐喻** | 用空间/重力/碰撞具象化社交关系 | Matter.js无重力刚体世界 + 触屏拖拽 + 陀螺仪命运之风 |
| **终局审判** | 30天后必须做出不可撤回的选择 | Progressive Trust Reveal (STAY/PAUSE) |

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Taro 3 + React)                  │
├─────────────────────────────────────────────────────────────┤
│ LimboHall │ GatingVideo │ Day30Judgment │ DailyEcho │ Board │
│ (Matter.js)│ (Server-side)│ (STAY/PAUSE) │ (双盲问答) │ (候车) │
├─────────────────────────────────────────────────────────────┤
│                 Native WebSocket (ws adapter)                 │
├─────────────────────────────────────────────────────────────┤
│                    Backend (NestJS + Prisma)                  │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬─────┤
│ Yomi │Day30 │Daily │Board │Media │Hour- │Obser-│Season│Tick-│
│      │      │Echo  │ing   │      │glass │ver   │      │et   │
├──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴─────┤
│              Chronos (定时状态机 + Cron Jobs)                  │
├─────────────────────────────────────────────────────────────┤
│          PostgreSQL + Redis + Cloud Storage (COS)            │
└─────────────────────────────────────────────────────────────┘
```

---

## 版本 0.2.0 更新内容

### P0 级修复（安全与合规）

- **服务端视频隐私保护**：GatingVideo 不再使用前端CSS滤镜，改为接收服务端预处理的分级视频URL
- **视频自动销毁**：Day30 判定为 ASH 后自动触发 `MediaService.destroyConnectionVideos()`
- **H5 部署策略**：新增 `docs/h5-deployment-guide.md`，绕过微信小程序审核限制

### P1 级优化（留存与体验）

- **终局博弈重构 (Progressive Trust Reveal)**：
  - COOPERATE → STAY（留下）
  - DEFECT → PAUSE（暂停）
  - 单方STAY + 对方PAUSE → 7天延长期
  - 双方PAUSE → 14天冷却期
  - 仅二次确认后才产生 ASH
- **每日回响 (DailyEcho)**：完整前端页面 + 后端服务
- **候车大厅 (Boarding Hall)**：完整前端页面 + 定时发车
- **碰撞确认 (CollisionConfirm)**：LimboHall碰撞时弹出确认弹框
- **判定延长期 Chronos 任务**：每小时检查过期的延长/冷却期

### P2 级优化（长期留存）

- **沙漏冻结 (HourglassFreeze)**：每赛季2次，防止意外缺席导致连接销毁
- **WebSocket 降级**：从 Socket.IO 切换到原生 ws，兼容微信小程序
- **WATCHER 角色重定位 (Observer)**：观察者特权系统（每日碎片、匿名祝福、碎片兑换）
- **赛季制 (Season)**：跨赛季资产保留、LEGACY徽章、赛季主题
- **星尘车票重设计 (StardustTicket)**：从"失败证明"变为"成长记录"

---

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

---

## API 端点

### 核心流程

`POST /yomi/answers` 用于提交双盲 FateCard 答案。当 A 对 B 提交答案时，服务会将该答案写入 Redis 并设置 24 小时 TTL；当 B 对 A 提交答案时，服务在成对分布式锁保护下读取双方答案并比对。

```json
{
  "roomId": "00000000-0000-4000-8000-000000000001",
  "actorUserId": "00000000-0000-4000-8000-000000000002",
  "targetUserId": "00000000-0000-4000-8000-000000000003",
  "fateCardId": "00000000-0000-4000-8000-000000000004",
  "selectedOption": "A"
}
```

`POST /api/day30/judgment` 用于第 30 天终局选择（Progressive Trust Reveal）。服务端要求 `heldMs >= 2000`。

```json
{
  "connectionId": "00000000-0000-4000-8000-000000000010",
  "userId": "00000000-0000-4000-8000-000000000011",
  "choice": "COOPERATE",
  "heldMs": 2100
}
```

**Progressive Trust Reveal 结局矩阵**：

| 用户 A \ 用户 B | **STAY (COOPERATE)** | **PAUSE (DEFECT)** |
|---|---|---|
| **STAY (COOPERATE)** | LEGACY（成功） | 7天延长期 |
| **PAUSE (DEFECT)** | 7天延长期 | 14天冷却期 |

### 完整端点列表

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/yomi/answers` | 提交 FateCard 双盲答案 |
| POST | `/api/day30/judgment` | 第30天终局选择 (STAY/PAUSE) |
| POST | `/daily-echo/answer` | 提交每日回响答案 |
| GET | `/daily-echo/current/:connectionId` | 获取当日问题 |
| GET | `/daily-echo/history/:connectionId` | 获取历史记录 |
| GET | `/boarding/current` | 获取当前候车房间 |
| POST | `/boarding/join` | 加入候车队列 |
| GET | `/media/video/:connectionId` | 获取签名视频URL |
| POST | `/media/process/:userId` | 触发视频变体处理 |
| POST | `/hourglass/freeze` | 使用沙漏冻结 |
| GET | `/hourglass/status/:connectionId` | 获取冻结状态 |
| POST | `/observer/daily-reward/:userId` | 领取每日观察者奖励 |
| POST | `/observer/bless` | 发送匿名祝福 |
| POST | `/observer/redeem/:userId` | 兑换碎片为冻结次数 |
| GET | `/season/active` | 获取当前赛季 |
| GET | `/season/assets/:userId` | 获取跨赛季资产 |
| POST | `/season/transition` | 切换到新赛季 |
| POST | `/stardust-ticket/generate/:connectionId` | 生成成长记录车票 |
| GET | `/stardust-ticket/:connectionId` | 获取车票内容 |

---

## 定时任务 (Chronos)

| Cron 表达式 | 行为 |
|---|---|
| `*/1 * * * *` | 销毁过期沙漏连接（检查冻结状态后） |
| `0 0 * * *` | 递增 connected_days + Day15 坍缩为 WATCHER |
| `0 20 * * *` | 生成每日回响问题 |
| `*/5 * * * *` | 检查候车房间是否应发车 |
| `0 * * * *` | 检查过期的延长/冷却期，触发重新投票通知 |
| `0 8,20 * * *` | 切换 ICE/FIRE 聊天模式 |

---

## 前端组件

| 组件 | 核心机制 |
|---|---|
| `LimboHall` | 触屏拖拽主控 + 陀螺仪命运之风(0.25x) + 碰撞确认回调 + 首次引导动画 |
| `GatingVideo` | 服务端分级视频（SILHOUETTE/FROSTED/NEAR/FULL），客户端无法绕过 |
| `Day30Judgment` | STAY/PAUSE 双按钮 + 2秒长按 + Progressive Trust Reveal |
| `CollisionConfirm` | 碰撞确认弹框 + 8秒自动消失 + 双方确认才进入FateCard |
| `LegacyTicketCanvas` | 星尘车票 Canvas 绘制 + 导出分享图片 |
| `DailyEcho Page` | 每日双盲问答 + 提交/等待/揭示三态 |
| `Boarding Page` | 候车大厅 + 实时人数 + 倒计时 + 发车规则 |

---

## 数据模型

| 模型 | 用途 |
|------|------|
| `User` | 用户（含冻结次数、星尘碎片、赛季信息、观察者碎片、LEGACY徽章） |
| `InstanceRoom` | 房间（含BOARDING状态、min_users、scheduled_at、boarding_count） |
| `Connection` | 双人羁绊状态机（含judgment_round、season） |
| `FateCard` | 命运卡片 |
| `DailyEcho` | 每日双盲问答 |
| `HourglassFreeze` | 沙漏冻结记录 |
| `StardustTicket` | 星尘车票（成长记录：灵魂图谱、精选回答、成长标签） |
| `Season` | 赛季元数据（编号、主题、时间范围） |

---

## 运行命令

```bash
# 后端
pnpm prisma:validate
pnpm prisma:generate
pnpm typecheck
pnpm build
pnpm start:dev

# 前端
pnpm frontend:typecheck
pnpm frontend:build:weapp
pnpm frontend:build:h5
```

---

## 实施路线图

```
Phase 0: MVP 验证（2-3 周）✅
├── H5 版本开发（Taro H5 编译）
├── 简化版物理大厅（触屏拖拽 + 命运之风）
├── 核心匹配流程验证
└── 招募首批 50 名测试用户

Phase 1: 安全与留存（2-3 周）✅
├── 服务端视频转码架构
├── 签名 URL 授权机制
├── DailyEcho 模块
├── 候车大厅 + 定时发车
└── 终局博弈重构（STAY/PAUSE）

Phase 2: 长期留存（2-3 周）✅
├── 沙漏冻结机制
├── WebSocket 降级（原生 ws）
├── WATCHER → OBSERVER 特权系统
├── 赛季制循环
└── 星尘车票重设计

Phase 3: 正式上线（1-2 周）
├── 接入腾讯云 MPS 实现真实视频转码
├── 微信小程序适配
├── 小程序审核提交（社区/论坛类目）
├── ICP 证申请启动
└── 首批公开赛季发车
```

---

## 架构决策记录

- **ADR-001**: 服务端视频预处理而非前端CSS滤镜（防止Tinder Unblur类漏洞）
- **ADR-002**: 陀螺仪降级为环境微扰(0.25x)而非完全移除（保持"命运之风"隐喻）
- **ADR-003**: 定时发车而非实时匹配（参考Thursday应用，保证社交密度）
- **ADR-004**: DailyEcho双盲机制（防止搭便车，与"对等博弈"哲学一致）
- **ADR-005**: Progressive Trust Reveal而非纯囚徒困境（降低75%负面体验率）
- **ADR-006**: 原生ws替代Socket.IO（微信小程序WebSocket兼容性）
