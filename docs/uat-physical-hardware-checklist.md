# 真机物理硬件终极验收 Checklist

作者：**Manus AI**

本文档用于进入真实用户验收（UAT）前的**真机人肉验收**。验收必须在至少一台 iOS 真机与一台 Android 真机上分别执行，且必须使用微信开发者工具预览码或体验版小程序包，而不是仅在浏览器或模拟器中验证。原因是本项目的关键风险集中在小程序原生能力、Canvas 2D、陀螺仪、触摸取消、震动马达和相册/分享授权链路上，这些能力在模拟器中无法完全等价替代。

> **通过标准**：所有 P0 项必须全部通过；P1 项允许记录缺陷但不得影响主流程；任何出现后台震动残留、Canvas 白屏、状态机误触发、幽灵刚体仍参与碰撞的问题，都必须阻断 UAT 发布。

## 本地联调启动命令

建议先确认 PostgreSQL 与 Redis 已启动，并且 `.env` 中的 `DATABASE_URL`、`REDIS_URL` 与本机服务一致。后端与前端可以分两个终端并行启动。

| 终端 | 命令 | 目的 |
|---|---|---|
| Terminal A | `cd /home/ubuntu/project-30-days && npm run start:dev` | 启动 NestJS 后端服务，供 Prisma、Redis、Day30 API 与调试请求使用。 |
| Terminal B | `cd /home/ubuntu/project-30-days && npm run frontend:dev:weapp` | 启动 Taro 微信小程序编译监听，并用微信开发者工具导入 `frontend/dist` 或对应输出目录。 |
| Terminal C | `cd /home/ubuntu/project-30-days && npm run test:e2e` | 运行默认 `E2E_CONCURRENCY=20` 的后端 e2e 压测。 |
| Terminal C | `cd /home/ubuntu/project-30-days && E2E_CONCURRENCY=1000 npm run test:e2e` | 运行高并发 Redis 锁轰炸测试；若在 Windows PowerShell 下执行，则直接使用 npm script 内置的 `cross-env` 默认值，或改用 `npx cross-env E2E_CONCURRENCY=1000 tsx test/e2e-simulation.spec.ts`。 |

## DebugTimeMachine 挂载说明

`DebugTimeMachine.tsx` 最适合**挂载在首页 `frontend/src/pages/index/index.tsx` 的页面根节点末尾**，因为首页同时渲染了 `LimboHall` 与 `GatingVideo`，可以直接观察天数滑块、幽灵开关和物理刚体状态变化。当前实现已经在首页末尾挂载：

```tsx
<DebugTimeMachine />
```

不建议默认挂载在 `app.tsx`。虽然全局挂载可以让每个页面都看到调试面板，但它会覆盖 Day30 独立页、Canvas 导出页和后续可能出现的授权页，增加误触和遮挡风险。若未来需要全局调试面板，应在 `app.tsx` 中增加显式的开发态开关和页面白名单。

## LimboHall 真机物理验收

| 编号 | 优先级 | 验收项 | 操作步骤 | 期望结果 | 实测记录 |
|---|---:|---|---|---|---|
| LH-01 | P0 | 陀螺仪实机帧率 | 真机打开首页，缓慢左右倾斜手机 30 秒，再快速旋转 10 秒。 | Canvas 动画持续稳定，碎片受重力方向影响自然滑动，无明显 1 秒以上卡死。 | [ ] |
| LH-02 | P0 | 陀螺仪权限与降级 | 首次进入页面时观察系统授权、控制台日志和 UI 表现；拒绝或关闭传感器权限后再次进入。 | 未授权时页面不白屏、不崩溃；物理世界仍能渲染，只有重力输入失效。 | [ ] |
| LH-03 | P0 | 15px 容错点击 | 逐个点击碎片边缘外约 10px、15px、20px 的位置。 | 10px 与 15px 附近可触发选中反馈；20px 外不应大量误触。 | [ ] |
| LH-04 | P0 | 幽灵刚体防穿透 | 打开 DebugTimeMachine，点击“幽灵开关：ACTIVE → WATCHER”。 | 当前用户 `role=WATCHER` 后，`LimboHall` 重建/更新为 `isSensor=true`，失去碰撞体积，并在重力下向底部沉降，不再顶开其他实体。 | [ ] |
| LH-05 | P0 | 幽灵恢复刚体 | 再次点击幽灵开关切回 ACTIVE。 | 当前用户 `isSensor=false`，恢复碰撞体积，不再作为纯观察者穿过其他实体。 | [ ] |
| LH-06 | P1 | 多碎片碰撞震动节流 | 用真机快速晃动制造连续碰撞。 | 轻震动有反馈但不过载，系统不会出现持续震动或触觉反馈风暴。 | [ ] |
| LH-07 | P1 | 前后台切换 | 动画运行中切后台 30 秒再回前台。 | 无重复注册陀螺仪监听，无多倍加速、帧率暴跌或内存明显上涨。 | [ ] |

