# Project 30-Days

**匿名限时社交实验** — 用时间的不可逆性对抗社交应用的"无限滑动"范式。

---

## Windows 本地自动测试与反馈（先看这里）

你只需安装工具、执行测试、粘贴报告。**无需安装 Node、pnpm、PostgreSQL 或 Redis，不要复制 `.env`，不要运行下面旧快速启动中的 `db:up`。** 这套入口只运行隔离合成测试，不开放网页端口，也不会产生真实登录/社交体验；产品状态见后文。

### 首次准备

1. 安装 [Git for Windows](https://git-scm.com/downloads/win)，安装后重新打开 PowerShell。
2. 按 [Docker 官方 Windows 安装指南](https://docs.docker.com/desktop/setup/install/windows-install/) 安装并启动 Docker Desktop，使用 **WSL 2 / Linux containers**。只安装不启动是不够的。需要启用硬件虚拟化；若提示缺少 WSL，按安装器或微软指南完成安装并重启。Windows 10 是否仍受支持，以 Docker 和微软当前维护要求为准，旧系统建议升级。
3. 建议机器 16GB 内存、Docker 可用内存约 6GB、20GB 空闲磁盘；这是方便安装和构建的建议，不是产品容量指标。首次会从 Docker Hub/npm 下载镜像和依赖，时间取决于网络。
4. 使用普通 PowerShell，在你准备存放测试仓库的位置依次执行（不是在项目网页控制台执行）：

```powershell
git clone --branch genspark_ai_developer https://github.com/jiaxuGOGOGO/project-30-days.git project30-local-check
cd project30-local-check
powershell -NoProfile -ExecutionPolicy Bypass -File .\test\local-check\windows.ps1
```

这里 `ExecutionPolicy Bypass` 仅针对本次 PowerShell 进程，不修改系统全局执行策略。企业机器若有强制策略，应由管理员批准，不绕过管理规定。若 GitHub 要求登录，使用自己的 GitHub 登录，不向聊天提供密码或 Token。

### 运行完后，你只需粘贴这一份文件

```powershell
Get-Content -Raw -Encoding UTF8 .\.local-check\last-report.txt | Set-Clipboard
```

然后回到聊天粘贴。也可以用 `notepad .\.local-check\last-report.txt` 打开后全选复制。**成功或失败都粘贴报告，不必自己判断错误，不要因为 `KNOWN_ISSUES` 重装环境。** 若连脚本都未能启动、没有报告，则粘贴终端错误，先检查不要含账号/密钥。

报告包含提交版本、源码归档 SHA256、运行环境、逐阶段结果、已知/新缺陷、未执行项和清理状态。含生成报告的原始运行目录保留在 `.local-check/p30check.../`，不会提交 Git。只发送 `last-report.txt`；**不要发送 `compose.json`、源码归档、`engine-local-only.log` 或整个目录**。程序会替换常见令牌/数据库连接/宿主路径等信息，但仍请先审阅；不承诺任意新增日志都能完美脱敏。

| 最终状态/退出码 | 含义 | 你怎么做 |
|---|---|---|
| `CHECKS_PASS` / 0 | 本轮已执行检查通过；不等于可以上线 | 粘贴报告 |
| `KNOWN_ISSUES` / 2 | 基线通过，业务探针仍复现已记录问题，当前通常是 9 项 | 粘贴报告，不重装 |
| `REGRESSION` / 1 | 新失败、参考/迁移失败或不完整测试证据；原因仍需诊断 | 粘贴报告 |
| `ENVIRONMENT_BLOCKED` / 3 | Docker、下载、安装等步骤未能完成；也可能需修安装脚本 | 粘贴报告 |
| `INCOMPLETE` / 4 | 测试未完整执行或容器清理失败 | 粘贴报告，并按提示重试清理 |

看报告最后的 **Final result / Compose cleanup**，不要只看某一个 PASS。既有并发缺陷偶尔未复现，也不会自动宣布修好了。

### 之后每次更新再跑

当前开发分支会压缩提交，可能发生非快进更新。测试用户用 detached checkout 跟随远端，不要 `reset --hard` 删除本地改动：

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed; stop here.' }
git switch --detach origin/genspark_ai_developer
if ($LASTEXITCODE -ne 0) { throw 'Checkout failed; stop here.' }
powershell -NoProfile -ExecutionPolicy Bypass -File .\test\local-check\windows.ps1
Get-Content -Raw -Encoding UTF8 .\.local-check\last-report.txt | Set-Clipboard
```

脚本要求干净工作区；检测到改动会停止，不替你清除或提交文件。以后按“你跑报告 → 我定位修复/推送 → 你更新重跑”迭代。

### 隔离和中断处理

- 只归档已提交源代码；不把宿主目录、个人 `.env`、Docker socket 或业务数据库挂进容器。意外提交的 dotenv 文件也拒绝归档。
- 每次使用独立项目名和独立 PostgreSQL 数据卷；不发布任何端口、不使用已有业务 Compose 配置，也不执行全局 `docker system prune`。
- 数据库、Redis 和测试 API 共享该次容器网络命名空间，连接地址保持 loopback，原测试的数据库保护不放宽。仅创建随机名字的测试库，不 DROP/RESET 已有库。
- 正常结束或可处理的失败后，会删除本次容器/数据卷，保留报告和可复用官方镜像。**关机、强制关闭窗口或 Docker 崩溃不能保证 finally 清理执行**，不可把中断当成功。
- 若报告提示清理失败，启动 Docker 后执行提示中的 `-CleanupRun p30check...` 命令，仅清理该次运行。例如：

```powershell
# 把下面标识换成你报告中的 Run，不要照抄占位文字
powershell -NoProfile -ExecutionPolicy Bypass -File .\test\local-check\windows.ps1 -CleanupRun p30check0123456789ab
```

### 当前验证范围（诚实说明）

已在 Linux 原生隔离环境从干净源码完整运行编排器：冻结安装、迁移、类型/编译、19 项基线、旧集成、业务探针、两端构建和 API 停止。结果为 `KNOWN_ISSUES`，9 项业务问题仍保留。报告逻辑自测 8/8；PowerShell 7.6.6 解析及模拟引擎的正常/失败/清理/远端拒绝路径通过；实际 Compose CLI 2.39.4 配置校验通过。

**这里没有 Docker Engine，也没有 Windows 桌面，尚未完成真实 Docker Desktop / Windows PowerShell 5.1 验收。** 模拟引擎只验证启动脚本控制流，不是假装容器测试通过。你的首份 Windows 报告就是补齐这部分验证的起点。没有浏览器/微信真机交互测试，也没有启用 GitHub Actions。

## 当前工程状态（2026-09-22，U02-A）

**内部开发版本，不可直接对真实用户开放。** U01 工程基线已落地；本轮完成 U02 的第一批「会话与 HTTP 权限防线」，不是完整登录产品。下方历史原型列表不是验收证明。

- 会话：32 字节随机 opaque bearer token，仅存 SHA-256 摘要，12 小时有效；每次请求检查过期、撤销和账号禁用，无开发免鉴权开关。
- 身份：操作人来自会话；客户端 `userId` 等旧字段只能与本人相符，不能决定身份。新增全局默认拒绝守卫，关系读写检查参与人及关闭状态，私有响应禁止缓存。
- 输入：开放写接口使用运行时 class DTO；拒绝字符串冒充数字、越界值、额外字段和身份冒用。
- **临时关闭**：匹配、候车加入、媒体、车票、祝福、赛季切换；旧 WS 一律以 1008 关闭。真实成员、隐私及管理权限基础未完成前，不以“登录了”代替授权。
- **尚无公开登录接口**：真实微信 code 交换、身份映射、刷新/轮换、登录限流和前端登录接入是后续工作。测试由可信夹具创建合成用户会话，不提供公网模拟登录。
- 本地验收：迁移/元数据/HTTP/WS 基线 **19/19**（含 12 组权限子测试）；旧 PostgreSQL/Redis 集成 **3/3**；冻结安装、三端类型检查及 H5/weapp 构建通过。
- 业务压力探针仍有 **9 项不变量违例，发布门禁不通过**；前端仍有演示数据和伪成功回退。没有浏览器/微信真机业务验收，也不代表已修复并发、生命周期或媒体隐私。
- **GitHub CI 尚未启用**：App 缺少 Workflows 写权限，仅有 `docs/ci-workflow.pending.yml` 未启用模板；没有云端 Actions 通过记录。
- 开发分支 `genspark_ai_developer` 已通过 [PR #1](https://github.com/jiaxuGOGOGO/project-30-days/pull/1) 持续更新，尚未合并 `main`。

当前契约、接口关闭原因、迁移与回退限制、复跑命令和下一批 U02-B 见 [可执行升级方案](docs/executable-upgrade-plan.md)。[历史评估报告](docs/upgrade-evaluation-2026-09-22.md) 和原始 JSON 保留原基线证据。

## 核心第一性原理（产品设想，非验证结论）

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

## 版本 0.2.0 历史原型说明（未完成验收）

### P0 级修复（安全与合规）

- **服务端视频隐私保护**：GatingVideo 不再使用前端CSS滤镜，改为接收服务端预处理的分级视频URL
- **视频自动销毁**：Day30 判定为 ASH 后自动触发 `MediaService.destroyConnectionVideos()`
- **H5 部署策略**：新增 `docs/h5-deployment-guide.md`，记录 H5 部署注意事项；H5 不豁免监管或平台规则

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

使用 Node 22.23.2 和 pnpm 10.28.2，仅在隔离本地环境运行。已有数据库先备份并检查迁移历史，不执行 reset；失败历史恢复见执行方案。开发启动使用 TypeScript 编译输出，不改回 `tsx watch`。

```bash
cp .env.example .env
pnpm install --frozen-lockfile --prod=false
pnpm db:up
pnpm prisma:validate
pnpm prisma:generate
pnpm prisma:deploy
pnpm prisma:seed
pnpm start:dev
```

---

## API 端点

除 `GET /season/active` 外，已注册的业务接口需要 `Authorization: Bearer <token>`。令牌不从 URL、Cookie 或客户端用户 ID 读取。未登录返回 401；身份冒用或已关闭功能返回 403；非参与人、已关闭或不存在的关系统一返回 404。下面的旧请求示例不包含认证信息，不可直接作为端到端使用教程。

新增 `GET /auth/session` 查询本人会话，`POST /auth/logout` 和 `POST /auth/logout-all`（JSON `{}`）撤销当前/本人所有现存会话。没有 `/auth/login`；不要手工暴露 `issueForVerifiedUser()`，必须等待可信身份提供方验证后才能调用。

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
| `GatingVideo` | 服务端分级视频（SILHOUETTE/FROSTED/NEAR/FULL），访问控制仍待实现 |
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

## 历史功能设想（实际执行以 U01–U12 方案为准）

```
Phase 0: MVP 验证（时间待重新评估，未验收）
├── H5 版本开发（Taro H5 编译）
├── 简化版物理大厅（触屏拖拽 + 命运之风）
├── 核心匹配流程验证
└── 招募首批 50 名测试用户

Phase 1: 安全与留存（时间待重新评估，未验收）
├── 服务端视频转码架构
├── 签名 URL 授权机制
├── DailyEcho 模块
├── 候车大厅 + 定时发车
└── 终局博弈重构（STAY/PAUSE）

Phase 2: 长期留存（时间待重新评估，未验收）
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
- **ADR-005**: Progressive Trust Reveal而非纯囚徒困境（改善体验的待验证假设，无真实留存或改善幅度证据）
- **ADR-006**: 原生ws替代Socket.IO（微信小程序WebSocket兼容性）
