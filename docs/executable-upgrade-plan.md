# Project 30-Days 可执行升级方案

版本：规划 v1 + U02-A 执行进度，2026-09-22。原评估基线：`f8aa180`。除以下进度明确列出的项目外，其余仍是待实现契约。

配套：[测试决策报告](upgrade-evaluation-2026-09-22.md)、[完整机器结果](evaluation-results-2026-09-22.json)、`test/social-simulation.cjs`、`test/upgrade-stress.cjs`。

## 新增配套：Windows 自动反馈入口（不算 U02-B 已实现）

按用户仅安装/执行/粘贴报告的协作方式，增加 `test/local-check/windows.ps1`、`run.cjs`、`report.cjs` 和报告逻辑自测。使用 Git 提交归档、固定镜像 digest、独立 Compose 项目、loopback 网络命名空间及临时数据卷；不读取真实 .env、不开放端口、不清理其他项目。只将 output 子目录挂为可写，源归档和清理配置不向测试容器开放写权限。

用户安装步骤、运行/复制报告命令、退出码和安全更新方式集中在 README 的 Windows 章节。每份反馈记录提交版本、源归档 hash、逐阶段结果、清理状态；已知业务失败与新回归分开，缺失/跳过/不一致证据不判通过。`KNOWN_ISSUES` 不是发布合格，某个竞态偶尔未复现也不是修复证据。

本轮从干净源码在原生 PostgreSQL 16.14 / Redis 7.4.7 上完整跑通编排器：基线 19/19，旧集成 3/3，报告自测 8/8，业务探针 9 项已知失败，H5/weapp 入口同时存在，API 自动停止。PowerShell 7.6.6 语法和模拟 Docker 的五条控制流路径通过；Compose CLI 2.39.4 能解析实际生成配置。**没有真实 Docker Engine 或 Windows，仍需用户首跑验证镜像/挂载/网络/Windows PowerShell 5.1，不能把模拟引擎当真实 Docker 验收。** 官方镜像标签及摘要通过 Docker Hub 元数据查询核对，但不等于已拉取运行。

闭环顺序：用户报告 → 按提交 hash 定位环境/回归/已知缺陷 → 修复并保留负向测试 → 推送更新 PR → 用户安全切换远端快照重跑。涉及账号、密钥、代理原始日志时先要求脱敏，不收取真实登录凭据。后续优先处理首跑阻塞，再继续 U02-B 真实身份接入；不为“测试变绿”删除已知业务探针或悄悄放开关闭接口。

## 当前执行进度：U02-A 会话与 HTTP 权限防线

本批在 U01 上增量实现，不更改业务状态机。**U02 未全部完成，不能进入真实用户发布。** 正式登录提供方和房间成员事实尚不存在，因此先建立会话与对象权限，并关闭不能证明安全的旧接口，而不是伪造认证成功。

### 已实现契约

- `AuthSession`：32 字节随机令牌，base64url 编码；数据库仅存 SHA-256 摘要，固定 12 小时有效。用户删除级联删除会话；`User.auth_disabled_at` 非空时拒绝认证。业务角色 ACTIVE/WATCHER/OBSERVER 不是管理员权限。
- `SessionService.issueForVerifiedUser()` 仅供后续可信身份服务在验证身份后调用，**没有 HTTP 签发/模拟登录接口**。测试夹具直接调用服务创建自己的合成会话；NODE_ENV=test 不绕过 guard。
- `APP_GUARD` 全局默认拒绝：新增控制器必须明确声明 `Access` 策略；目前仅 `GET /season/active` 公开。不接受 query token、Cookie、客户端自报 userId 或管理员字段作为身份。
- 兼容旧 `userId` / `actorUserId` / `observerUserId` 字段时，body/query/path 任一不符均拒绝；实际服务参数由 `CurrentUser` 注入的会话主体覆盖。身份不从业务 payload 继承。
- 关系权限检查当前用户是否参与、connection 的 DESTROYED/destroyed_at 和房间 DESTROYED 状态。无权限、已关闭、不存在统一返回 404，减少对象探测。
- 开放的 Day30、Echo、Freeze、兑换、奖励及注销入口使用运行时 DTO；关闭隐式类型转换。Echo 限 2–29 天、1–500 字符且不能纯空白；兑换只接受数值 5 或 10；保留旧业务错误，不声称修复了幂等或余额并发。
- 私有响应 `Cache-Control: no-store`；移除宽泛 CORS。当前仅按同源内部测试使用，正式入口须 TLS；令牌、Authorization 和敏感 query 不可进入代理/应用日志。
- `GET /auth/session` 仅返回 userId/expiresAt；`POST /auth/logout` 撤销当前会话，`POST /auth/logout-all` 撤销本人的现存会话。两者传 JSON `{}`。

### 接口开放与关闭清单

| 接口 | U02-A 状态 | 原因/恢复条件 |
|---|---|---|
| `/season/active` | 公开，只有赛季元数据 | 不是包含用户数据的健康接口 |
| `/auth/session`、logout、logout-all | 会话本人 | 尚无公开登录/刷新入口 |
| `/season/assets/:userId`、observer 奖励/兑换 | 会话本人；写请求校验 | 幂等/账本仍需 U05 |
| daily-echo、hourglass、Day30 | 会话 + 关系参与人 + 当前关闭状态检查 | 业务状态机和事务重试仍需 U04/U05 |
| `/boarding/current` | 已登录 | 原有房间元信息，不授权任意房间加入 |
| `/boarding/join`、`/yomi/answers` | 已登录也 403 | U03 真实成员/候选授权后恢复 |
| media 全部接口 | 已登录也 403 | U07/U08 同意授权、真实签名及处理，不开放占位实现 |
| stardust-ticket 全部接口、`/observer/bless` | 已登录也 403 | 分享/跨关系内容访问契约尚未完成 |
| `/season/transition` | 已登录也 403 | 独立管理员权限与审计未完成，不将业务角色当管理员 |
| `/events` | 建连后立即 close 1008，任何 token 均不可订阅 | 无安全成员/私密频道模型，暂不发送旧广播 |

**关闭 WS 不等于完成 WS 鉴权**；这是有意的安全降级。旧前端没有完整登录/401 处理，部分页面仍伪造本地结果，因此不能用界面演示作为业务验收。恢复接口必须同步改授权与负向测试，不能只去掉 disabled 标记。

### 本批验证