## GatingVideo 与 DebugTimeMachine 验收

| 编号 | 优先级 | 验收项 | 操作步骤 | 期望结果 | 实测记录 |
|---|---:|---|---|---|---|
| GT-01 | P0 | Day 1-6 剪影 | 打开 DebugTimeMachine，将 Day Slider 拖到 1、3、6。 | 视频呈现高反差剪影/强遮蔽状态，人物细节不可辨认。 | [ ] |
| GT-02 | P0 | Day 7-14 毛玻璃 | 将 Day Slider 拖到 7、10、14。 | 视频从剪影平滑过渡到明显毛玻璃，能感知动态但不可清晰识别。 | [ ] |
| GT-03 | P0 | Day 15-29 接近清晰 | 将 Day Slider 拖到 15、22、29。 | 模糊显著降低，逐步接近清晰，但未完全揭示。 | [ ] |
| GT-04 | P0 | Day 30 终局清晰 | 将 Day Slider 拖到 30。 | 视频滤镜取消，进入完全清晰状态。 | [ ] |
| GT-05 | P1 | 面板遮挡与折叠 | 展开和折叠 DebugTimeMachine，并尝试点击底层碎片。 | 展开态仅遮挡右下角有限区域；折叠后大部分底层交互恢复可操作。 | [ ] |

## Day30Judgment 终局验收

| 编号 | 优先级 | 验收项 | 操作步骤 | 期望结果 | 实测记录 |
|---|---:|---|---|---|---|
| D30-01 | P0 | Overlay 直达终局 | 在首页打开 DebugTimeMachine，点击“直达终局”。 | 当前页面直接出现 Day30Judgment overlay，不跳转页面；`connectedDays` 同步为 30。 | [ ] |
| D30-02 | P0 | 双向奔赴结局 | Debug radio 选择 `COOPERATE`，在终局中长按 `COOPERATE` 满 2000ms。 | 结果为 `LEGACY`，无灰烬票据。 | [ ] |
| D30-03 | P0 | 单防化灰结局 | Debug radio 选择 `DEFECT`，在终局中长按 `COOPERATE` 满 2000ms；或 radio 选择 `COOPERATE`，长按 `DEFECT`。 | 结果为 `ASH`，出现 LegacyTicket Canvas。 | [ ] |
| D30-04 | P0 | 极限防抖：touchCancel | 长按任一终局卡片约 1000-1800ms，手指突然滑出组件区域触发 `touchCancel`。 | 倒计时立即清零，马达瞬间停止，不提交结果，不产生后台计时器残留。 | [ ] |
| D30-05 | P0 | 极限防抖：2000ms 临界释放 | 长按约 1900ms 时松手，再长按约 2100ms。 | 1900ms 不提交；2100ms 只提交一次，不重复弹出结果。 | [ ] |
| D30-06 | P0 | 后台切换中断 | 长按进行中直接切到后台，再回到小程序。 | 不允许后台继续计时到提交；回前台后状态应安全复位。 | [ ] |
| D30-07 | P1 | 多指触摸干扰 | 两指同时触碰两个选择卡片。 | 不应出现两个选择同时提交；最终最多产生一个结果。 | [ ] |
| D30-08 | P1 | 重置本地裁决 | 出现结果后点击 `RESET LOCAL JUDGMENT`。 | 结果清空，可重新进行长按决策。 | [ ] |

