/**
 * ============================================================================
 * PROJECT 30-DAYS · E2E SIMULATION & STRESS TEST
 * ============================================================================
 *
 * 运行方式（需要 PostgreSQL + Redis 已启动）：
 *   npm run test:e2e
 *   E2E_CONCURRENCY=1000 npm run test:e2e
 *
 * 本脚本通过 tsc 编译后运行，手动组合真实业务服务和隔离数据库。
 * 仅覆盖三个历史集成场景；真实 Nest 启动/HTTP 校验另见 baseline.spec.cjs。
 * 必须显式设置 E2E_DATABASE_URL 与 E2E_REDIS_URL，拒绝生产库和非本地地址。
 * ============================================================================
 */

import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { ConnectionStatus, Decision, RoomStatus, UserRole } from '@prisma/client';
import { ChronosService } from '../src/chronos/chronos.service.js';
import { BoardingService } from '../src/boarding/boarding.service.js';
import { DailyEchoService } from '../src/daily-echo/daily-echo.service.js';
import { EventsGateway } from '../src/events/events.gateway.js';
import { HourglassService } from '../src/hourglass/hourglass.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { FateCardChoice } from '../src/yomi/dto/submit-yomi-answer.dto.js';
import { YomiService, type YomiSubmissionResult } from '../src/yomi/yomi.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const DEFAULT_E2E_CONCURRENCY = 20;
const fixtureUserIds: string[] = [];
const fixtureRoomIds: string[] = [];
const fixtureCardIds: string[] = [];

function configureIsolatedEnvironment(): void {
  const database = new URL(process.env.E2E_DATABASE_URL ?? 'missing:');
  const cache = new URL(process.env.E2E_REDIS_URL ?? 'missing:');
  const local = (url: URL) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  assert.ok(local(database) && ['postgres:', 'postgresql:'].includes(database.protocol));
  assert.match(database.pathname, /^\/project30_test[a-z0-9_]*$/);
  assert.ok(!database.searchParams.has('host'));
  assert.ok(!database.searchParams.has('schema') || database.searchParams.get('schema') === 'public');
  assert.ok(local(cache) && cache.protocol === 'redis:');
  assert.match(cache.pathname, /^\/(?:[1-9]|1[0-5])$/);
  process.env.DATABASE_URL = database.toString();
  process.env.REDIS_URL = cache.toString();
}