- Node 22.23.2 / PostgreSQL 16.14 / Redis 7.4.7 的隔离本地环境；无真实用户、无外部身份提供方。
- `test/baseline.spec.cjs`：Node test runner **19/19**，包括 6 个迁移/元数据/公开路由测试，以及 1 个含 12 子测试的权限组。覆盖匿名请求、畸形/未知令牌、token 摘要存储、最小化响应、body/query/path 冒用、关系越权/关闭、严格 DTO、合法操作、禁用功能、默认拒绝、到期/撤销/禁用、真实 WS 关闭、单会话/全会话注销、用户删除级联。
- 缺失策略用例直接调用 guard，其余权限 HTTP/WS 场景使用真实 Nest 服务；会话签发由可信测试夹具执行。不是完整微信登录测试。
- 旧服务集成 **3/3**；合成模型 16 条投票路径和 200 cohort 仍通过。Yomi 的旧服务级 Redis/DB 回归保留，但 U01 的匿名 HTTP 匹配正向断言改成权限拒绝断言，不再承诺客户端可匹配。
- 冻结安装、Prisma validate/generate、后端/测试/前端类型检查与后端/测试编译通过；H5 → weapp 顺序构建并确认两端入口同时存在，H5 仍有 3 项构建警告。
- 当前服务压力探针 C10 / 1 轮 / samples=5：五个正式迁移成功，referenceGatePassed=true，**releaseGatePassed=false，9 项违例，退出码 2**。入口关闭没有隐藏服务层欠账。

复跑沿用下方四个一次性数据库和 API 启动命令；测试会自动准备/清理合成会话，不需要保存令牌。前三个迁移测试库每次须为空。业务探针仍独立使用 project30_audit 前缀数据库。

### 迁移、回退与边界

新增 `000004_auth_sessions`：用户禁用时间字段和会话表/索引/约束；旧 SQL 不修改。先备份并在克隆库检查迁移历史，再 deploy 和 generate。已有用户不会自动获得会话，旧客户端请求会返回 401，这是预期的兼容性变化。

应用回退时可保留新增表和字段，但**不得回退到无鉴权旧 API 并继续放流**。失败应停止入口或维护隔离环境；不可删除会话表恢复匿名访问。此前失败迁移记录仍需人工核对，不能直接 resolve 为成功。

会话验证是每次请求入口检查，没有缓存；撤销完成后的下一次请求拒绝。已经通过检查的在途请求可能完成，当前并不提供跨注销、关系关闭和业务事务的线性化撤权保证。U04/U07 必须在事务/数据投影边界进一步解决。尚未实现登录限流、身份绑定/换绑、会话轮换、过期会话清理、封禁运营接口、独立管理员能力、WS 私密频道、退出/举报/媒体同意和真正的端到端登录体验。

### 下一批 U02-B

优先实现真实身份提供方适配与唯一身份映射，再补登录入口的 code 校验、错误处理、限流和会话轮换/前端 401 处理。微信小程序 code 交换与 H5 OAuth 不是同一协议，先明确支持渠道；缺少真实 AppID/密钥时默认拒绝，不给生产留模拟登录开关。密钥只通过安全配置提供，不提交 Git、不贴到聊天。WS 恢复与成员授权依赖 U03，不能提前把 roomId 当权限。

GitHub CI 的 Workflows 权限阻塞仍未解决；模板不等于启用。本批仅推送开发分支并更新 PR，不合并 main。

## U01 历史交付与仍适用的复跑说明

以下 8/8 是 U01 当时的记录，当前基线已扩展为上述 19/19。


### 已落地及本地验收

- Node 22.23.2 / pnpm 10.28.2；manifest 与 lock 同步，Nest/Taro 依赖对齐；独立源码副本 `pnpm install --frozen-lockfile --prod=false` 成功。
- Prisma validate/generate、后端/测试/前端严格类型检查、生产与测试编译通过；开发启动改为 tsc-watch，真实 HTTP 验证 DI 和 DTO 元数据。
- H5 原先仅生成 JS/CSS、不生成入口；现新增 `frontend/src/index.html` 模板。干净安装后按 H5 → weapp 顺序构建，确认 `frontend/dist/h5/index.html` 与 `frontend/dist/weapp/app.json` 同时存在。H5 仍有 3 项第三方/体积警告；未完成浏览器和微信真机业务验收。
- `test/baseline.spec.cjs` **8/8**：旧 SQL 校验和、空库/重复部署、第一版升级、全部旧迁移已应用的兼容升级、元数据、真实 HTTP 服务/校验、真实 Redis+PostgreSQL Yomi 流程。
- 旧集成场景 **3/3**：Yomi 40 个并发请求出现 1 次等待成功及 39 次预期锁冲突，反向补交后恰好 1 条连接；另有超时销毁及 Day15 边界。不是 40 次匹配成功，也不是全系统安全认证。
- 合成模型自测：16 条参考投票路径、200 个随机 cohort；不代表真实留存。
- 当前服务缺陷探针 C10、1 轮、samples=5：正式迁移成功、无测试修补；参考模式通过；**9 项生产不变量违例，默认退出码 2，releaseGatePassed=false**。U03–U06 等仍需真正修业务。

### 迁移安全与回退

新增 `000001a_prepare_reveal_level`，在原 000002 前补齐缺失类型。三个历史 SQL 文件保持原始校验和，已部署旧库存在该类型时安全 no-op。当前脚本执行真正 `prisma migrate deploy` 并写迁移历史，不再测试内修补。

部署前备份并检查 `_prisma_migrations` 与实际 schema。**已有失败的 000002 记录不在自动恢复覆盖内**：先核对部分 DDL/数据是否执行，人工恢复或前滚验证后，再依照 Prisma resolve 流程处理；不可直接标记 applied、不可 reset 真实库。新增枚举无破坏性下迁移；应用回退时保留它，不 DROP 类型，不改历史 SQL。

### 可复跑基线

先安装依赖并生成 Client，提供专用 loopback PostgreSQL 16 / Redis 7。需要四个不同数据库：前三个完全空库，第四个先应用正式迁移，且无其他用户/房间。名称以 `project30_test` 开头；Redis 使用专用 DB 1–15。不能对生产或共享数据执行。

