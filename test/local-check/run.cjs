'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { redact, classifyStress, overall, render } = require('./report.cjs');
const STEPS = ['install', 'schema-generate', 'schema-validate', 'runner-tests', 'backend-types', 'test-types', 'frontend-types', 'backend-build', 'test-build', 'model', 'databases', 'migrate', 'api-start', 'baseline', 'legacy', 'business-probe', 'h5-build', 'weapp-build', 'artifacts', 'api-stop'];

async function execute(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '../..'));
  const output = path.resolve(options.output || '/output');
  fs.mkdirSync(output, { recursive: true });
  const cache = path.join(root, 'node_modules/.cache/local-check');
  fs.mkdirSync(cache, { recursive: true });
  const admin = new URL(options.adminUrl || process.env.LOCAL_CHECK_ADMIN_URL || 'missing:');
  if (!['postgres:', 'postgresql:'].includes(admin.protocol) || admin.hostname !== '127.0.0.1' || admin.pathname !== '/postgres' || admin.search) throw new Error('Only an explicit loopback /postgres fixture admin URL is accepted');
  const redis = new URL(options.redisUrl || 'redis://127.0.0.1:6379/1');
  if (redis.protocol !== 'redis:' || redis.hostname !== '127.0.0.1' || redis.pathname !== '/1' || redis.search) throw new Error('Only isolated loopback Redis DB 1 is accepted');
  const commit = options.commit || process.env.LOCAL_CHECK_SOURCE_COMMIT;
  if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('Source commit is required');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const names = ['fresh', 'upgrade', 'historical', 'e2e'].map(n => `project30_test_local_${suffix}_${n}`);
  const auditName = `project30_audit_local_${suffix}`;
  const urlFor = name => { const u = new URL(admin); u.pathname = `/${name}`; return u.toString(); };
  const env = { ...process.env, NODE_ENV: 'test', NODE_OPTIONS: '--max-old-space-size=2048', CI: '1',
    HOME: cache, XDG_CACHE_HOME: cache, npm_config_cache: path.join(cache, 'npm'),
    DATABASE_URL: urlFor(names[3]), E2E_DATABASE_URL: urlFor(names[3]),
    BASELINE_FRESH_DATABASE_URL: urlFor(names[0]), BASELINE_UPGRADE_DATABASE_URL: urlFor(names[1]), BASELINE_HISTORICAL_DATABASE_URL: urlFor(names[2]),
    AUDIT_DATABASE_URL: urlFor(auditName), REDIS_URL: redis.toString(), E2E_REDIS_URL: redis.toString(),
    HOST: '127.0.0.1', PORT: '3000', BASELINE_API_URL: 'http://127.0.0.1:3000', E2E_CONCURRENCY: '20',
    LOCAL_CHECK_SOURCE_COMMIT: commit,
  };
  // Child processes must never read credentials from the source checkout.
  if (fs.existsSync(path.join(root, '.env')) || fs.existsSync(path.join(root, '.env.local'))) throw new Error('Run only from a clean source archive without .env');
  const secrets = [decodeURIComponent(admin.password), admin.toString(), root];
  const report = { schemaVersion: 1, commit, archiveSha256: process.env.LOCAL_CHECK_ARCHIVE_SHA256 || null,
    runId: suffix, node: process.version, platform: process.platform, arch: process.arch,
    startedAt: new Date().toISOString(), overall: 'INCOMPLETE', stages: [] };
  let api, apiFd, apiStarted = false;
  const save = () => {
    report.overall = overall(report.stages, STEPS);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'REPORT.txt'), render(report));
  };
  const record = (name, status, exitCode, seconds, details = []) => {
    report.stages.push({ name, status, exitCode, seconds, details: details.map(s => redact(s, secrets)) });
    save(); console.log(`[local-check] ${name}: ${status}`);
  };
  function command(name, executable, args, settings = {}) {
    console.log(`[local-check] starting ${name}`);
    const started = Date.now();
    const result = spawnSync(executable, args, { cwd: root, env: { ...env, ...settings.env }, encoding: 'utf8',
      timeout: settings.timeout || 300000, maxBuffer: 20 * 1024 * 1024, killSignal: 'SIGKILL' });
    const text = redact(`${result.stdout || ''}\n${result.stderr || ''}`, secrets);
    fs.writeFileSync(path.join(output, `${name}.log`), text);
    let status = result.status === 0 ? 'PASS' : settings.environment ? 'ENVIRONMENT_BLOCKED' : 'REGRESSION';
    let details = [];
    if (settings.stress) {
      let raw; try { raw = JSON.parse(result.stdout); } catch { /* invalid evidence is a failure */ }
      const classified = classifyStress(raw, result.status);
      status = classified.status;
      details = [...classified.known.map(id => `known: ${id}`), ...classified.newFailures.map(id => `new: ${id}`), ...classified.improved.map(id => `not reproduced this run (not proof of repair): ${id}`)];
    } else if (name === 'baseline') {
      details = text.split('\n').filter(line => /^# (tests|pass|fail|skipped) /.test(line));
      // A process exiting successfully without running any assertions is not evidence.
      if (result.status === 0 && (!/# tests [1-9]\d*/.test(text) || !/# fail 0\b/.test(text) || !/# skipped 0\b/.test(text))) status = 'REGRESSION';
    }
    if (!['PASS', 'KNOWN_ISSUES'].includes(status)) {
      if (result.error) details.push(`process error: ${result.error.code || 'unknown'}`);
      details.push(...text.trim().split('\n').slice(-12).map(line => line.slice(0, 250)));
    }
    record(name, status, result.status, Math.round((Date.now() - started) / 1000), details);
    return status === 'PASS' || status === 'KNOWN_ISSUES';
  }
  const nodeCommand = (name, args, settings) => command(name, process.execPath, args, settings);
  const script = (name, scriptName, settings) => command(name, 'npm', ['run', scriptName], settings);
  async function action(name, fn) {
    const start = Date.now();
    try { await fn(); record(name, 'PASS', 0, Math.round((Date.now() - start) / 1000)); return true; }
    catch (error) { record(name, 'REGRESSION', 1, Math.round((Date.now() - start) / 1000), [String(error.message).slice(0, 600)]); return false; }
  }
  save();
  try {
    if (!command('install', 'npx', ['--yes', 'pnpm@10.28.2', 'install', '--frozen-lockfile', '--prod=false'], { timeout: 1200000, environment: true })) return report;
    const prisma = path.join(root, 'node_modules/prisma/build/index.js');
    if (!nodeCommand('schema-generate', [prisma, 'generate']) || !nodeCommand('schema-validate', [prisma, 'validate'])) return report;
    const checks = [
      ['runner-tests', () => nodeCommand('runner-tests', ['--test', 'test/local-check/report.spec.cjs'])],
      ['backend-types', () => script('backend-types', 'typecheck')], ['test-types', () => script('test-types', 'test:typecheck')],
      ['frontend-types', () => script('frontend-types', 'frontend:typecheck')], ['backend-build', () => script('backend-build', 'build')],
      ['test-build', () => script('test-build', 'test:build')], ['model', () => nodeCommand('model', ['test/social-simulation.cjs', '--self-test'])],
    ];
    let prerequisites = true;
    for (const [, check] of checks) if (!check()) prerequisites = false;
    if (!prerequisites) return report;
    if (!await action('databases', async () => {
      const { PrismaClient } = createRequire(path.join(root, 'package.json'))('@prisma/client');
      const db = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
      try {
        // CREATE only: never reset, drop, reuse or inspect someone else's databases.
        for (const name of [...names, auditName]) await db.$executeRawUnsafe(`CREATE DATABASE ${name}`);
      } finally { await db.$disconnect(); }
    })) return report;
    if (!nodeCommand('migrate', [prisma, 'migrate', 'deploy'])) return report;
    apiStarted = await action('api-start', async () => {
      await new Promise((resolve, reject) => {
        const probe = net.createServer(); probe.once('error', reject);
        probe.listen(3000, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
      });
      apiFd = fs.openSync(path.join(cache, 'api.log'), 'w');
      api = spawn(process.execPath, ['dist/src/main.js'], { cwd: root, env, stdio: ['ignore', apiFd, apiFd] });
      let spawnError; api.on('error', error => { spawnError = error; });
      for (let attempt = 0; attempt < 45; attempt++) {
        if (spawnError) throw spawnError;
        if (api.exitCode !== null) throw new Error('API exited before readiness');
        try { if ((await fetch(env.BASELINE_API_URL + '/season/active', { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* bounded readiness wait */ }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('API readiness timed out');
    });
    if (apiStarted) {
      nodeCommand('baseline', ['--test', 'test/baseline.spec.cjs']);
      nodeCommand('legacy', ['dist/test/test/e2e-simulation.spec.js']);
    }
    nodeCommand('business-probe', ['test/upgrade-stress.cjs', '--prepare-fixture', '--concurrency=10', '--repeats=1', '--samples=5'], { stress: true });
    script('h5-build', 'frontend:build:h5', { env: { NODE_ENV: 'production' }, timeout: 600000 });
    script('weapp-build', 'frontend:build:weapp', { env: { NODE_ENV: 'production' }, timeout: 600000 });
    await action('artifacts', async () => {
      for (const name of ['frontend/dist/h5/index.html', 'frontend/dist/weapp/app.json']) {
        if (!fs.statSync(path.join(root, name)).size) throw new Error(`Empty artifact: ${name}`);
      }
    });
  } catch (error) {
    record('runner-error', 'REGRESSION', 1, 0, [String(error.message).slice(0, 600)]);
  } finally {
    if (api) {
      await action('api-stop', async () => {
        if (api.exitCode === null && api.signalCode === null) {
          const exited = new Promise(resolve => api.once('exit', resolve));
          api.kill('SIGTERM');
          const timeout = setTimeout(() => api.kill('SIGKILL'), 5000);
          await exited; clearTimeout(timeout);
        }
      });
      if (apiFd !== undefined) fs.closeSync(apiFd);
      const log = fs.readFileSync(path.join(cache, 'api.log'), 'utf8');
      fs.writeFileSync(path.join(output, 'api.log'), redact(log, secrets));
    } else record('api-stop', 'PASS', 0, 0, ['API was not started']);
    for (const name of STEPS) if (!report.stages.some(s => s.name === name)) report.stages.push({ name, status: 'NOT_RUN', exitCode: null, seconds: 0, details: ['Prerequisite failed; no pass claimed'] });
    report.finishedAt = new Date().toISOString(); save();
  }
  return report;
}
module.exports = { execute, STEPS };
if (require.main === module) execute().then(report => {
  process.exitCode = { PASS: 0, KNOWN_ISSUES: 2, REGRESSION: 1, ENVIRONMENT_BLOCKED: 3, INCOMPLETE: 4 }[report.overall] ?? 4;
}).catch(() => { console.error('[local-check] runner initialization failed; see launcher report'); process.exitCode = 3; });
