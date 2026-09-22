'use strict';
// Real migrations and HTTP against disposable local services; no provider mocks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const WebSocket = require('ws');
require('reflect-metadata');

const root = resolve(__dirname, '..');
const local = url => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
function databaseEnv(name) {
  assert(process.env[name], `${name} must name a dedicated empty test database`);
  const url = new URL(process.env[name]);
  assert(local(url) && ['postgres:', 'postgresql:'].includes(url.protocol), `${name}: loopback PostgreSQL only`);
  assert.match(url.pathname, /^\/project30_test[a-z0-9_]*$/);
  assert(!url.searchParams.has('host'));
  assert(!url.searchParams.has('schema') || url.searchParams.get('schema') === 'public');
  return url.toString();
}
const freshUrl = databaseEnv('BASELINE_FRESH_DATABASE_URL');
const upgradeUrl = databaseEnv('BASELINE_UPGRADE_DATABASE_URL');
const historicalUrl = databaseEnv('BASELINE_HISTORICAL_DATABASE_URL');
const appUrl = databaseEnv('E2E_DATABASE_URL');
assert.equal(new Set([freshUrl, upgradeUrl, historicalUrl, appUrl].map(x => new URL(x).pathname)).size, 4, 'Use four distinct databases');
const httpBase = new URL(process.env.BASELINE_API_URL || 'http://127.0.0.1:3000');
assert(local(httpBase) && httpBase.protocol === 'http:', 'HTTP fixture must be local');
const redisUrl = new URL(process.env.E2E_REDIS_URL || 'missing:');
assert(local(redisUrl) && redisUrl.protocol === 'redis:');
assert.match(redisUrl.pathname, /^\/(?:[1-9]|1[0-5])$/);
const original = {
  '000001_phase1_init': '185cba945e16e5f5d4d8697a13264120e83a80c2ce76209d3fa0030bf4b84076',
  '000002_phase0_optimization': 'f21fc285c932496076e36f4ad78ae96d1a83bb2e68dc5150f2e9aea30194fb15',
  '000003_p1p2_progressive_trust': '8b2c5bf66381acfe70b9992011c7bc5b9ea667c91a0fe71e8214a78d0defe042',
};
const allMigrations = [...Object.keys(original), '000001a_prepare_reveal_level', '000004_auth_sessions'].sort();
function cli(url, args, input) {
  const result = spawnSync(process.execPath, [resolve(root, 'node_modules/prisma/build/index.js'), ...args], {
    cwd: root, encoding: 'utf8', input, timeout: 30000,
    env: { ...process.env, DATABASE_URL: url, XDG_CACHE_HOME: resolve(root, 'node_modules/.cache') },
  });
  assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function deploy(url, schema = resolve(root, 'prisma/schema.prisma')) { return cli(url, ['migrate', 'deploy', '--schema', schema]); }
async function withDb(url, fn) {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try { return await fn(db); } finally { await db.$disconnect(); }
}
async function assertEmpty(db) {
  const tables = await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  assert.equal(tables.length, 0, 'Migration tests refuse nonempty databases; recreate the disposable fixture');
}
function snapshot(names) {
  const cache = resolve(root, 'node_modules/.cache'); mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(resolve(cache, 'migration-baseline-'));
  cpSync(resolve(root, 'prisma/schema.prisma'), resolve(dir, 'schema.prisma'));
  mkdirSync(resolve(dir, 'migrations'));
  cpSync(resolve(root, 'prisma/migrations/migration_lock.toml'), resolve(dir, 'migrations/migration_lock.toml'));
  for (const name of names) cpSync(resolve(root, 'prisma/migrations', name), resolve(dir, 'migrations', name), { recursive: true });
  return { dir, schema: resolve(dir, 'schema.prisma') };
}
async function assertHistory(db) {
  const history = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY migration_name');
  assert.deepEqual(history.map(x => x.migration_name), allMigrations);
  for (const row of history) {
    assert(row.finished_at);
    const expected = createHash('sha256').update(readFileSync(resolve(root, 'prisma/migrations', row.migration_name, 'migration.sql'))).digest('hex');
    assert.equal(row.checksum, expected);
  }
}
async function request(path, method = 'GET', data, token, extraHeaders = {}) {
  const response = await fetch(new URL(path, httpBase), {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}

test('shipped migration checksums remain unchanged', () => {
  for (const [name, hash] of Object.entries(original)) {
    assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'prisma/migrations', name, 'migration.sql'))).digest('hex'), hash);
  }
});