```bash
pnpm install --frozen-lockfile --prod=false
pnpm prisma:generate
pnpm typecheck && pnpm test:typecheck && pnpm frontend:typecheck
pnpm build && pnpm test:build && pnpm test:model
# 下列 URL 替换为自己专用的本地服务账号/端口；先创建数据库
export BASELINE_FRESH_DATABASE_URL='postgresql://postgres:local_test_only@127.0.0.1:5432/project30_test_fresh'
export BASELINE_UPGRADE_DATABASE_URL='postgresql://postgres:local_test_only@127.0.0.1:5432/project30_test_upgrade'
export BASELINE_HISTORICAL_DATABASE_URL='postgresql://postgres:local_test_only@127.0.0.1:5432/project30_test_historical'
export E2E_DATABASE_URL='postgresql://postgres:local_test_only@127.0.0.1:5432/project30_test_e2e'
export E2E_REDIS_URL='redis://127.0.0.1:6379/1'
export DATABASE_URL="$E2E_DATABASE_URL" REDIS_URL="$E2E_REDIS_URL"
export NODE_ENV=test HOST=127.0.0.1 PORT=3000 BASELINE_API_URL=http://127.0.0.1:3000
pnpm prisma:deploy
node dist/src/main.js &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT
# 等待 /season/active 返回 200，再执行
node --test test/baseline.spec.cjs
E2E_CONCURRENCY=20 pnpm test:e2e
NODE_ENV=production pnpm frontend:build:h5
NODE_ENV=production pnpm frontend:build:weapp
test -s frontend/dist/h5/index.html
test -s frontend/dist/weapp/app.json
```

迁移测试执行后前三个库不再为空，复跑需新建不同名字的专用空库。测试环境禁用自动 cron 与本地 .env 文件，旧测试仍显式调用 Chronos。干净副本不要建在名为 `node_modules` 的目录下：Taro 会把源码当依赖，导致小程序配置输出路径偏移；本轮最终在 `dist/u01-clean` 独立安装和构建通过。

### CI 阻塞与下一步

`docs/ci-workflow.pending.yml` 是**未启用模板**，语法已解析验证，显式 bash 保证日志管道不会吞掉失败状态。GitHub App 缺少 `workflows` 权限，不能写 `.github/workflows/ci.yml`，本轮没有绕过此限制。仓库管理员可授权该 App 的 Workflows 写权限，或在有权限的正常 GitHub 编辑/PR 流程中将模板安装到上述路径，然后执行 workflow_dispatch、检查全部步骤和构建 artifact，再启用所需分支保护。安装模板前后都不应声称云端门禁已经通过。

当前已推进到 U02-A；下一轮按本文 U02-B 继续，CI 激活仍是未闭环事项。未完成安全门前不得发布真实用户版本，推送开发分支不等于合并 main。

## 0. 执行结论与非目标

按原审计的安全与一致性方向升级，但调整产品参数和实施边界。分为三层：

1. **必须完成且不能做对照实验**：身份与对象授权、正确状态机、真实成员、非负余额、幂等、隐私撤回、举报、安全退出、可恢复任务。
2. **必须做成版本化规则，效果再验证**：首次互答 24/48/72h、宽限、发车条件、深度话题频率、同时待回应邀请数。
3. **延后**：碎片经济、多重深度连接、复杂观察者、自动赛季、AI 人格标签、推荐模型、Kafka、微服务、Kubernetes。

首期不是“功能全开”：只交付真实登录 → 到场 → 双方同意匹配 → 首次互答 → 日常互动 → 自愿结束/终局 → 撤销授权及数据处理的闭环。

不承诺恋爱成功、不把 STAY 等同于同意公开身份、不把超时当作道德评价，不以购买道具为安全退出条件。

## 1. 进入开发前的决策门 G0

产品负责人和后端负责人共同确认下表。没有确认则采用“邀请制测试”状态，不接入公众真实敏感内容。

| 决策 | 推荐 v1 默认 | 扩展边界 |
|---|---|---|
| 人群/地域 | 一个明确人群，成年人邀请制，按实际资质运营 | 年龄策略和业务许可须专业核定，不能靠前端勾选替代 |
| 时间原点 | 房间 cohort 固定 30 天；连接另记实际建立时间 | 日历天、关系持续时间、互动天、视频授权不共用 connected_days |
| 首次互答 | 实验默认 48h，24h+一次自愿宽限作后续对照 | 72h 可配置；无实际证据前不承诺提升 |
| 深度连接数量 | 每人在同一 cohort 同时 1 条 | 已有历史多连接不能直接删除；人工协调后再启用新约束 |
| 发车 | 固定批次，到场确认、候选覆盖和运营审核 | min/max 不是“保证成功”的常数；人数不足合并/延期/退款或退出政策明确 |
| 日常互动 | 每日可选问题，可跳过敏感题，不因一次缺席自动销毁 | 若测试较低频率，以房间规则版本划分，不在关系中途改变 |
| 暂停 | 明确 paused_until，不积分收费；最多一次连续宽限的初始策略 | 暂停不自动延长固定房间寿命，不限制拉黑/举报/撤回 |
| Day30 | 明确两轮 STAY/PAUSE；独立 EXIT 随时可用 | 若只有一方想延长，另一方必须能无惩罚退出 |
| 视频 | 非必须；未通过安全门前关闭真人视频 | 用户主动启用、单独授权；不奖励披露敏感内容 |
| 可分享车票 | 默认仅本人内容，分享前预览 | 双方内容或身份另取同意；不把退出标成失败人格 |

### 生命周期的准确边界

- 房间 `ends_at = starts_at + 30 days`，保留现有约束，不因关系延期修改房间日期。
- 匹配截止暂定房间第 7 天，避免晚加入用户被误承诺完整 30 天；最终值在 G0 确认并版本化。
- 终局第 1 轮在房间结束时开放，截止 48h 后；双方提前完成则立即结算。
- 双方 STAY → LEGACY；一方 PAUSE → 最多 7 天 EXTENSION；双方 PAUSE → 最多 14 天 COOLDOWN。任何一方可选择 EXIT，不需要等对方批准。
- 延长结束进入第 2 轮，48h 内双方 STAY 才 LEGACY；其他明确选择或到期未完成 → CLOSED，记录 `NO_MUTUAL_CONTINUATION` 或 `NO_RESPONSE`，不用 NULL 猜测选择。
- 若第一轮未完成，到期关闭而非强行替用户填 PAUSE。可另设重新建立关系规则，但不能恢复原来的隐私授权。
- 最大活跃处理时间可能到第 48 天（30+2+14+2），不是把“30 天”误写成必定第 30 天物理删除。
- 安全退出立即阻断双方访问与私密事件投递；后续删除按明确政策完成。举报证据依法留存且隔离，不做“删除全部痕迹”的绝对承诺。

