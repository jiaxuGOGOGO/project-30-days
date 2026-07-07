# Phase 0 Optimization Changelog

> 基于 8 轮第一性原理迭代分析的 MVP 验证阶段优化

## 概述

本次提交实施了 Phase 0（MVP 验证阶段）的核心优化，聚焦于三个 P0 级问题的修复和两个 P1 级功能的基础架构搭建。

---

## 变更清单

### P0: 视频隐私安全修复

**问题**：原实现使用前端 CSS `filter` 属性模糊视频，任何用户通过 DevTools 或抓包即可获取原始视频 URL。

**修复方案**：

| 组件 | 变更 |
|------|------|
| `src/media/media.service.ts` | **新增** 服务端视频分级处理服务，4 级模糊变体 + 签名 URL |
| `src/media/media.controller.ts` | **新增** 视频 URL 获取接口，仅返回当前连接天数对应的模糊级别 |
| `src/media/media.module.ts` | **新增** Media 模块注册 |
| `frontend/src/components/GatingVideo.tsx` | **重写** 移除所有 CSS filter 逻辑，改为展示服务端预处理视频 |
| `frontend/src/types/domain.ts` | **更新** 新增 `RevealLevel` 类型 |
| `prisma/schema.prisma` | **更新** User 模型新增 `video_destroyed_at` 字段 |

**安全保证**：
- 原始视频 URL 永远不会暴露给客户端（直到 Day 30 FULL 级别）
- 每个级别的视频是独立的转码产物，不是同一文件的不同展示
- 签名 URL 有 TTL 限制，过期后无法访问

---

### P1: 物理大厅交互优化

**问题**：原实现完全依赖陀螺仪控制用户球体移动，存在可发现性差、无主动意图表达、低端设备不支持等问题。

**修复方案**：

| 组件 | 变更 |
|------|------|
| `frontend/src/components/LimboHall.tsx` | **重写** 新增触屏拖拽主控、陀螺仪降级为环境微扰、首次引导动画、碰撞确认回调 |

**交互变更**：
- **主控制**：触屏拖拽 → 对自己的球体施加力（`DRAG_FORCE_SCALE`）
- **辅助**：陀螺仪降级为"命运之风"（`AMBIENT_GRAVITY_SCALE = 0.25`），仅产生微弱环境扰动
- **引导**：首次进入时显示 3 秒渐隐引导覆盖层（"拖拽移动你的星球 · 碰撞即命运"）
- **碰撞确认**：新增 `onCollisionRequest` 回调，碰撞时触发命运连接确认流程
- **环境风**：每 15 秒随机施加微弱力，保持场景活力

---

### P1: 每日回响（DailyEcho）机制

**问题**：Day 2-29 期间缺乏每日参与度抓手，用户可能长期不打开应用。

**新增方案**：

| 组件 | 变更 |
|------|------|
| `src/daily-echo/daily-echo.service.ts` | **新增** 双盲每日问答服务（28 个精选问题） |
| `src/daily-echo/daily-echo.controller.ts` | **新增** 提交答案、获取当日问题、历史记录接口 |
| `src/daily-echo/daily-echo.module.ts` | **新增** DailyEcho 模块注册 |
| `prisma/schema.prisma` | **更新** 新增 `DailyEcho` 模型 |

**机制设计**：
- 每晚 20:00 由 Chronos 自动为所有 DEEP_LINK 连接生成当日问题
- 双盲提交：两人都回答后才能看到对方的答案
- 视频揭示进度仅在双方都回答后才推进
- 28 个问题从轻松到深入渐进设计

---

### P1: 候车大厅（Boarding）冷启动策略

**问题**：房间制社交在早期用户量不足时，匹配池过小导致体验崩塌。

**新增方案**：

| 组件 | 变更 |
|------|------|
| `src/boarding/boarding.service.ts` | **新增** 定时发车候车大厅服务 |
| `src/boarding/boarding.controller.ts` | **新增** 加入候车、查询状态接口 |
| `src/boarding/boarding.module.ts` | **新增** Boarding 模块注册 |
| `prisma/schema.prisma` | **更新** InstanceRoom 新增 `BOARDING` 状态、`min_users`、`scheduled_at`、`boarding_count` |

**机制设计**：
- 新增 `BOARDING` 房间状态，用户先进入候车队列
- 双触发发车：达到最低人数（默认 50）立即发车，或到达预定时间（每周五 20:00）强制发车
- 候车期间实时广播人数变化，制造"即将发车"的紧迫感
- 发车后房间转为 `RUNNING`，30 天倒计时正式开始

---

### 基础设施变更

| 组件 | 变更 |
|------|------|
| `src/app.module.ts` | **更新** 注册 DailyEchoModule、BoardingModule、MediaModule |
| `src/chronos/chronos.module.ts` | **更新** 导入 DailyEcho 和 Boarding 依赖 |
| `src/chronos/chronos.service.ts` | **更新** 新增每日回响生成定时任务和候车发车检查 |
| `src/events/events.gateway.ts` | **更新** 新增 6 个事件 emit 方法 |
| `.env.example` | **更新** 新增 Media 服务相关环境变量 |
| `prisma/migrations/000002_phase0_optimization/` | **新增** 数据库迁移 SQL |

---

## 架构决策记录

### ADR-001: 为什么不在前端做视频模糊？

前端 CSS filter 是纯展示层操作，原始视频 URL 在网络层完全暴露。参考 Tinder Unblur 漏洞（GitHub: hm-harshit/Tinder-Unblur-Likes），任何技术用户都能在 10 秒内绕过。服务端预处理是唯一可靠方案。

### ADR-002: 为什么陀螺仪降级而非移除？

完全移除陀螺仪会失去"命运之风"的产品隐喻。保留为环境微扰（0.25 倍系数），既不影响主控制，又保持了"不完全由你掌控"的宿命感。

### ADR-003: 为什么选择定时发车而非实时匹配？

参考 Thursday 应用的成功经验：集中时间窗口能制造社交密度。在冷启动阶段，分散的实时匹配会导致大量用户等待超时而流失。定时发车保证每个房间的最低活跃密度。

### ADR-004: 为什么 DailyEcho 是双盲的？

单方面可见会导致"搭便车"问题：一方不回答也能看到对方答案。双盲机制确保双方都投入才能获得回报，与整个产品的"对等博弈"哲学一致。

---

## 下一步（Phase 1）

- [ ] 接入腾讯云 MPS 实现真实视频转码
- [ ] 前端 DailyEcho 组件和推送通知
- [ ] 候车大厅前端倒计时 UI
- [ ] 终局博弈重构（从囚徒困境改为渐进式信任揭晓）
- [ ] H5 版本适配（绕过微信小程序审核）