test('empty database deploys every migration and second deploy is a no-op', async () => {
  await withDb(freshUrl, async db => {
    await assertEmpty(db); deploy(freshUrl); deploy(freshUrl); await assertHistory(db);
    assert.equal(await db.season.count({ where: { is_active: true } }), 1);
    const [{ labels }] = await db.$queryRawUnsafe("SELECT enum_range(NULL::reveal_level)::text AS labels");
    assert.equal(labels, '{SILHOUETTE,FROSTED,NEAR,FULL}');
    await assert.rejects(db.user.create({ data: { wechat_openid: randomUUID(), shadow_video_url: 'https://example.invalid', fire_points: -1 } }));
  });
});

test('upgrade from the original first migration preserves existing user data', async () => {
  const old = snapshot(['000001_phase1_init']);
  try {
    await withDb(upgradeUrl, async db => {
      await assertEmpty(db); deploy(upgradeUrl, old.schema);
      const id = randomUUID();
      await db.$executeRaw`INSERT INTO users(id,wechat_openid,shadow_video_url,fire_points) VALUES(${id}::uuid,${`baseline_${id}`},'https://example.invalid/preserved.mp4',7)`;
      deploy(upgradeUrl); await assertHistory(db);
      const user = await db.user.findUniqueOrThrow({ where: { id } });
      assert.equal(user.fire_points, 7); assert.equal(user.freeze_remaining, 2);
      assert.equal(user.shadow_video_url, 'https://example.invalid/preserved.mp4');
    });
  } finally { rmSync(old.dir, { recursive: true, force: true }); }
});

test('database with all original migrations accepts additive prerequisite and auth schema', async () => {
  const first = snapshot(['000001_phase1_init']);
  const legacy = snapshot(Object.keys(original));
  try {
    await withDb(historicalUrl, async db => {
      await assertEmpty(db); deploy(historicalUrl, first.schema);
      // Model an existing installation that had prepared this missing type externally.
      await db.$executeRawUnsafe("CREATE TYPE reveal_level AS ENUM ('SILHOUETTE','FROSTED','NEAR','FULL')");
      deploy(historicalUrl, legacy.schema);
      const user = await db.user.create({ data: { wechat_openid: randomUUID(), shadow_video_url: 'https://example.invalid/legacy.mp4', observer_fragments: 9 }, select: { id: true } });
      deploy(historicalUrl); deploy(historicalUrl); await assertHistory(db);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).observer_fragments, 9);
    });
  } finally { rmSync(first.dir, { recursive: true, force: true }); rmSync(legacy.dir, { recursive: true, force: true }); }
});

test('tsc output retains constructor and DTO runtime metadata', () => {
  const { Day30Controller } = require('../dist/src/day30/day30.controller.js');
  const { Day30Service } = require('../dist/src/day30/day30.service.js');
  const { JudgmentRequestDto } = require('../dist/src/auth/request.dto.js');
  assert.equal(Reflect.getMetadata('design:paramtypes', Day30Controller)[0], Day30Service);
  assert.equal(Reflect.getMetadata('design:paramtypes', Day30Controller.prototype, 'submitJudgment')[0], JudgmentRequestDto);
});

test('public season metadata remains available without exposing credentials', async () => {
  const result = await request('/season/active');
  assert.equal(result.status, 200); assert.equal(result.body.seasonNumber, 1);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'), null);
});

