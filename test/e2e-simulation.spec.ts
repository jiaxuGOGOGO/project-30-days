/**
 * ============================================================================
 * PROJECT 30-DAYS · E2E SIMULATION & STRESS TEST
 * ============================================================================
 *
 * 运行方式（需要 PostgreSQL + Redis 已启动）：
 *   npx tsx test/e2e-simulation.spec.ts
 *
 * 本脚本直接实例化 NestJS 应用上下文，调用核心 Service 层方法，
 * 验证三大极限场景的正确性。
 * ============================================================================
 */

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { YomiService } from '../src/yomi/yomi.service.js';
import { ChronosService } from '../src/chronos/chronos.service.js';
import { FateCardChoice } from '../src/yomi/dto/submit-yomi-answer.dto.js';
import { ConnectionStatus, Decision, RoomStatus, UserRole } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

async function createTestUser(prisma: PrismaService, overrides: Partial<{ role: UserRole }> = {}) {
  const id = randomUUID();
  return prisma.user.create({
    data: {
      id,
      wechat_openid: `test_openid_${id}`,
      shadow_video_url: `https://example.com/video/${id}.mp4`,
      fire_points: 3,
      role: overrides.role ?? UserRole.ACTIVE,
    },
  });
}

async function createTestRoom(prisma: PrismaService, overrides: Partial<{ startDate: Date; status: RoomStatus }> = {}) {
  const id = randomUUID();
  const startDate = overrides.startDate ?? new Date(Date.now() - 5 * ONE_DAY_MS);
  const endDate = new Date(startDate.getTime() + 30 * ONE_DAY_MS);
  return prisma.instanceRoom.create({
    data: {
      id,
      start_date: startDate,
      end_date: endDate,
      status: overrides.status ?? RoomStatus.RUNNING,
    },
  });
}