function parseConcurrency(): number {
  const raw = process.env.E2E_CONCURRENCY;
  if (!raw) return DEFAULT_E2E_CONCURRENCY;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`E2E_CONCURRENCY must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

function getErrorStatus(error: unknown): number | undefined {
  const candidate = error as { getStatus?: () => number; status?: number; statusCode?: number };
  if (typeof candidate.getStatus === 'function') return candidate.getStatus();
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function createTestUser(prisma: PrismaService, overrides: Partial<{ role: UserRole }> = {}) {
  const id = randomUUID();
  fixtureUserIds.push(id);
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
  fixtureRoomIds.push(id);
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
  fixtureCardIds.push(id);
  return prisma.fateCard.create({
    data: {
      id,
      question_text: `Test question ${id}`,
      option_a: 'Option A',
      option_b: 'Option B',
    },
  });
}

async function purgeYomiKeys(roomId: string): Promise<void> {
  const client = redis.getClient();
  let cursor = '0';
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', `yomi:*:${roomId}:*`, 'COUNT', 100);
    cursor = next;
    if (keys.length > 0) await client.del(...keys);
  } while (cursor !== '0');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST RUNNER — 手动显式 DI，避免 tsx/esbuild metadata 陷阱
// ─────────────────────────────────────────────────────────────────────────────

let prisma: PrismaService;
let redis: RedisService;
let yomiService: YomiService;
let chronosService: ChronosService;

async function bootstrap(): Promise<void> {
  configureIsolatedEnvironment();
  prisma = new PrismaService();
  await prisma.onModuleInit();
  assert.equal(await prisma.user.count(), 0, 'Legacy Chronos tests require an empty test database');
  assert.equal(await prisma.instanceRoom.count(), 0, 'Legacy Chronos tests require an empty room database');

  redis = new RedisService();
  await redis.onModuleInit();

  const eventsGateway = new EventsGateway();
  const echoes = new DailyEchoService(prisma, eventsGateway);
  const boarding = new BoardingService(prisma, eventsGateway);
  const hourglass = new HourglassService(prisma, eventsGateway);
  yomiService = new YomiService(prisma, redis, eventsGateway);
  chronosService = new ChronosService(prisma, redis, eventsGateway, echoes, boarding, hourglass);
}

async function teardown(): Promise<void> {
  try {
    if (prisma && fixtureRoomIds.length > 0) {
      for (const roomId of fixtureRoomIds) await purgeYomiKeys(roomId);
      await prisma.instanceRoom.deleteMany({ where: { id: { in: fixtureRoomIds } } });
      await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
      await prisma.fateCard.deleteMany({ where: { id: { in: fixtureCardIds } } });
    }
  } finally {
    await Promise.allSettled([redis?.onModuleDestroy(), prisma?.onModuleDestroy()]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: 双盲博弈高并发防穿透 (Yomi Race Condition)
// ─────────────────────────────────────────────────────────────────────────────

type Direction = 'A_TO_B' | 'B_TO_A';

type SubmissionProbe = {
  direction: Direction;
  index: number;
  durationMs: number;
  ok: true;
  result: YomiSubmissionResult;
} | {
  direction: Direction;
  index: number;
  durationMs: number;
  ok: false;
  status?: number;
  message: string;
};

async function testYomiRaceCondition(): Promise<void> {
  const concurrency = parseConcurrency();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  TEST 1: Yomi Race Condition — ${concurrency} Concurrent Pair Submissions`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const room = await createTestRoom(prisma);
  const fateCard = await createTestFateCard(prisma);
  const userA = await createTestUser(prisma);
  const userB = await createTestUser(prisma);

  console.log(`  Room:                 ${room.id}`);
  console.log(`  FateCard:             ${fateCard.id}`);
  console.log(`  User A:               ${userA.id}`);
  console.log(`  User B:               ${userB.id}`);
  console.log(`  E2E_CONCURRENCY:      ${concurrency}`);
  console.log(`  Total submissions:    ${concurrency * 2} (A→B and B→A storm via Promise.all)\n`);

  await purgeYomiKeys(room.id);
  await prisma.connection.deleteMany({ where: { room_id: room.id } });

  const submit = async (direction: Direction, index: number): Promise<SubmissionProbe> => {
    const startedAt = performance.now();
    const actorUserId = direction === 'A_TO_B' ? userA.id : userB.id;
    const targetUserId = direction === 'A_TO_B' ? userB.id : userA.id;

    try {
      const result = await yomiService.submitAnswer({
        roomId: room.id,
        fateCardId: fateCard.id,
        actorUserId,
        targetUserId,
        selectedOption: FateCardChoice.A,
      });
      return {
        direction,
        index,
        durationMs: performance.now() - startedAt,
        ok: true,
        result,
      };
    } catch (error) {
      return {
        direction,
        index,
        durationMs: performance.now() - startedAt,
        ok: false,
        status: getErrorStatus(error),
        message: getErrorMessage(error),
      };
    }
  };

  const tasks: Array<Promise<SubmissionProbe>> = [];
  for (let i = 0; i < concurrency; i += 1) {
    tasks.push(submit('A_TO_B', i + 1));
    tasks.push(submit('B_TO_A', i + 1));
  }

  const stormStartedAt = performance.now();
  const outcomes = await Promise.all(tasks);
  const elapsedMs = performance.now() - stormStartedAt;

  const fulfilled = outcomes.filter((item): item is Extract<SubmissionProbe, { ok: true }> => item.ok);
  const rejected = outcomes.filter((item): item is Extract<SubmissionProbe, { ok: false }> => !item.ok);
  const conflicts = rejected.filter((item) => item.status === 409 || /conflict|cooling|being matched/i.test(item.message));
  const unexpectedFailures = rejected.filter((item) => !conflicts.includes(item));
  const matched = fulfilled.filter((item) => item.result.status === 'MATCHED');
  const waiting = fulfilled.filter((item) => item.result.status === 'WAITING_FOR_COUNTERPART');
  const rejectedAndCooldown = fulfilled.filter((item) => item.result.status === 'REJECTED_AND_COOLDOWN');
  const avgDurationMs = outcomes.reduce((sum, item) => sum + item.durationMs, 0) / outcomes.length;
  const maxDurationMs = Math.max(...outcomes.map((item) => item.durationMs));

  // 如果同一轮锁风暴中只有一个方向成功写入 WAITING，追加一次反向 settle，验证状态机能正常推进到 MATCHED。
  if (matched.length === 0 && waiting.length > 0) {
    const waitingSubmission = waiting[0];
    assert.ok(waitingSubmission);
    const firstWaiting = waitingSubmission.result;
    const settleStartedAt = performance.now();
    const settleResult = await yomiService.submitAnswer({
      roomId: room.id,
      fateCardId: fateCard.id,
      actorUserId: firstWaiting.targetUserId,
      targetUserId: firstWaiting.actorUserId,
      selectedOption: FateCardChoice.A,
    });
    console.log('  Post-storm settle submission:');
    console.log(`    status:              ${settleResult.status}`);
    console.log(`    duration_ms:         ${(performance.now() - settleStartedAt).toFixed(2)}`);
  }

  const finalConnections = await prisma.connection.findMany({
    where: {
      room_id: room.id,
      status: { not: ConnectionStatus.DESTROYED },
      OR: [
        { user_a_id: userA.id, user_b_id: userB.id },
        { user_a_id: userB.id, user_b_id: userA.id },
      ],
    },
    orderBy: { created_at: 'asc' },
  });

  const finalConnectionStatuses = finalConnections.map((connection) => connection.status).join(', ') || 'NONE';

  console.log('\n  Results Summary:');
  console.log(`    submissions_total:          ${outcomes.length}`);
  console.log(`    success_total:              ${fulfilled.length}`);
  console.log(`    conflict_total:             ${conflicts.length}`);
  console.log(`    unexpected_failure_total:   ${unexpectedFailures.length}`);
  console.log(`    matched_total:              ${matched.length}`);
  console.log(`    waiting_total:              ${waiting.length}`);
  console.log(`    cooldown_total:             ${rejectedAndCooldown.length}`);
  console.log(`    elapsed_ms:                 ${elapsedMs.toFixed(2)}`);
  console.log(`    avg_submission_ms:          ${avgDurationMs.toFixed(2)}`);
  console.log(`    max_submission_ms:          ${maxDurationMs.toFixed(2)}`);
  console.log(`    final_active_connections:   ${finalConnections.length}`);
  console.log(`    final_connection_statuses:  ${finalConnectionStatuses}`);
  console.log('');

  assert.strictEqual(
    unexpectedFailures.length,
    0,
    `Unexpected non-conflict failures: ${unexpectedFailures.map((item) => item.message).join(' | ')}`,
  );
  assert.ok(fulfilled.length > 0, 'Expected at least one submission to acquire the Redis lock and complete business logic');
  assert.equal(
    finalConnections.length,
    1,
    `Expected exactly 1 settled connection for the canonical pair, got ${finalConnections.length}`,
  );

  console.log('  ✅ TEST 1 PASSED: No race condition, no deadlock, no dirty data.\n');

  await purgeYomiKeys(room.id);
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

  await chronosService.shatterExpiredSandglassConnections();

  const afterReap = await prisma.connection.findUnique({ where: { id: connection.id } });

  console.log(`  Status (after reap):   ${afterReap?.status}`);
  console.log(`  destroyed_at:          ${afterReap?.destroyed_at?.toISOString() ?? 'null'}`);
  console.log('');

  assert.ok(afterReap, 'Connection should still exist in database (soft delete)');
  assert.strictEqual(afterReap.status, ConnectionStatus.DESTROYED, `Expected status DESTROYED, got ${afterReap.status}`);
  assert.ok(afterReap.destroyed_at !== null, 'destroyed_at should be set to a non-null timestamp');
  assert.ok(afterReap.destroyed_at!.getTime() > expiredTime.getTime(), 'destroyed_at should be after sandglass_started_at');

  console.log('  ✅ TEST 2 PASSED: Expired sandglass correctly reaped to DESTROYED.\n');

  await prisma.connection.delete({ where: { id: connection.id } });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await prisma.instanceRoom.delete({ where: { id: room.id } });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Day 15 幽灵化坍缩边界 (Watcher Transition Boundaries)
// ─────────────────────────────────────────────────────────────────────────────

async function testDay15WatcherCollapse(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  TEST 3: Day 15 Watcher Collapse — Boundary Matrix');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const startDate = new Date(Date.now() - 16 * ONE_DAY_MS);
  const room = await createTestRoom(prisma, { startDate, status: RoomStatus.RUNNING });

  const userDeepA = await createTestUser(prisma, { role: UserRole.ACTIVE });
  const userDeepB = await createTestUser(prisma, { role: UserRole.ACTIVE });
  const userSandA = await createTestUser(prisma, { role: UserRole.ACTIVE });
  const userSandB = await createTestUser(prisma, { role: UserRole.ACTIVE });
  const userDestroyedOnly = await createTestUser(prisma, { role: UserRole.ACTIVE });
  const userDestroyedCounterpart = await createTestUser(prisma, { role: UserRole.ACTIVE });
  const userNoRelation = await createTestUser(prisma, { role: UserRole.ACTIVE });

  await prisma.connection.create({
    data: {
      id: randomUUID(),
      room_id: room.id,
      user_a_id: userDeepA.id,
      user_b_id: userDeepB.id,
      status: ConnectionStatus.DEEP_LINK,
      connected_days: 15,
      user_a_decision: Decision.NULL,
      user_b_decision: Decision.NULL,
      deep_link_started_at: new Date(Date.now() - 15 * ONE_DAY_MS),
    },
  });

  await prisma.connection.create({
    data: {
      id: randomUUID(),
      room_id: room.id,
      user_a_id: userSandA.id,
      user_b_id: userSandB.id,
      status: ConnectionStatus.SANDGLASS_24H,
      connected_days: 0,
      user_a_decision: Decision.NULL,
      user_b_decision: Decision.NULL,
      sandglass_started_at: new Date(Date.now() - 2 * ONE_HOUR_MS),
    },
  });

  await prisma.connection.create({
    data: {
      id: randomUUID(),
      room_id: room.id,
      user_a_id: userDestroyedOnly.id,
      user_b_id: userDestroyedCounterpart.id,
      status: ConnectionStatus.DESTROYED,
      connected_days: 0,
      user_a_decision: Decision.NULL,
      user_b_decision: Decision.NULL,
      sandglass_started_at: new Date(Date.now() - 26 * ONE_HOUR_MS),
      destroyed_at: new Date(Date.now() - ONE_HOUR_MS),
    },
  });

  console.log(`  Room ID:                 ${room.id} (started ${startDate.toISOString()}, 16 days ago)`);
  console.log(`  DEEP_LINK users:          ${userDeepA.id}, ${userDeepB.id} → should stay ACTIVE`);
  console.log(`  SANDGLASS_24H users:      ${userSandA.id}, ${userSandB.id} → should stay ACTIVE`);
  console.log(`  DESTROYED-only user:      ${userDestroyedOnly.id} → should become WATCHER`);
  console.log(`  No-relation ACTIVE user:  ${userNoRelation.id} → should become WATCHER`);
  console.log('');

  await chronosService.advanceDeepLinkDaysAndCollapseDayFifteen();

  const users = await prisma.user.findMany({
    where: {
      id: {
        in: [
          userDeepA.id,
          userDeepB.id,
          userSandA.id,
          userSandB.id,
          userDestroyedOnly.id,
          userDestroyedCounterpart.id,
          userNoRelation.id,
        ],
      },
    },
  });
  const roleById = new Map(users.map((user) => [user.id, user.role]));

  const matrix = [
    ['DEEP_LINK A', userDeepA.id, roleById.get(userDeepA.id), UserRole.ACTIVE],
    ['DEEP_LINK B', userDeepB.id, roleById.get(userDeepB.id), UserRole.ACTIVE],
    ['SANDGLASS A', userSandA.id, roleById.get(userSandA.id), UserRole.ACTIVE],
    ['SANDGLASS B', userSandB.id, roleById.get(userSandB.id), UserRole.ACTIVE],
    ['DESTROYED only', userDestroyedOnly.id, roleById.get(userDestroyedOnly.id), UserRole.WATCHER],
    ['DESTROYED counterpart', userDestroyedCounterpart.id, roleById.get(userDestroyedCounterpart.id), UserRole.WATCHER],
    ['NO RELATION', userNoRelation.id, roleById.get(userNoRelation.id), UserRole.WATCHER],
  ] as const;

  console.log('  Boundary Matrix:');
  for (const [label, userId, actual, expected] of matrix) {
    console.log(`    ${label.padEnd(21)} ${userId} → ${actual} (expected ${expected})`);
    assert.strictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  }
  console.log('');

  console.log('  ✅ TEST 3 PASSED: Day15 boundary roles are correct.\n');

  await prisma.connection.deleteMany({ where: { room_id: room.id } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.instanceRoom.delete({ where: { id: room.id } });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  PROJECT 30-DAYS · E2E SIMULATION & STRESS TEST             ║');
  console.log('║  Manual DI + Parameterized Concurrency + State Boundaries    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nConfig: E2E_CONCURRENCY=${parseConcurrency()}\n`);

  try {
    await bootstrap();

    await testYomiRaceCondition();
    await testSandglassReaper();
    await testDay15WatcherCollapse();

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  All 3 legacy integration scenarios passed; this is not a full-system safety certification.');
    console.log('══════════════════════════════════════════════════════════════\n');
  } catch (error) {
    console.error('\n  ❌ TEST FAILURE:', getErrorMessage(error));
    if (error instanceof Error) {
      console.error('  Stack:', error.stack);
    }
    process.exitCode = 1;
  } finally {
    await teardown();
  }
}

main();