上述无响应/退出规则是待实现契约；当前参考状态机只覆盖部分投票路径，不能冒充已实现。

## 2. 架构：为变化留边界，不为幻想建平台

```text
Taro H5 / 小程序
  ├─ API 客户端（统一错误、幂等回执、状态恢复）
  └─ 平台适配（Canvas/传感器/分享/身份入口）
           │
NestJS 模块化单体 API
  Identity / Cohort / Connection / Interaction / Safety / Media
           │ 单个业务命令 = 单个事务边界
PostgreSQL（业务状态、约束、投票、授权、Outbox/Job）
           │
独立 Worker 进程（仍在同一代码库）
  到期补偿 / 媒体处理删除 / 通知重试
Redis（限流、短时缓存、在线广播；不能单独决定结局）
```

### 最小接口边界

只为确定会变化的外部能力定义端口：

- `Clock.now(): Date`：生产服务器时间，测试虚拟时钟；不要每处调用不同 Date.now。
- `IdentityProvider.exchange(code, channel)`：微信小程序/H5 等外部身份统一映射内部 userId；openid 不是客户端可自报的身份。
- `MediaStorage.sign/read/delete/verifyDeleted`：签发与删除由授权服务决定，存储适配器只执行指定对象操作。
- `MediaProcessor.submit/getStatus`：将转码、审核、回调隔离为适配器；不直接接受任意 originalUrl 抓取。
- `NotificationSender.send(template, recipient, dedupeKey)`：消息内容最小化，不带对方未公开选择或回答。

内部领域服务直接使用明确的 Prisma 事务/查询，不建设万能 Repository、通用工作流引擎或全量 CQRS。不把当前测试里的 reference 函数直接当正式接口：它们没有完整鉴权、内容审核和生命周期策略。

### 目录迁移原则

在现有 `src/day30`、`src/boarding`、`src/daily-echo` 上渐进改造；不要为了架构图一次性重命名所有模块。新增 `src/auth`、`src/safety`、`src/jobs`、`src/contracts` 等仅在对应工单需要时创建。后端、前端包拆分在锁文件和 CI 稳定后进行，保留原命令兼容层。

## 3. 状态机和不可破坏的不变量

将 `Connection.phase` 与终局 `outcome` 分离，渐进保留旧 status 兼容读：

```text
MATCHING → SANDGLASS → DEEP_LINK → VOTING_1
  VOTING_1: STAY/STAY → LEGACY
             STAY/PAUSE → EXTENSION → VOTING_2
             PAUSE/PAUSE → COOLDOWN → VOTING_2
  VOTING_2: STAY/STAY → LEGACY；其他/到期 → CLOSED
  所有活跃状态: EXIT/BLOCK/SAFETY_REVIEW → 立即撤权 → CLOSED/RESTRICTED
```

1. 用户身份只来自服务端会话；每个对象读写检查成员、封禁与资源状态。
2. 同一用户/房间只有一个有效 membership；人数由成员事实计算或同事务维护。
3. 同一连接/轮次/用户只有一票；重复相同命令返回同一回执，不重新结算。
4. 未共同提交前，任何 API/WS/日志都不泄露对方选择或答案。
5. 时间未到不得提前重开；重放 tick 不得重复推进。
6. 终态不允许被匹配重放改回沙漏；恢复需要新关系、新授权。
7. 每日奖励、冻结消费及媒体任务必须可去重；余额不能为负。
8. 事件与业务状态在同一数据库事务内保存；不能先推事件再提交，也不能提交后只 fire-and-forget。
9. 公共房间广播只能包含已批准的聚合信息；不广播私密关系明细。
10. 任何访问授权必须同时满足身份、成员、状态、同意、资产就绪；客户端过滤和 URL 隐藏不属于授权。
11. 正常退出与举报不依赖余额、不需要另一方确认、不参与 A/B。
12. 旧规则不能在已建立关系中静默改变；紧急安全规则除外并记录原因。

并发首选：锁定同一 Connection/interaction 聚合行，锁内读当前状态后校验并写入。若采用 Serializable，围绕整个事务最多重试 3 次，指数退避+抖动；只重试 P2034 等明确可重试冲突，不重试授权/输入错误。事务中不调用 COS、短信等外部服务。保留现有活跃 pair 唯一索引作为最后防线。

## 4. 数据模型契约（增量，不立即建所有表）

| 模型 | 必要字段/约束 | 引入工单 |
|---|---|---|
| UserIdentity / Session | provider、provider_subject 唯一；user_id；session过期/撤销；日志不存 token | U02 |
| RoomMembership | room_id、user_id、status、joined_at、checked_in_at、left_at；UNIQUE(room_id,user_id) | U03 |
| CohortRule | id/version、参数 JSON、hash、approved_at；发布后不可修改 | U03 |
| Connection | phase、outcome、version、rule_version、started_at、voting_deadline、reopen_at、closed_at、close_reason | U04 |
| ConnectionParticipant | connection_id、room_id、user_id、active；同房间每用户 active 唯一的部分索引 | U04 |
| JudgmentVote | connection_id、round、user_id、choice、submitted_at；UNIQUE(connection_id,round,user_id) | U04 |
| DailyEcho | opens_at、closes_at、business_date、prompt_version；既有 pair/day 唯一约束保留并核对语义 | U05 |
| RewardLedger / FreezeUsage | user、season/room、type、business_date、idempotency_key、delta；业务唯一；余额 CHECK >=0 | U05，奖励玩法可以关闭 |
| CommandReceipt | actor、command、key、request_hash、result_ref、status、expires_at；三元唯一 | U04 |
| Outbox / Job | event_id唯一、aggregate_id/version、type/schema_version、available_at、attempts、lease_until、state、last_error_code | U06 |
| ConsumerInbox | consumer、event_id唯一；消费效果与去重标记同事务 | U06 |
| Block / Report / Consent | 主体、目标、作用域、版本、创建/撤回；证据独立加密及权限 | U07 |
| MediaAsset / Variant | owner、随机存储key、来源版本、状态、checksum、大小/时长；不公开原始 URL | U08 |
| MediaGrant / DeletionJob | asset、connection、grantee、level、授权/撤回时间、状态/重试/完成证据 | U08 |

### 索引与约束规则