async function createTestFateCard(prisma: PrismaService) {
  const id = randomUUID();
  return prisma.fateCard.create({
    data: {
      id,
      question_text: `Test question ${id}`,
      option_a: 'Option A',
      option_b: 'Option B',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────────────────────────────────────

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let yomiService: YomiService;
let chronosService: ChronosService;

async function bootstrap(): Promise<void> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication();
  await app.init();

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
  yomiService = app.get(YomiService);
  chronosService = app.get(ChronosService);
}

async function teardown(): Promise<void> {
  await app?.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: 双盲博弈高并发防穿透 (Yomi Race Condition)
// ─────────────────────────────────────────────────────────────────────────────

async function testYomiRaceCondition(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  TEST 1: Yomi Race Condition — 20 Concurrent Pair Submissions');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const room = await createTestRoom(prisma);
  const fateCard = await createTestFateCard(prisma);
  const userA = await createTestUser(prisma);
  const userB = await createTestUser(prisma);

  console.log(`  Room:     ${room.id}`);
  console.log(`  FateCard: ${fateCard.id}`);
  console.log(`  User A:   ${userA.id}`);
  console.log(`  User B:   ${userB.id}`);
  console.log(`  Concurrency: 20 pairs (A->B and B->A simultaneously)\n`);

  // 发起 20 轮并发请求：每轮 A->B 和 B->A 在同一毫秒同时提交
  const CONCURRENCY = 20;
  const results: Array<{ aResult: any; bResult: any; aError: any; bError: any }> = [];

  for (let i = 0; i < CONCURRENCY; i++) {
    // 每轮清除 Redis 中可能存在的旧数据，确保独立测试
    const redisClient = redis.getClient();
    const keys = await redisClient.keys(`yomi:*${room.id}*`);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }

    // 清除之前可能产生的 connection
    await prisma.connection.deleteMany({ where: { room_id: room.id } });

    // 同时提交 A->B (选 A) 和 B->A (选 A)，双方选同一选项才能 MATCH
    const [aOutcome, bOutcome] = await Promise.allSettled([
      yomiService.submitAnswer({
        roomId: room.id,
        fateCardId: fateCard.id,
        actorUserId: userA.id,
        targetUserId: userB.id,
        selectedOption: FateCardChoice.A,
      }),
      yomiService.submitAnswer({
        roomId: room.id,
        fateCardId: fateCard.id,
        actorUserId: userB.id,
        targetUserId: userA.id,
        selectedOption: FateCardChoice.A,
      }),
    ]);

    results.push({
      aResult: aOutcome.status === 'fulfilled' ? aOutcome.value : null,
      bResult: bOutcome.status === 'fulfilled' ? bOutcome.value : null,
      aError: aOutcome.status === 'rejected' ? aOutcome.reason : null,
      bError: bOutcome.status === 'rejected' ? bOutcome.reason : null,
    });
  }

  // ─── 断言 ───
  let matchedCount = 0;
  let waitingCount = 0;
  let conflictCount = 0;

  for (const round of results) {
    const statuses: string[] = [];
    if (round.aResult) statuses.push(round.aResult.status);
    if (round.bResult) statuses.push(round.bResult.status);
    if (round.aError) conflictCount++;
    if (round.bError) conflictCount++;

    if (statuses.includes('MATCHED')) matchedCount++;
    if (statuses.includes('WAITING_FOR_COUNTERPART')) waitingCount++;
  }

  // 关键断言：每轮最终只能产生 0 或 1 条 SANDGLASS_24H 连接
  const finalConnections = await prisma.connection.findMany({
    where: { room_id: room.id, status: ConnectionStatus.SANDGLASS_24H },
  });

  console.log(`  Results Summary:`);
  console.log(`    MATCHED rounds:                  ${matchedCount}`);
  console.log(`    WAITING_FOR_COUNTERPART rounds:   ${waitingCount}`);
  console.log(`    Conflict (lock contention):       ${conflictCount}`);
  console.log(`    Final SANDGLASS_24H connections:  ${finalConnections.length}`);
  console.log('');

  // 核心断言：最后一轮结束后，数据库中只能有 0 或 1 条活跃连接
  assert.ok(
    finalConnections.length <= 1,
    `FATAL: Expected at most 1 SANDGLASS_24H connection, but found ${finalConnections.length}. Race condition NOT fixed!`
  );

  // 断言：不应该出现两人都 WAITING 的死锁情况（在同一轮中）
  for (let i = 0; i < results.length; i++) {
    const round = results[i];
    const bothWaiting =
      round.aResult?.status === 'WAITING_FOR_COUNTERPART' &&
      round.bResult?.status === 'WAITING_FOR_COUNTERPART';
    assert.ok(
      !bothWaiting,
      `FATAL: Round ${i + 1} — Both A and B returned WAITING_FOR_COUNTERPART simultaneously! Deadlock detected!`
    );
  }

  console.log('  ✅ TEST 1 PASSED: No race condition, no deadlock, no dirty data.\n');

  // 清理
  await prisma.connection.deleteMany({ where: { room_id: room.id } });
  await prisma.fateCard.delete({ where: { id: fateCard.id } });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await prisma.instanceRoom.delete({ where: { id: room.id } });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: 沙漏死神定时器 (Sandglass Timeout / Reaper)
// ─────────────────────────────────────────────────────────────────────────────

async function testSandglassReaper(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  TEST 2: Sandglass Reaper — 25h Expired Connection Destruction');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const room = await createTestRoom(prisma);
  const userA = await createTestUser(prisma);
  const userB = await createTestUser(prisma);

  // 创建一条 sandglass_started_at 为 25 小时前的连接
  const expiredTime = new Date(Date.now() - 25 * ONE_HOUR_MS);
  const connection = await prisma.connection.create({
    data: {
      id: randomUUID(),
      room_id: room.id,
      user_a_id: userA.id,
      user_b_id: userB.id,
      status: ConnectionStatus.SANDGLASS_24H,
      connected_days: 0,
      user_a_decision: Decision.NULL,
      user_b_decision: Decision.NULL,
      sandglass_started_at: expiredTime,
    },
  });

  console.log(`  Connection ID:         ${connection.id}`);
  console.log(`  Status (before):       ${connection.status}`);
  console.log(`  sandglass_started_at:  ${expiredTime.toISOString()} (25h ago)`);
  console.log('');

  // 手动调用 Sandglass Reaper 定时任务
  await chronosService.shatterExpiredSandglassConnections();

  // 重新读取连接
  const afterReap = await prisma.connection.findUnique({ where: { id: connection.id } });

  console.log(`  Status (after reap):   ${afterReap?.status}`);
  console.log(`  destroyed_at:          ${afterReap?.destroyed_at?.toISOString() ?? 'null'}`);
  console.log('');

  // ─── 断言 ───
  assert.ok(afterReap, 'Connection should still exist in database (soft delete)');
  assert.strictEqual(
    afterReap.status,
    ConnectionStatus.DESTROYED,
    `Expected status DESTROYED, got ${afterReap.status}`
  );
  assert.ok(
    afterReap.destroyed_at !== null,
    'destroyed_at should be set to a non-null timestamp'
  );
  assert.ok(
    afterReap.destroyed_at!.getTime() > expiredTime.getTime(),
    'destroyed_at should be after the original sandglass_started_at'
  );

  console.log('  ✅ TEST 2 PASSED: Expired sandglass correctly reaped to DESTROYED.\n');

  // 清理
  await prisma.connection.delete({ where: { id: connection.id } });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await prisma.instanceRoom.delete({ where: { id: room.id } });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Day 15 幽灵化坍缩 (Watcher Transition)
// ─────────────────────────────────────────────────────────────────────────────

async function testDay15WatcherCollapse(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  TEST 3: Day 15 Watcher Collapse — Unlinked ACTIVE → WATCHER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 创建一个 16 天前开始的房间（确保已过 Day 15）
  const startDate = new Date(Date.now() - 16 * ONE_DAY_MS);
  const room = await createTestRoom(prisma, { startDate, status: RoomStatus.RUNNING });

  // 创建三个用户
  const userLinked = await createTestUser(prisma, { role: UserRole.ACTIVE });
  const userUnlinked = await createTestUser(prisma, { role: UserRole.ACTIVE });
  const userPartner = await createTestUser(prisma, { role: UserRole.ACTIVE });

  // userLinked 与 userPartner 有 DEEP_LINK 连接（不应被坍缩）
  await prisma.connection.create({
    data: {
      id: randomUUID(),
      room_id: room.id,
      user_a_id: userLinked.id,
      user_b_id: userPartner.id,
      status: ConnectionStatus.DEEP_LINK,
      connected_days: 15,
      user_a_decision: Decision.NULL,
      user_b_decision: Decision.NULL,
      deep_link_started_at: new Date(Date.now() - 15 * ONE_DAY_MS),
    },
  });

  // userUnlinked 只有一条已 DESTROYED 的连接（不算有效链接）
  await prisma.connection.create({
    data: {
      id: randomUUID(),
      room_id: room.id,
      user_a_id: userUnlinked.id,
      user_b_id: userPartner.id,
      status: ConnectionStatus.DESTROYED,
      connected_days: 3,
      user_a_decision: Decision.NULL,
      user_b_decision: Decision.NULL,
      destroyed_at: new Date(Date.now() - 10 * ONE_DAY_MS),
    },
  });

  console.log(`  Room ID:        ${room.id} (started ${startDate.toISOString()}, 16 days ago)`);
  console.log(`  User Linked:    ${userLinked.id} (has DEEP_LINK, should stay ACTIVE)`);
  console.log(`  User Unlinked:  ${userUnlinked.id} (no DEEP_LINK, should become WATCHER)`);
  console.log(`  User Partner:   ${userPartner.id} (has DEEP_LINK, should stay ACTIVE)`);
  console.log('');

  // 手动调用 Day 15 坍缩定时任务
  await chronosService.advanceDeepLinkDaysAndCollapseDayFifteen();

  // 重新读取用户
  const afterLinked = await prisma.user.findUnique({ where: { id: userLinked.id } });
  const afterUnlinked = await prisma.user.findUnique({ where: { id: userUnlinked.id } });
  const afterPartner = await prisma.user.findUnique({ where: { id: userPartner.id } });

  console.log(`  After collapse:`);
  console.log(`    User Linked role:    ${afterLinked?.role}`);
  console.log(`    User Unlinked role:  ${afterUnlinked?.role}`);
  console.log(`    User Partner role:   ${afterPartner?.role}`);
  console.log('');

  // ─── 断言 ───
  assert.strictEqual(
    afterUnlinked?.role,
    UserRole.WATCHER,
    `Expected unlinked user to become WATCHER, got ${afterUnlinked?.role}`
  );
  assert.strictEqual(
    afterLinked?.role,
    UserRole.ACTIVE,
    `Expected linked user to remain ACTIVE, got ${afterLinked?.role}`
  );
  assert.strictEqual(
    afterPartner?.role,
    UserRole.ACTIVE,
    `Expected partner user to remain ACTIVE, got ${afterPartner?.role}`
  );

  console.log('  ✅ TEST 3 PASSED: Unlinked user correctly collapsed to WATCHER.\n');

  // 清理
  await prisma.connection.deleteMany({ where: { room_id: room.id } });
  await prisma.user.deleteMany({ where: { id: { in: [userLinked.id, userUnlinked.id, userPartner.id] } } });
  await prisma.instanceRoom.delete({ where: { id: room.id } });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  PROJECT 30-DAYS · E2E SIMULATION & STRESS TEST             ║');
  console.log('║  Time Travel + Extreme Concurrency Verification             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  try {
    await bootstrap();

    await testYomiRaceCondition();
    await testSandglassReaper();
    await testDay15WatcherCollapse();

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  🎉 ALL 3 TESTS PASSED — System integrity verified.');
    console.log('══════════════════════════════════════════════════════════════\n');
  } catch (error) {
    console.error('\n  ❌ TEST FAILURE:', (error as Error).message);
    console.error('  Stack:', (error as Error).stack);
    process.exitCode = 1;
  } finally {
    await teardown();
  }
}

main();
