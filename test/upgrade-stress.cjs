#!/usr/bin/env node
'use strict';
// Native PostgreSQL, service-level closed-loop stress. No HTTP/WS/COS capacity claim.
// Requires generated Prisma client and the existing project dependencies.
// AUDIT_DATABASE_URL must identify a disposable loopback database project30_audit*.
// --prepare-fixture: empty DB only; executes the unmodified production migration chain.
// Default exit 2 if any production invariant fails. --observe retains failures in JSON but exits 0.
process.env.TSX_DISABLE_CACHE = '1';
require('tsx/cjs');
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { Logger } = require('@nestjs/common');
const { BoardingService } = require('../src/boarding/boarding.service.ts');
const { DailyEchoService } = require('../src/daily-echo/daily-echo.service.ts');
const { ObserverService } = require('../src/observer/observer.service.ts');
const { HourglassService } = require('../src/hourglass/hourglass.service.ts');
const { Day30Service } = require('../src/day30/day30.service.ts');
const { YomiService } = require('../src/yomi/yomi.service.ts');
const { ChronosService } = require('../src/chronos/chronos.service.ts');
Logger.overrideLogger(false);
const root = resolve(__dirname, '..');
const urlString = process.env.AUDIT_DATABASE_URL;
assert(urlString, 'Set AUDIT_DATABASE_URL explicitly; DATABASE_URL is never used as a fallback');
const url = new URL(urlString);
assert(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL only');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Loopback only');
assert(/^\/project30_audit[a-z0-9_]*$/.test(url.pathname), 'Disposable database name must start project30_audit');
assert(!url.searchParams.has('host'), 'Socket/host override is forbidden');
assert(!url.searchParams.has('schema') || url.searchParams.get('schema') === 'public', 'public schema only');
url.searchParams.set('connection_limit', '10'); url.searchParams.set('pool_timeout', '30');
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const runId = randomUUID();
const users = [], rooms = [], records = [];
const DAY = 86400000;
const events = new Proxy({}, { get: () => () => {} });
const noMedia = { destroyConnectionVideos: async () => {} };
const boarding = new BoardingService(prisma, events);
const echoService = new DailyEchoService(prisma, events);
const observer = new ObserverService(prisma, events);
const freeze = new HourglassService(prisma, events);
const judgment = new Day30Service(prisma, events, noMedia);
const chronos = new ChronosService(prisma, {}, events, echoService, boarding, freeze);
const yomi = new YomiService(prisma, {}, events);
function integer(name, fallback, max) {
  const a = process.argv.find(x => x.startsWith(`--${name}=`)); const n = a ? Number(a.split('=')[1]) : fallback;
  assert(Number.isSafeInteger(n) && n > 0 && n <= max, `Invalid ${name}`); return n;
}
const concurrency = integer('concurrency', 50, 200);
const repeats = integer('repeats', 3, 10);
const samples = integer('samples', 30, 200);
async function burst(label, tasks) {
  let cursor = 0, successful = 0; const latencies = [], errors = {}, results = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++; const at = performance.now();
      try { results[index] = await tasks[index](); successful++; }
      catch (e) { const code = e.code || e.getStatus?.() || e.name; errors[code] = (errors[code] || 0) + 1; }
      finally { latencies.push(performance.now() - at); }
    }
  }));
  const durationMs = performance.now() - started; latencies.sort((a, b) => a - b);
  const percentile = p => latencies[Math.min(latencies.length - 1, Math.ceil(p * latencies.length) - 1)];
  const stats = { label, attempts: tasks.length, successful, errors, durationMs, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), closedLoopAttemptsPerSecond: tasks.length * 1000 / durationMs };
  return { stats, results };
}
function record(id, layer, expected, actual, ok, load) { records.push({ id, layer, expected, actual, invariantPassed: ok, load }); }
async function user(role = 'ACTIVE', overrides = {}) {
  const id = randomUUID(); users.push(id);
  return prisma.user.create({ data: { id, wechat_openid: `audit_${runId}_${id}`, shadow_video_url: 'https://example.invalid/audit.mp4', role, ...overrides } });
}
async function room(status = 'RUNNING') {
  const id = randomUUID(); rooms.push(id); const start = new Date();
  return prisma.instanceRoom.create({ data: { id, status, start_date: start, end_date: new Date(+start + 30 * DAY), min_users: 50, max_users: 100 } });
}
async function pair(r, status = 'DEEP_LINK', overrides = {}) {
  const a = await user(), b = await user();
  return prisma.connection.create({ data: { user_a_id: a.id, user_b_id: b.id, room_id: r.id, status, connected_days: 2, ...overrides } });
}
async function prepare() {
  const tables = await prisma.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  assert.equal(tables.length, 0, '--prepare-fixture only accepts an empty disposable database');
  const migrations = readdirSync(resolve(root, 'prisma/migrations'), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const result = spawnSync(process.execPath, [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(root, 'prisma/schema.prisma')], {
    cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, DATABASE_URL: url.toString(), XDG_CACHE_HOME: resolve(root, 'node_modules/.cache') },
  });
  record('production-migration-chain', 'production-migration', 'success on empty database', { exitCode: result.status, migrations }, result.status === 0);
  assert.equal(result.status, 0, `Migration failed; no test-only repair is allowed:\n${result.stderr}`);
  return { originalPassed: true, fixtureRepair: null, migrations };
}
async function setupReferenceTables() {
  for (const sql of [
    'CREATE SCHEMA IF NOT EXISTS audit_reference',
    'CREATE TABLE IF NOT EXISTS audit_reference.membership (run uuid, room uuid, usr uuid, PRIMARY KEY(run,room,usr))',
    'CREATE TABLE IF NOT EXISTS audit_reference.reward (run uuid, usr uuid, day date, PRIMARY KEY(run,usr,day))',
    'CREATE TABLE IF NOT EXISTS audit_reference.outbox (run uuid, event_id uuid, connection_id uuid, delivered boolean DEFAULT false, PRIMARY KEY(run,event_id))',
    'CREATE TABLE IF NOT EXISTS audit_reference.inbox (run uuid, event_id uuid, PRIMARY KEY(run,event_id))',
    'CREATE TABLE IF NOT EXISTS audit_reference.effect (run uuid PRIMARY KEY, count integer NOT NULL DEFAULT 0 CHECK(count>=0))',
  ]) await prisma.$executeRawUnsafe(sql);
}
// Narrow reference patterns; NOT wired into production controllers, auth or media.
async function referenceJoin(r, u) {
  return prisma.$transaction(async tx => {
    const inserted = await tx.$executeRaw`INSERT INTO audit_reference.membership(run,room,usr) VALUES(${runId}::uuid,${r.id}::uuid,${u.id}::uuid) ON CONFLICT DO NOTHING`;
    if (!inserted) return;
    const changed = await tx.instanceRoom.updateMany({ where: { id: r.id, status: 'BOARDING', boarding_count: { lt: 100 } }, data: { boarding_count: { increment: 1 } } });
    if (!changed.count) throw new Error('capacity reached');
  });
}
async function referenceReward(u) {
  return prisma.$transaction(async tx => {
    const changed = await tx.$executeRaw`INSERT INTO audit_reference.reward(run,usr,day) VALUES(${runId}::uuid,${u.id}::uuid,'2026-09-22'::date) ON CONFLICT DO NOTHING`;
    if (changed) await tx.user.update({ where: { id: u.id }, data: { observer_fragments: { increment: 1 } } });
  });
}
async function referenceEcho(e, side) {
  return prisma.$transaction(async tx => {
    const [row] = await tx.$queryRaw`SELECT * FROM daily_echoes WHERE id=${e.id}::uuid FOR UPDATE`;
    const field = side === 'a' ? 'user_a_answer' : 'user_b_answer';
    if (row[field] !== null) return;
    const other = side === 'a' ? row.user_b_answer : row.user_a_answer;
    const updated = await tx.dailyEcho.update({ where: { id: e.id }, data: { [field]: 'synthetic answer', both_answered: other !== null, answered_at: other !== null ? new Date() : null } });
    if (updated.both_answered) await tx.$executeRaw`INSERT INTO audit_reference.outbox(run,event_id,connection_id) VALUES(${runId}::uuid,${e.id}::uuid,${e.connection_id}::uuid) ON CONFLICT DO NOTHING`;
  });
}
async function runRound(index) {
  for (const ref of [false, true]) {
    const layer = ref ? 'reference-pattern' : 'current-service';
    const r = await room('BOARDING'), u = await user();
    const run = await burst(`${layer}:boarding:${index}`, Array.from({ length: 80 }, () => () => ref ? referenceJoin(r, u) : boarding.joinBoarding({ roomId: r.id, userId: u.id })));
    const after = await prisma.instanceRoom.findUnique({ where: { id: r.id } });
    record(`boarding-duplicate-${index}`, layer, 1, after.boarding_count, after.boarding_count === 1 && run.stats.successful === 80, run.stats);
    const watcher = await user('OBSERVER');
    const reward = await burst(`${layer}:reward:${index}`, Array.from({ length: 100 }, () => () => ref ? referenceReward(watcher) : observer.claimDailyReward(watcher.id)));
    const wallet = await prisma.user.findUnique({ where: { id: watcher.id } });
    record(`daily-reward-${index}`, layer, 1, wallet.observer_fragments, wallet.observer_fragments === 1 && reward.stats.successful === 100, reward.stats);
    const er = await room(), echoes = [];
    for (let j = 0; j < samples; j++) { const c = await pair(er); echoes.push({ c, e: await prisma.dailyEcho.create({ data: { connection_id: c.id, day_number: 2, prompt_text: 'Synthetic audit prompt' } }) }); }
    const calls = echoes.flatMap(({ c, e }) => ['a', 'b'].map(side => () => ref ? referenceEcho(e, side) : echoService.submitAnswer({ connectionId: c.id, userId: side === 'a' ? c.user_a_id : c.user_b_id, dayNumber: 2, answer: 'synthetic answer' })));
    const erun = await burst(`${layer}:echo:${index}`, calls);
    const complete = await prisma.dailyEcho.count({ where: { id: { in: echoes.map(x => x.e.id) }, both_answered: true } });
    record(`simultaneous-echo-${index}`, layer, samples, complete, complete === samples && erun.stats.successful === calls.length, erun.stats);
  }
  const fr = await room(), fc = await pair(fr), fu = fc.user_a_id;
  const f = await burst(`current:freeze:${index}`, Array.from({ length: 10 }, () => () => freeze.useFreeze({ userId: fu, connectionId: fc.id })));
  const remaining = await prisma.user.findUnique({ where: { id: fu } });
  const count = await prisma.hourglassFreeze.count({ where: { connection_id: fc.id } });
  record(`duplicate-freeze-${index}`, 'current-service', { count: 1, remaining: 1 }, { count, remaining: remaining.freeze_remaining }, count === 1 && remaining.freeze_remaining === 1, f.stats);
  const ru = await user('OBSERVER', { observer_fragments: 10 });
  const redemption = await burst(`current:redeem:${index}`, Array.from({ length: 10 }, () => () => observer.redeemFragments(ru.id, 10)));
  const balance = await prisma.user.findUnique({ where: { id: ru.id } });
  record(`redeem-balance-${index}`, 'current-service', { minBalance: 0, maxFreezes: 4 }, { balance: balance.observer_fragments, freezes: balance.freeze_remaining }, balance.observer_fragments >= 0 && balance.freeze_remaining <= 4, redemption.stats);
  const jr = await room(), jc = [];
  for (let j = 0; j < samples; j++) jc.push(await pair(jr, 'JUDGMENT', { connected_days: 30, user_a_decision: 'COOPERATE', judgment_started_at: new Date(), created_at: new Date(Date.now() - 30 * DAY) }));
  const jrun = await burst(`current:first-round:${index}`, jc.map(c => () => judgment.submitJudgment({ connectionId: c.id, userId: c.user_b_id, choice: 'DEFECT', heldMs: 2000 })));
  const outcomes = jrun.results.reduce((s, x) => { if (x) s[x.outcome] = (s[x.outcome] || 0) + 1; return s; }, {});
  record(`first-round-extension-${index}`, 'current-service', { EXTENSION: samples }, outcomes, outcomes.EXTENSION === samples, jrun.stats);
  const sc = await pair(jr, 'JUDGMENT', { connected_days: 30, judgment_started_at: new Date(), created_at: new Date(Date.now() - 30 * DAY) });
  const concurrentVotes = await burst(`current:concurrent-votes:${index}`, [sc.user_a_id, sc.user_b_id].map(userId => () => judgment.submitJudgment({ connectionId: sc.id, userId, choice: 'COOPERATE', heldMs: 2000 })));
  const voted = await prisma.connection.findUnique({ where: { id: sc.id } });
  record(`serializable-retry-${index}`, 'current-service', 'DEEP_LINK with both votes accepted', { state: voted.status, errors: concurrentVotes.stats.errors }, voted.status === 'DEEP_LINK' && concurrentVotes.stats.successful === 2, concurrentVotes.stats);
  const yr = await room(), yc = await pair(yr, 'DEEP_LINK', { connected_days: 20 });
  await yomi.createSandglassConnection({ roomId: yr.id, actorUserId: yc.user_a_id, targetUserId: yc.user_b_id });
  const reset = await prisma.connection.findUnique({ where: { id: yc.id } });
  record(`matching-replay-${index}`, 'current-service', { state: 'DEEP_LINK', day: 20 }, { state: reset.status, day: reset.connected_days }, reset.status === 'DEEP_LINK' && reset.connected_days === 20);
  const cr = await room(), cc = await pair(cr, 'DEEP_LINK', { connected_days: 5 });
  await chronos.advanceDeepLinkDaysAndCollapseDayFifteen(); await chronos.advanceDeepLinkDaysAndCollapseDayFifteen();
  const clock = await prisma.connection.findUnique({ where: { id: cc.id } });
  record(`cron-replay-${index}`, 'current-service', 6, clock.connected_days, clock.connected_days === 6);
}
async function outboxFault() {
  // DB commit precedes delivery; first worker "crashes" after applying effect, before marking sent.
  const eventId = randomUUID(), connectionId = randomUUID();
  await prisma.$executeRaw`INSERT INTO audit_reference.outbox(run,event_id,connection_id) VALUES(${runId}::uuid,${eventId}::uuid,${connectionId}::uuid)`;
  await prisma.$executeRaw`INSERT INTO audit_reference.effect(run,count) VALUES(${runId}::uuid,0)`;
  const deliver = () => prisma.$transaction(async tx => {
    const inserted = await tx.$executeRaw`INSERT INTO audit_reference.inbox(run,event_id) VALUES(${runId}::uuid,${eventId}::uuid) ON CONFLICT DO NOTHING`;
    if (inserted) await tx.$executeRaw`UPDATE audit_reference.effect SET count=count+1 WHERE run=${runId}::uuid`;
  });
  await deliver(); // simulated crash: do not set delivered
  const replay = await burst('reference:outbox-replay-after-crash', Array.from({ length: 100 }, () => deliver));
  await prisma.$executeRaw`UPDATE audit_reference.outbox SET delivered=true WHERE run=${runId}::uuid AND event_id=${eventId}::uuid`;
  const [effect] = await prisma.$queryRaw`SELECT count FROM audit_reference.effect WHERE run=${runId}::uuid`;
  record('outbox-replay-after-crash', 'reference-pattern', 1, effect.count, effect.count === 1 && replay.stats.successful === 100, replay.stats);
  const before = await prisma.$queryRaw`SELECT count(*)::int AS n FROM audit_reference.outbox WHERE run=${runId}::uuid`;
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO audit_reference.outbox(run,event_id,connection_id) VALUES(${runId}::uuid,${randomUUID()}::uuid,${connectionId}::uuid)`;
    throw new Error('injected rollback');
  }), /injected rollback/);
  const after = await prisma.$queryRaw`SELECT count(*)::int AS n FROM audit_reference.outbox WHERE run=${runId}::uuid`;
  record('outbox-transaction-rollback', 'reference-pattern', before[0].n, after[0].n, before[0].n === after[0].n);
}
async function cleanup() {
  // This database is exclusively disposable. Delete only this run's identified records.
  for (const table of ['membership', 'reward', 'outbox', 'inbox', 'effect']) await prisma.$executeRawUnsafe(`DELETE FROM audit_reference.${table} WHERE run=$1::uuid`, runId);
  await prisma.instanceRoom.deleteMany({ where: { id: { in: rooms } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}
(async () => {
  let setupComplete = false;
  try {
    await prisma.$connect();
    // Chronos scans globally: refuse a reused DB with any business users/rooms.
    const fixture = process.argv.includes('--prepare-fixture') ? await prepare() : { fixtureRepair: 'Pre-provisioned disposable schema; migration not re-tested in this run.' };
    assert.equal(await prisma.user.count(), 0, 'Refuse nonempty database: Chronos is global');
    assert.equal(await prisma.instanceRoom.count(), 0, 'Refuse nonempty room database');
    await setupReferenceTables(); setupComplete = true;
    const version = await prisma.$queryRawUnsafe('select version()');
    for (let i = 0; i < repeats; i++) await runRound(i + 1);
    await outboxFault();
    await cleanup(); setupComplete = false;
    const violations = records.filter(x => !x.invariantPassed);
    const referenceViolations = violations.filter(x => x.layer === 'reference-pattern');
    console.log(JSON.stringify({ schemaVersion: 1, runId, executedAt: new Date().toISOString(), commit: /^[0-9a-f]{40}$/.test(process.env.LOCAL_CHECK_SOURCE_COMMIT || '') ? process.env.LOCAL_CHECK_SOURCE_COMMIT : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), scriptSha256: createHash('sha256').update(readFileSync(__filename)).digest('hex'), node: process.version, database: version[0].version, concurrency, poolSize: 10, repeats, samples, fixture,
      limits: ['Closed-loop service calls; excludes HTTP, authentication, Redis locks, WS, COS and client rendering.', 'Actual production services imported; events and media deletion are stubs.', 'Reference SQL patterns are isolated proof-of-concept, NOT upgraded production service.', 'Latency includes caller pool queue; no production capacity certification.', 'Fault injection models relay crash point, not OS kill/network partition.'],
      releaseGatePassed: violations.length === 0, referenceGatePassed: referenceViolations.length === 0, violations: violations.length, records, cleanup: 'run fixtures removed' }, null, 2));
    if (referenceViolations.length) process.exitCode = 1;
    else if (violations.length && !process.argv.includes('--observe')) process.exitCode = 2;
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally {
    if (setupComplete) await cleanup().catch(e => console.error('cleanup failed:', e.message));
    await prisma.$disconnect();
  }
})();