test('U02-A real HTTP and WS authorization regression', async t => {
  await withDb(appUrl, async db => {
    assert.equal(await db.user.count(), 0, 'Application fixture must not contain other users');
    assert.equal(await db.instanceRoom.count(), 0, 'Application fixture must not contain other rooms');
    const { SessionService } = require('../dist/src/auth/session.service.js');
    const sessions = new SessionService(db);
    const a = randomUUID(), b = randomUUID(), outsider = randomUUID(), roomId = randomUUID();
    const connectionId = randomUUID(), judgmentId = randomUUID();
    const now = new Date();
    try {
      await db.user.createMany({ data: [a, b, outsider].map(id => ({ id, wechat_openid: `auth_${id}`, shadow_video_url: 'https://example.invalid/test.mp4', role: 'OBSERVER', observer_fragments: 20 })) });
      await db.instanceRoom.create({ data: { id: roomId, status: 'RUNNING', start_date: now, end_date: new Date(+now + 30 * 86400000) } });
      await db.connection.createMany({ data: [
        { id: connectionId, user_a_id: a, user_b_id: b, room_id: roomId, status: 'DEEP_LINK', connected_days: 2 },
        { id: judgmentId, user_a_id: a, user_b_id: outsider, room_id: roomId, status: 'JUDGMENT', judgment_started_at: now },
      ] });
      await db.dailyEcho.create({ data: { connection_id: connectionId, day_number: 2, prompt_text: 'Fixture question', user_b_answer: 'private answer', both_answered: false } });
      // Trusted fixture provisioning only. There is no HTTP login/impersonation endpoint.
      const { token: tokenA } = await sessions.issueForVerifiedUser(a);
      const { token: tokenB } = await sessions.issueForVerifiedUser(b);
      const { token: tokenO } = await sessions.issueForVerifiedUser(outsider);
      const disabledRoutes = [
        ['POST', '/yomi/answers'], ['POST', '/boarding/join'],
        ['GET', `/media/video/${connectionId}`], ['POST', `/media/process/${a}`],
        ['POST', '/observer/bless'], ['POST', '/season/transition'],
        ['POST', `/stardust-ticket/generate/${connectionId}`], ['GET', `/stardust-ticket/${connectionId}`],
      ];
      const enabledRoutes = [
        ['GET', '/auth/session'], ['POST', '/auth/logout'], ['POST', '/auth/logout-all'],
        ['GET', '/boarding/current'], ['GET', `/season/assets/${a}`],
        ['POST', '/daily-echo/answer'], ['GET', `/daily-echo/current/${connectionId}`], ['GET', `/daily-echo/history/${connectionId}`],
        ['POST', '/hourglass/freeze'], ['GET', `/hourglass/status/${connectionId}`],
        ['POST', '/api/day30/judgment'], ['POST', `/observer/daily-reward/${a}`], ['POST', `/observer/redeem/${a}`],
      ];

      await t.test('all existing private HTTP endpoints reject anonymous requests', async () => {
        for (const [method, path] of [...enabledRoutes, ...disabledRoutes]) {
          assert.equal((await request(path, method, method === 'POST' ? {} : undefined)).status, 401, `${method} ${path}`);
        }
        for (const authorization of ['Bearer bad', 'Basic aaa', 'Bearer ' + 'x'.repeat(43), `Bearer ${tokenA}, Bearer ${tokenB}`]) {
          assert.equal((await request('/auth/session', 'GET', undefined, undefined, { authorization })).status, 401);
        }
        assert.equal((await request(`/auth/session?token=${tokenA}`)).status, 401);
        assert.equal((await request('/auth/session', 'GET', undefined, undefined, { cookie: `session=${tokenA}` })).status, 401);
        assert.equal((await request('/auth/login', 'POST', { userId: a })).status, 404);
      });

      await t.test('issued opaque token is hashed at rest and session response is minimal', async () => {
        assert.match(tokenA, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(tokenA, tokenB);
        const row = await db.authSession.findFirstOrThrow({ where: { user_id: a } });
        assert.equal(row.token_hash, createHash('sha256').update(tokenA).digest('hex'));
        assert(!JSON.stringify(row).includes(tokenA));
        const result = await request('/auth/session', 'GET', undefined, tokenA);
        assert.equal(result.status, 200); assert.equal(result.body.userId, a);
        assert.deepEqual(Object.keys(result.body).sort(), ['expiresAt', 'userId']);
        assert.equal(result.headers.get('cache-control'), 'no-store');
      });

      await t.test('body, path and query identity spoofing never changes the actor', async () => {
        for (const field of ['userId', 'actorUserId', 'observerUserId']) {
          assert.equal((await request('/daily-echo/answer', 'POST', { connectionId, dayNumber: 2, answer: 'spoof', [field]: b }, tokenA)).status, 403);
        }
        for (const path of [`/season/assets/${b}`, `/daily-echo/history/${connectionId}?userId=${b}`, `/hourglass/status/${connectionId}?userId=${b}`]) {
          assert.equal((await request(path, 'GET', undefined, tokenA)).status, 403);
        }
        assert.equal((await request(`/observer/redeem/${b}`, 'POST', { fragmentsToRedeem: 5 }, tokenA)).status, 403);
        assert.equal((await request(`/observer/daily-reward/${b}`, 'POST', {}, tokenA)).status, 403);
        assert.equal((await db.user.findUniqueOrThrow({ where: { id: b } })).observer_fragments, 20);
        assert.equal((await db.dailyEcho.findFirstOrThrow({ where: { connection_id: connectionId } })).user_a_answer, null);
      });

      await t.test('relationship reads and writes hide unrelated, missing and closed objects', async () => {
        const paths = [`/daily-echo/current/${connectionId}`, `/daily-echo/history/${connectionId}`, `/hourglass/status/${connectionId}`];
        for (const path of paths) assert.equal((await request(path, 'GET', undefined, tokenO)).status, 404);
        for (const [path, body] of [
          ['/daily-echo/answer', { connectionId, dayNumber: 2, answer: 'outsider' }],
          ['/hourglass/freeze', { connectionId }],
          ['/api/day30/judgment', { connectionId, choice: 'COOPERATE', heldMs: 2000 }],
        ]) assert.equal((await request(path, 'POST', body, tokenO)).status, 404);
        const missing = await request(`/daily-echo/current/${randomUUID()}`, 'GET', undefined, tokenA);
        assert.equal(missing.status, 404);
        await db.connection.update({ where: { id: connectionId }, data: { status: 'DESTROYED', destroyed_at: new Date() } });
        try {
          for (const path of paths) assert.deepEqual((await request(path, 'GET', undefined, tokenA)).body, missing.body);
          assert.equal((await request('/hourglass/freeze', 'POST', { connectionId }, tokenA)).status, 404);
        } finally { await db.connection.update({ where: { id: connectionId }, data: { status: 'DEEP_LINK', destroyed_at: null } }); }
        await db.instanceRoom.update({ where: { id: roomId }, data: { status: 'DESTROYED' } });
        try { assert.equal((await request(paths[0], 'GET', undefined, tokenA)).status, 404); }
        finally { await db.instanceRoom.update({ where: { id: roomId }, data: { status: 'RUNNING' } }); }
      });

      await t.test('runtime DTOs reject coercion, invalid values, extra properties and query arrays', async () => {
        const valid = { connectionId: judgmentId, choice: 'COOPERATE', heldMs: 2000 };
        for (const invalid of [{ ...valid, connectionId: 'demo' }, { ...valid, choice: 'INVALID' }, { ...valid, heldMs: 1 }, { ...valid, heldMs: '2000' }, { ...valid, admin: true }]) {
          assert.equal((await request('/api/day30/judgment', 'POST', invalid, tokenA)).status, 400);
        }
        const echo = { connectionId, dayNumber: 2, answer: 'answer' };
        for (const invalid of [{ ...echo, dayNumber: '2' }, { ...echo, dayNumber: 1 }, { ...echo, answer: ' ' }, { ...echo, answer: 'x'.repeat(501) }, { ...echo, answer: 123 }, { ...echo, extra: true }]) {
          assert.equal((await request('/daily-echo/answer', 'POST', invalid, tokenA)).status, 400);
        }
        for (const value of ['5', -5, 5.1, null, 500]) assert.equal((await request(`/observer/redeem/${a}`, 'POST', { fragmentsToRedeem: value }, tokenA)).status, 400);
        assert.equal((await request(`/daily-echo/current/${connectionId}?admin=true`, 'GET', undefined, tokenA)).status, 400);
        assert.equal((await request(`/daily-echo/current/${connectionId}?userId=${a}&userId=${b}`, 'GET', undefined, tokenA)).status, 403);
      });

      await t.test('authorized reads hide partner answer until mutual completion; writes use session actor', async () => {
        const current = await request(`/daily-echo/current/${connectionId}`, 'GET', undefined, tokenA);
        assert.equal(current.status, 200); assert.equal(current.body.partnerAnswer, null);
        const history = await request(`/daily-echo/history/${connectionId}`, 'GET', undefined, tokenA);
        assert.equal(history.body[0].partnerAnswer, null);
        const answer = await request('/daily-echo/answer', 'POST', { connectionId, dayNumber: 2, answer: 'my answer' }, tokenA);
        assert.equal(answer.status, 201); assert.equal(answer.body.myAnswer, 'my answer');
        assert.equal(answer.body.partnerAnswer, 'private answer');
        const freeze = await request('/hourglass/freeze', 'POST', { connectionId }, tokenA);
        assert.equal(freeze.status, 201); assert.equal(freeze.body.userId, a);
        assert.equal((await request(`/hourglass/status/${connectionId}`, 'GET', undefined, tokenA)).body.freezeRemaining, 1);
        const judgment = await request('/api/day30/judgment', 'POST', { connectionId: judgmentId, choice: 'COOPERATE', heldMs: 2000 }, tokenA);
        assert.equal(judgment.status, 200);
        const stored = await db.connection.findUniqueOrThrow({ where: { id: judgmentId } });
        assert.equal(stored.user_a_decision, 'COOPERATE'); assert.equal(stored.user_b_decision, 'NULL');
        assert.equal((await request(`/season/assets/${a}`, 'GET', undefined, tokenA)).status, 200);
      });

      await t.test('unsafe legacy features reject even valid sessions without side effects', async () => {
        const counts = [await db.connection.count(), await db.season.count(), await db.stardustTicket.count()];
        for (const [method, path] of disabledRoutes) {
          assert.equal((await request(path, method, method === 'POST' ? { admin: true } : undefined, tokenA)).status, 403, path);
        }
        assert.deepEqual([await db.connection.count(), await db.season.count(), await db.stardustTicket.count()], counts);
      });

      await t.test('missing route policy fails closed rather than inheriting session-only access', async () => {
        const { Reflector } = require('@nestjs/core');
        const { SessionGuard } = require('../dist/src/auth/session.guard.js');
        const guard = new SessionGuard(new Reflector(), sessions, db);
        const req = { headers: { authorization: `Bearer ${tokenA}` }, params: {}, query: {} };
        const context = { getType: () => 'http', getHandler: () => function unclassified() {}, getClass: () => class Unclassified {}, switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ setHeader() {} }) }) };
        await assert.rejects(guard.canActivate(context), error => error.getStatus() === 403);
      });

      await t.test('expired, revoked and disabled-user sessions fail on the next request', async () => {
        const expired = await sessions.issueForVerifiedUser(a);
        await db.authSession.update({ where: { token_hash: createHash('sha256').update(expired.token).digest('hex') }, data: { created_at: new Date(Date.now() - 3600000), expires_at: new Date(Date.now() - 1000) } });
        assert.equal((await request('/auth/session', 'GET', undefined, expired.token)).status, 401);
        const revoked = await sessions.issueForVerifiedUser(a);
        await sessions.revoke(await sessions.authenticate(`Bearer ${revoked.token}`));
        assert.equal((await request('/auth/session', 'GET', undefined, revoked.token)).status, 401);
        await db.user.update({ where: { id: a }, data: { auth_disabled_at: new Date() } });
        try {
          assert.equal((await request('/auth/session', 'GET', undefined, tokenA)).status, 401);
          await assert.rejects(sessions.issueForVerifiedUser(a), error => error.getStatus() === 401);
        } finally { await db.user.update({ where: { id: a }, data: { auth_disabled_at: null } }); }
        await assert.rejects(sessions.issueForVerifiedUser(randomUUID()), error => error.getStatus() === 401);
      });

      await t.test('WS closes every legacy subscriber, including immediate arbitrary room joins', async () => {
        for (const token of [undefined, tokenA]) {
          const url = new URL('/events', httpBase); url.protocol = 'ws:';
          await new Promise((resolve, reject) => {
            const ws = new WebSocket(url, token ? { headers: { authorization: `Bearer ${token}` } } : {});
            const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS did not close')); }, 5000);
            const messages = [];
            ws.on('open', () => ws.send(JSON.stringify({ event: 'room:join', data: { roomId } })));
            ws.on('message', data => messages.push(String(data)));
            ws.on('error', error => { clearTimeout(timer); reject(error); });
            ws.on('close', code => { clearTimeout(timer); try { assert.equal(code, 1008); assert.deepEqual(messages, []); resolve(); } catch (error) { reject(error); } });
          });
        }
      });

      await t.test('logout revokes one session; logout-all only revokes caller sessions', async () => {
        const otherA = await sessions.issueForVerifiedUser(a);
        assert.equal((await request('/auth/logout', 'POST', {}, otherA.token)).status, 204);
        assert.equal((await request('/auth/session', 'GET', undefined, otherA.token)).status, 401);
        assert.equal((await request('/auth/session', 'GET', undefined, tokenA)).status, 200);
        const anotherA = await sessions.issueForVerifiedUser(a);
        assert.equal((await request('/auth/logout-all', 'POST', {}, tokenA)).status, 204);
        for (const token of [tokenA, anotherA.token]) assert.equal((await request('/auth/session', 'GET', undefined, token)).status, 401);
        assert.equal((await request('/auth/session', 'GET', undefined, tokenB)).status, 200);
      });

      await t.test('user deletion cascades session deletion', async () => {
        await db.user.delete({ where: { id: outsider } });
        assert.equal(await db.authSession.count({ where: { user_id: outsider } }), 0);
        assert.equal((await request('/auth/session', 'GET', undefined, tokenO)).status, 401);
      });
    } finally {
      await db.instanceRoom.deleteMany({ where: { id: roomId } });
      await db.user.deleteMany({ where: { id: { in: [a, b, outsider] } } });
    }
  });
});