- 数据库层继续保留连接双方不同、活跃 pair 唯一、房间 30 天等已有 SQL 约束。
- 新约束先查询历史违例，再清理或隔离，不默认数据已满足。
- `RoomMembership` 有外键；加入用同事务插入去重+条件容量更新，满员回滚，不留下占位记录。
- `ConnectionParticipant` 同时维护双方席位，原子建立和释放；不尝试分别对 user_a/user_b 加独立索引冒充跨列唯一。
- `Outbox(state,available_at,id)`、连接阶段/期限、`MediaGrant(connection_id,revoked_at)` 等索引按真实查询设计，跑 EXPLAIN 后决定。
- 金额/额度使用整数；`growth_tags` 等结构数据若保留，迁移到有明确 schema 的 JSONB，而不是不可校验的字符串。
- 活跃赛季唯一索引先作为设计保留；自动赛季功能关闭时不要急于实施全套跨季资产。

## 5. API、实时事件与幂等契约

统一 `/api/v1`；旧接口只允许短期兼容适配，不允许绕过新鉴权继续写入。前端 ID 来源是服务器返回的资源，不是演示常量。

| 接口 | 功能 | 关键行为 |
|---|---|---|
| POST /auth/exchange | 兑换会话 | 验证外部 code；区分 H5 Cookie/CSRF 与小程序 token 存储策略 |
| GET /me | 当前用户与可用操作 | 不暴露第三方身份标识 |
| GET /cohorts/current | 已加入房间/可报名房间 | 已加入者不被切到“下一辆车” |
| POST /cohorts/:id/memberships | 报名 | 不接收 userId；重复返回原 membership |
| POST /cohorts/:id/check-in | 到场确认 | 幂等，窗口由服务端检查 |
| POST /connections/invitations | 邀请 | 成员/兼容/封禁/邀请预算检查；匹配需双方同意 |
| GET /connections/:id | 权威状态快照 | version、serverTime、deadline、allowedActions；对方未公开票为不可见 |
| PUT /connections/:id/echoes/:echoId/answer | 互答 | 非空、长度、窗口、只写一次；安全审核策略 |
| POST /connections/:id/votes | 终局投票 | 当前轮次、预期版本；不可改票；长按只是交互，不是安全凭证 |
| POST /connections/:id/pause | 明确暂停 | 记录期限与次数，幂等，不能越过终局/安全状态 |
| POST /connections/:id/exit | 自愿结束 | 撤销授权优先，不等待对方 |
| POST /blocks、POST /reports | 安全操作 | 原子写入/撤权/任务，不受游戏规则阻止 |
| POST /media/uploads | 限权上传凭证 | 文件大小、时长、对象key由服务器限定 |
| GET /connections/:id/media | 获取当前授权变体 | 满足权限及ready才返回短期签名；缓存策略不缓存敏感响应 |
| GET /commands/:receiptId | 超时后查结果 | 仅命令拥有者，避免重复投票或重复发放 |

### 请求与错误示例

```json
{
  "round": 1,
  "choice": "STAY",
  "expectedVersion": 12
}
```

写命令携带 `Idempotency-Key`。绑定 actor+command+key；保存请求摘要；相同 key 不同内容返回 `409 IDEMPOTENCY_KEY_REUSED`。授权必须在回放缓存回执前执行，不能用别人的 key 绕过权限。

```json
{
  "code": "VOTE_NOT_OPEN",
  "message": "尚未到重新选择时间",
  "retryable": false,
  "requestId": "opaque-id",
  "serverTime": "2026-09-22T12:00:00Z"
}
```

- 401 未登录；403 无权（敏感对象可统一 404 防枚举）；409 状态/版本/幂等冲突；422 输入不合法；429 限流并带 Retry-After；503 暂时不可用。
- 网络异常不能生成本地 LEGACY/ASH。结果未知时查命令回执及连接快照。
- 单纯通用 Idempotency-Key TTL 不足以保证终局唯一；JudgmentVote、membership、reward ledger 的业务唯一约束长期有效。
- 会话退出/失效关闭对应 WS；HTTP使用同源/明确 CORS，Cookie策略有CSRF防护。Origin检查不能替代小程序和非浏览器客户端的认证。

### 事件 envelope

```json
{
  "eventId": "uuid",
  "type": "connection.phase.changed",
  "schemaVersion": 1,
  "aggregateId": "uuid",
  "aggregateVersion": 13,
  "occurredAt": "2026-09-22T12:00:00Z",
  "data": { "phase": "EXTENSION", "reopenAt": "2026-09-29T12:00:00Z" }
}
```

- 私密频道 `connection:{id}` 订阅前查成员、封禁和授权；公开频道 `cohort:{id}` 使用独立允许字段投影。
- 未共同投票前的事件只通知“状态更新”，不发 choice。广播序号不得成为其他关系私密信息探测器。
- 至少一次投递；客户端按 eventId/version 去重。发现版本跳跃、重连或页面恢复时重新 GET 快照。
- Redis Pub/Sub可用于实时广播，但不代替持久事件；前端离线丢失广播后依靠快照恢复。
- 可移动的物理坐标只做临时展示，不作为匹配同意或真实授权依据；先不做全大厅精确物理同步。

## 6. 规则版本与实验配置

建议配置示意（先实现需要的字段，不建立无限配置平台）：

```json
{
  "version": "cohort-v1-2026-09",
  "businessTimeZone": "Asia/Shanghai",
  "roomLifetimeDays": 30,
  "matchingCutoffDay": 7,
  "firstReplyWindowHours": 48,
  "graceUses": 1,
  "graceHours": 24,
  "maxActiveConnectionsPerUser": 1,
  "maxPendingInvitations": 3,
  "judgmentWindowHours": 48,
  "extensionDays": 7,
  "cooldownDays": 14,
  "maxJudgmentRounds": 2,
  "mediaEnabled": false,
  "economyEnabled": false
}
```

所有数值为初始建议/实验参数，不是实测最佳。若对照48h与24h+grace，需明确定义各臂是否允许额外宽限，不能让48h臂暗含72h而混淆比较。

- 房间创建时固定 rule_version；已有关系继承版本。修改只影响新 cohort。
- “关闭新建关系”与“强制结束已有关系”分开；安全开关可立即禁发媒体，不能伪造终局。
- UI文案、后端校验、调度使用同一规则快照；规则schema校验与发布审批纳入CI。
- 记录每次实验分配，按 cohort 随机避免同房间互相污染；安全政策全部一致。
- 用户选择延长与实验干预分开记录，不能把自选用户的高参与率当随机实验提升。

## 7. 任务与媒体：先撤权，再可验证地完成副作用

### Worker