## LegacyTicket Canvas 与相册/分享验收

| 编号 | 优先级 | 验收项 | 操作步骤 | 期望结果 | 实测记录 |
|---|---:|---|---|---|---|
| LT-01 | P0 | Canvas 2D 高清度 | 触发 `ASH` 结局，查看 LegacyTicket。 | Canvas 不白屏、不闪烁，边框与文字清晰，dpr 放大后无明显糊边。 | [ ] |
| LT-02 | P0 | 高 dpr 设备 | 在至少一台高 dpr 手机上触发灰烬票据。 | 输出尺寸与视觉清晰度稳定，不因 dpr 导致裁切、变形或内存异常。 | [ ] |
| LT-03 | P0 | 保存/分享 API 授权 | 点击导出/分享票据，首次授权时选择允许。 | 正常生成临时图片并进入系统分享/保存链路。 | [ ] |
| LT-04 | P0 | 授权拒绝流转 | 清理授权后再次导出，首次选择拒绝。 | 页面不崩溃；能明确提示用户授权失败或引导重新授权。 | [ ] |
| LT-05 | P1 | 多次重复导出 | 连续点击导出 5 次。 | 不白屏、不泄漏多个 Canvas 上下文，不生成损坏图片。 | [ ] |
| LT-06 | P1 | 低端机性能 | 在低端 Android 真机触发导出。 | 图片生成可接受，若耗时较长应保持 UI 有反馈且不阻塞整页。 | [ ] |

## Redis 锁与状态机回归验收

| 编号 | 优先级 | 验收项 | 操作步骤 | 期望结果 | 实测记录 |
|---|---:|---|---|---|---|
| BE-01 | P0 | 默认并发压测 | 执行 `npm run test:e2e`。 | 输出并发统计，并显示全部测试 PASS。 | [ ] |
| BE-02 | P0 | 高并发参数化压测 | 执行 `E2E_CONCURRENCY=1000 npm run test:e2e`。 | 成功数、冲突数、耗时清晰输出；无死锁、无重复 ACTIVE 连接、无脏数据。 | [ ] |
| BE-03 | P0 | 沙漏销毁 | 检查 TEST 2。 | 超过 25h 的 `SANDGLASS_24H` 被推进为 `DESTROYED`。 | [ ] |
| BE-04 | P0 | Day15 边界保护 | 检查 TEST 3。 | 无保护关系或仅 DESTROYED 的 ACTIVE 用户坍缩为 WATCHER；DEEP_LINK 与 SANDGLASS_24H 关系用户保持 ACTIVE。 | [ ] |

## UAT 阻断标准

| 阻断项 | 判定标准 | 处理要求 |
|---|---|---|
| 后台震动残留 | `touchCancel`、松手、切后台后仍持续震动或继续倒计时。 | 必须修复计时器、震动调用和生命周期清理后才能进入 UAT。 |
| Canvas 白屏 | LegacyTicket 在任一主流真机上出现空白、导出失败且无提示。 | 必须修复 Canvas 节点查询、dpr 缩放或授权链路。 |
| 幽灵刚体仍碰撞 | WATCHER 仍能顶开 ACTIVE 或被墙体卡住。 | 必须修复角色到 `isSensor` 的映射或物理世界重建逻辑。 |
| Redis 锁压测失败 | 并发测试出现死锁、重复连接或脏数据。 | 必须阻断上线，回滚匹配锁相关变更。 |
| 状态机误推进 | DEEP_LINK/SANDGLASS 用户被错误坍缩，或应坍缩用户未坍缩。 | 必须修复 SQL 边界并补充回归测试。 |