PostgreSQL任务表先行：短事务 `FOR UPDATE SKIP LOCKED` 领取，设置 lease；处理外部任务不占长事务；lease过期可恢复；带最大重试、指数退避、dead-letter和人工重放入口。租约不是 exactly-once 保证，每个处理器必须幂等。到期任务查询 `deadline <= serverNow`，支持停机补跑，不依赖某一分钟一定在线。

禁止每个 API 实例都无去重运行 cron。可先独立一个 scheduler worker，但单实例也不能代替幂等，因为重启仍会重复。

### 媒体

1. 私有桶；上传签名限定对象、大小、类型和期限；MIME/解码验证与审核，不接受任意URL抓取。
2. 原片隔离存储；处理状态 `UPLOADING → PROCESSING → REVIEW → READY/REJECTED`；回调签名与去重。
3. 变体按 asset版本/level存储，不能以可猜用户目录做唯一安全边界。
4. 删除和撤权分开：连接结束撤销grant，不误删其他关系仍合法使用的资产；用户删除按作用域和法定留存执行。
5. 已发签名URL通常无法单靠数据库标记立即失效。试验期可用短TTL（例如60秒）并明确剩余窗口；若要求即时在线阻断，选择鉴权代理或支持即时撤销的分发层并压测成本。不得把短TTL宣传为绝对即时撤销。
6. 明确原片、变体、封面、对象历史版本、CDN缓存、备份和举报证据的保留/删除政策；先写清SLA再实现。
7. 下载/录屏不可远程撤回；必须向用户说明。
8. 模糊不是匿名化或加密；声音、背景、字幕、元数据亦需威胁建模。必要时先用非真人素材测试，不承诺“客户端无法识别”。

日志只记录必要的操作与错误码，不记录回答、选择、视频URL、token；关联标识按权限与保留策略控制。Outbox/备份也属于隐私数据范围，不是可以无限留存的例外。

## 8. 降低重复成本的迁移策略

### M0：盘点

先确定是否存在真实数据库/用户；核对 `_prisma_migrations`、实际enum/索引/默认值、历史多连接、负余额和破损状态。当前仓库的 seed 只有命运卡，不假定任何演示UUID在数据库存在。

### M1：可复现基线

- 固定 Node受支持版本和pnpm版本，更新锁文件；严格安装、Prisma generate、后端/前端检查、H5/小程序构建进入CI。
- 当前测试依赖上轮已解析的辅助node_modules。要干净复跑，先执行U01；临时研究可用 `pnpm install --lockfile=false --ignore-scripts` 并显式 generate，但这不是生产发布方法。
- 若迁移000002从未应用，可在单独修复PR纠正待应用迁移并建立从空库验证。
- 若任何环境已应用过相关迁移，不直接改历史校验和；制定向前兼容修复/基线策略。已有失败迁移必须先核验事务状态、备份及实际对象，再使用Prisma正式恢复流程，不能直接“标记已成功”。

### M2：Expand

新增表/可空列/索引，保留旧读。先接入Auth与安全边界，旧接口不能继续匿名写。新服务从一个领域入口写入旧兼容字段和新字段，必须同事务，不双写两个独立服务。

### M3：Backfill

以小批次cursor回填，可中断续跑；保存进度和核对计数/校验和。房间成员缺失不能凭用户注册时间自动推断；只有可靠历史来源才回填，无法确定的记录隔离待处理。`DEEP_LINK + day30` 不一定是真实 LEGACY，不能直接批量标成功。

### M4：Shadow-read / 切流

新旧读对比但只有一个写权威。记录差异、不把私密数据写对比日志。先内部cohort，再少量新cohort；每次切流前确认未知状态和关键不变量为零。旧客户端写路径通过适配层进入新逻辑；不能表达新权限/状态时要求升级或只读。

### M5：Contract

所有旧版本活跃关系结束、兼容窗口超过实际最长生命周期且完成恢复演练后，才移除旧字段/接口。初始可按至少60天兼容预算，但以实际遗留对象为准。不存在任何历史迁移义务时才简化。

### 回滚

- 应用回滚保留新数据库列，不做破坏性down迁移。
- 功能flag先停新建/媒体签发；已有关系使用安全兼容处理器继续。
- 已写入终局、授权撤回和删除不得用回滚镜像逆转。必要时执行经过审计的补偿命令。
- 备份恢复不能把已撤销授权重新开放；恢复后重放撤权/删除清单，先隔离校验再放流量。
- 任何回滚不得恢复无鉴权的旧接口。

## 9. 可拆分实施工单与依赖

估算基于2名工程师+兼职QA/产品，属于排期初稿，不是工期承诺。工程闭环约5–7周，完整用户周期另需30–48天及后续观察；资质审批不包含在内。

| ID | 工作/现有文件 | 依赖 | 负责人角色 | 验收与预计工程人日 |
|---|---|---|---|---|
| U01 | package/锁文件、tsconfig、main、迁移000002、测试构造依赖、CI | G0可并行 | 平台/后端 | 干净库和已有快照均可迁移；两端构建；Nest真实启动；3–5 |
| U02 | auth/session、所有controller/gateway、DTO | U01 | 后端 | actor来自会话；未登录/非成员/管理员矩阵全部通过；3–5 |
| U03 | BoardingService、RoomMembership、发车/到场状态页 | U02 | 后端+前端 | 100次重复只1人；末席并发不超限；发车后跟踪原房；3–5 |
| U04 | Connection领域转换、Day30Service、投票/回执 | U03 | 后端 | 16基本路径+无响应/退出/重复/未来/冲突/旧状态完整测试；4–6 |
| U05 | DailyEcho、freeze、必要ledger；关闭奖励玩法入口 | U04 | 后端 | 两人同时答题不会卡死；所有余额非负；每日窗口不跨夜丢题；3–4 |
| U06 | Outbox/Job、Chronos重放补偿、WS私密频道 | U04 | 后端 | 双worker、重启、重复事件、事务回滚；断线快照恢复；3–5 |
| U07 | Report/Block/Consent、退出/注销流程与运营台 | U02/U04 | 全栈+运营 | 拉黑立即撤权；安全操作不收费；受理与审计可追踪；3–5 |
| U08 | MediaService真实SDK/变体/授权/删除worker | U06/U07 | 后端 | 原片不可公开取；删除失败恢复；共享资产不误删；4–7 |
| U09 | session.ts、全部页面、Day30Judgment、LimboHall | U02–U07 | 前端 | 移除生产mock；4xx/5xx不伪成功；真机后台暂停与恢复；4–6 |
| U10 | 代理路径、部署镜像、备份、健康检查、日志告警 | U01/U06 | 平台 | HTTP/WS路由契约测试；恢复与回滚演练；2–4 |
| U11 | 真实HTTP/WS集成、开放模型压测、故障注入 | U02–U10 | QA+工程 | 达到第10节门禁；测试报告含失败/掉队请求；3–5 |
| U12 | 邀请制cohort、访谈、指标、参数实验 | U11/合规门 | 产品+运营 | 安全门通过；机制理解无重大歧义；至少一个真实周期；持续 |

可以并行U07与U06、U09的接口接入与后端开发，但以已冻结的合同和契约测试连接。每个PR只负责一个领域变化；大版本依赖升级、业务重构和数据迁移不要同时混在一个PR。

## 10. 测试金字塔和后续压力计划

### 已完成与未完成分开

已完成：合成模型、16参考投票路径、原生数据库短批次压力、部分Outbox故障点模拟。未完成：生产升级后的HTTP/WS鉴权E2E、真实Redis故障、真实COS/删除、kill/restart、真机性能、持续负载和真实cohort。

### 每次PR必须过

- 严格安装、lint/typecheck、unit/contract、Prisma validate/generate。
- 空库迁移和上一发布快照升级；涉及数据变更时验证回填可续跑和回滚兼容。
- 真正启动Nest并从HTTP调用DTO校验，不能用手动实例化替代全部E2E。
- 所有未授权拒绝、双盲不泄露、非负余额、单次终局等硬不变量零违例。
- 当前 `upgrade-stress.cjs` 作为缺陷探针保留；随着正式新接口实现逐条迁移到正式测试。reference通过不能消除current失败。

### 性能工作负载（待执行目标，不是本轮容量结果）

以300/1,000/3,000在线逐级测试，使用开放到达率工具（如k6）记录scheduled、started、dropped、completed、errors和延迟。服务短批次的闭环吞吐不能替代开放负载，不能只记录成功请求。

| 负载 | 计算/场景 | 初始验收目标 |
|---|---|---|
| 候车轮询 | N/10秒：1,000在线约100读RPS；加抖动、etag、页面隐藏暂停 | 指定环境p95<500ms，非业务冲突5xx<0.5% |
| 集中发车 | 1,000人60秒内报名/签到，含10%重复和重试 | 无超售/重复成员；幂等正确 |
| 互答 | 1,000人2分钟内提交约8.3写RPS，叠加瞬时峰值和同对提交 | 完成状态正确，消息不提前揭示 |
| 终局 | 一次cohort集中提交；50%同时到达，重复键/断网重试 | 零重复结算；冲突可恢复，不返回伪成功 |
| WS | 长连接稳定、切后台、抖动重连，服务器重启 | 私密频道隔离；重连后5秒内最终快照一致 |
| 大厅位置 | 若未来每人2fps，1,000人产生2,000输入/s；全房广播接近二次放大 | 先局部订阅/批处理再实现，不默认全局广播 |
| 到期任务 | 累积10k到期任务、双worker与重启 | 不重复副作用；积压可恢复，延迟可观测 |
| 媒体 | 显式给视频时长/码率/变体数/播放次数；测试签名与实际对象访问 | 不跨级访问；撤权窗口有实测界限 |

每级：2分钟预热、10分钟稳态、60秒3倍峰值、10分钟恢复；最后一次60分钟soak。达到资源饱和时停止加压，记录首个不满足SLO点，不以击垮共享环境为目标。所有负载只对自有隔离测试环境。

p95等阈值是初始工程目标，须连同实例规格、数据库规格、网络、数据量发布，不脱离硬件比较。声明“支持多少用户”前必须补HTTP/WS/媒体端到端测试。

### 故障矩阵

1. Redis不可用/锁过期：数据库不变量仍守住，明确503或降级，不绕过权限。
2. worker在DB提交后、外部调用前崩溃：Outbox保留可恢复。
3. 外部删除成功但回执丢失：重试删除安全并核验，不重复扣额度。
4. 数据库死锁/Serializable冲突：有限重试，最终回执可查。
5. 时钟跨上海午夜、进程UTC、停机48h：任务按权威期限补跑，不能重复加天。
6. WebSocket事件乱序/重复/断线：版本检查+GET快照。
7. 前端提交响应丢失：同幂等键查询，不新增票。
8. 媒体回调伪造/重复、删除后迟到转码回调：不能复活撤销资产。
9. 数据恢复：撤权和删除标记在放流前重新应用。

### 真实产品实验

- 首轮20–50名邀请者以可用性、理解、压力感与安全为主，不宣布统计显著。
- 埋点不含问答正文：signup、check_in、invitation、mutual_accept、first_mutual_reply、echo_completed、pause、exit、vote_finalized、grant_revoked、report_resolved。每个事件带rule_version、cohort、匿名化研究ID，权限/保留另定。
- 主指标：双方完成首次互动的配对比例；次指标：每周双方有效参与、用户自述有价值、自愿继续。
- 护栏：被迫感、无回应等待、举报率与处置时间、主动退出可达性。不能只优化STAY或时长。
- 48h与24h+grace采用cohort级分配，预注册周期、主要指标、排除条件、停止条件；分析考虑同群体关联及重复用户。
- 样本量须基于真实基线/MDE/cluster效应计算。例如40%到50%的二项差异，忽略cluster时约需数百个独立配对/臂，50名用户不能得出可靠小幅提升。
- 出现未经授权访问、媒体跨级泄露或删除故障立即停止相关能力；安全修复不随机分组。

## 11. 发布与运营门禁

| 门 | 放行条件 | 不通过时 |
|---|---|---|
| G1 工程基线 | 可复现安装/构建/迁移/启动 | 禁止功能并行扩张 |
| G2 权限与状态 | 全部硬不变量零违例，未知状态已处理 | 不招真实用户 |
| G3 隐私与安全 | 举报/退出/撤权/删除/恢复链路可验证；合规确认 | 关闭真人媒体，保持内部测试 |
| G4 容量与韧性 | HTTP/WS/任务/端侧目标达标，故障演练完成 | 限制cohort规模/暂停扩容 |
| G5 产品 | 完整周期观察，有价值和压力护栏均可接受 | 改参数/人群，不追加奖励复杂度掩盖问题 |

初始运维：接口/DB池/任务积压/重试/事件滞后/签发拒绝/删除失败/安全工单告警；健康检查区分liveness与readiness。不要用健康检查把所有用户资料或错误栈暴露给公众。

发布顺序：内部合成数据 → 内部真实账号 → 一组邀请cohort → 复盘 → 多cohort。保留紧急关闭媒体签发/新匹配开关，安全退出永远可用。

目标恢复预算可先采用RPO≤15分钟、RTO≤60分钟作为待演练目标，不把云服务商备份开关当作达标证明。删除物理完成SLA由云平台、历史版本、备份/法定留存政策明确后公布。

## 12. 成本与扩展触发器

### 成本模型

- API/数据库：根据实测RPS、连接池等待、CPU/内存和数据增长定实例，而非按注册人数猜测。
- 媒体存储：`原片数 × 原片大小 + 各级变体数 × 各变体大小 + 历史版本/备份`。
- 出网：`有效播放次数 × 实际平均传输字节`；不能以上传体积估算播放成本。
- 转码：输入分钟数 × 变体/处理单价；失败重试必须计入。
- 审核/运营：举报工单量 × 平均处理时长；早期常比服务器费用更关键。
- 每个cohort预算上限、任务重试上限、上传时长/大小、播放限流均可配置；不凭空给出每用户云成本承诺。

### 什么时候再增加复杂度

| 变化 | 触发证据 | 现在预留什么 |
|---|---|---|
| API多实例 | 单实例稳态SLO不足且DB不是瓶颈 | 无状态会话验证、幂等、独立worker、广播适配 |
| 专用队列 | PostgreSQL任务领取/延迟成为瓶颈 | Job payload/version、handler幂等，不先上Kafka |
| 媒体独立服务 | 处理资源或权限隔离明显需要 | MediaProcessor/Storage端口 |
| 多种身份来源 | 实际新增入口 | UserIdentity映射，不把openid当User主键 |
| 多活跃连接 | 有验证需求且治理能力足够 | Participant模型、规则版本；新版本才放开 |
| Taro大版本 | 当前支持/安全/跨端问题有明确升级收益 | 平台适配和组件回归；另开依赖升级PR |
| 推荐算法 | 候选规模和质量数据足够，简单规则有明确不足 | MatchPolicy窄接口、解释/退出，不先收集更多敏感数据 |
| AI总结 | 用户真正需要、同意/审核/准确性有方案 | SummaryProvider端口，默认关闭；不上传私密内容到不明第三方 |

维护版本化契约、明确单写入口、可重复测试和可恢复迁移，比提前搭一个万能平台更能降低重复成本。

## 13. 复跑当前交付物

### 无依赖的合成模拟

在仓库根目录执行：

```bash
node test/social-simulation.cjs --self-test
node test/social-simulation.cjs --runs=500 --seed=20260922
```

不要把输出当真实留存；更换假设要保留模型版本、种子、源文件hash和结果。源码SHA256可与结果JSON核验。

### 原生数据库压力测试

推荐用已有Docker的隔离开发机。以下是专用一次性测试库，不是生产compose；没有Docker时可提供等价原生PostgreSQL 16 loopback服务。

```bash
# 仅本地监听；结束后容器删除，不挂载生产卷
# 数据库名必须以project30_audit开头
# 若端口已占用，换独立端口并同步下方URL

docker run --rm -d --name project30-audit \
  -e POSTGRES_USER=audit \
  -e POSTGRES_PASSWORD=audit_local_only \
  -e POSTGRES_DB=project30_audit \
  -p 127.0.0.1:55432:5432 postgres:16

# 等待ready；先完成U01并安装项目依赖/生成Prisma Client
# 研究环境也可显式使用项目已有node_modules，不改变生产锁文件

docker exec project30-audit pg_isready -U audit -d project30_audit
export AUDIT_DATABASE_URL='postgresql://audit:audit_local_only@127.0.0.1:55432/project30_audit'
node_modules/.bin/prisma generate

# 只在空测试库第一次运行；执行当前正式迁移链，无测试专用补丁
node test/upgrade-stress.cjs --prepare-fixture --concurrency=50 --observe

# 必须串行执行，不能多个进程共用数据库（Chronos全局扫描）
node test/upgrade-stress.cjs --concurrency=1 --repeats=3 --samples=30 --observe
node test/upgrade-stress.cjs --concurrency=10 --repeats=3 --samples=30 --observe
node test/upgrade-stress.cjs --concurrency=200 --repeats=3 --samples=100 --observe

# 真正的当前服务门禁：不要加--observe；当前基线预期返回2
node test/upgrade-stress.cjs --concurrency=10 --repeats=1 --samples=5

# 测试后清理服务
# docker stop project30-audit
```

- 脚本拒绝非loopback和不匹配名字的数据库；拒绝已有用户/房间数据，不读取DATABASE_URL兜底。
- `--prepare-fixture` 调用正式 `prisma migrate deploy`，写入真实迁移历史；失败直接中止，不做测试内 schema 修补。
- 正常结束清理本轮用户、房间及reference记录，保留测试schema；异常进程退出可能留下数据，最简单的恢复方式是重建一次性容器，不对生产执行清理SQL。
- `--observe` 当前缺陷不使进程失败，但JSON仍为不通过；参考机制失败或runner异常仍返回1。默认当前不变量失败返回2。
- 原评估基线依赖不一致的问题已在 U01 修复，当前冻结安装通过；旧评估 JSON 的源码 hash 和迁移失败记录保留为历史证据。
- 本次实测没有使用Docker，而是在workspace准备PostgreSQL运行包；最终已停止该测试服务。测试命令输出可留档，但不要提交任何真实token或连接密码。

## 14. 下一次执行的开工提示

可直接把以下段落作为下一轮任务：

> 基于本方案继续 U02-B：先确认小程序 code 登录或 H5 OAuth 的真实渠道，实现可信身份提供方适配、唯一身份映射和登录入口限流；复用 U02-A 的 opaque 会话，不接受客户端自报 userId/openid，生产配置缺失时默认拒绝。测试覆盖 code 无效/重复、提供方超时、身份绑定冲突、会话轮换/注销以及前端 401，不以 mock 网络测试冒充真实微信集成完成。不要去掉因缺少成员/隐私基础而关闭的接口；安全 WS 需 U03 成员事实。保留现有 19 项基线与业务失败探针。每批完整验证后提交推送、更新 PR 和进度；云端 CI 仍需管理员授权，不擅自合并 main。

每个后续工单结束都更新：契约版本、已完成/未完成门禁、迁移状态、回滚方式、测试命令和证据链接。用这套节奏控制返工，而不是把所有优化一次性合入。
