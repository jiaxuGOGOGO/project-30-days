'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KNOWN, REQUIRED, classifyStress, overall, redact, render } = require('./report.cjs');
function fixture(failures = KNOWN.map(id => `current-service:${id}`)) {
  const records = REQUIRED.map(([layer, id]) => ({ layer, id, invariantPassed: !failures.includes(`${layer}:${id}`) }));
  return { schemaVersion: 1, records, violations: failures.length, releaseGatePassed: failures.length === 0,
    referenceGatePassed: !failures.some(id => id.startsWith('reference-pattern:')), cleanup: 'run fixtures removed' };
}
test('known service failures remain visible and release is not marked passed', () => {
  const result = classifyStress(fixture(), 2);
  assert.equal(result.status, 'KNOWN_ISSUES'); assert.equal(result.known.length, 9);
});
test('reference failures are regressions even with the same ID as a known service bug', () => {
  const result = classifyStress(fixture(['reference-pattern:boarding-duplicate-1']), 1);
  assert.equal(result.status, 'REGRESSION'); assert.equal(result.known.length, 0);
});
test('new production and migration failures are never hidden as known issues', () => {
  const f = fixture(); f.records.push({ layer: 'current-service', id: 'new-bug', invariantPassed: false }); f.violations++;
  assert.equal(classifyStress(f, 2).status, 'REGRESSION');
  assert.equal(classifyStress(fixture(['production-migration:production-migration-chain']), 2).status, 'REGRESSION');
});
test('missing, malformed, contradictory, duplicate and crashed reports fail closed', () => {
  for (const [value, code] of [[null, 2], [{}, 0], [fixture(), null], [fixture(), 0], [fixture(), 137]]) assert.equal(classifyStress(value, code).status, 'REGRESSION');
  for (const mutate of [f => f.records.pop(), f => f.records.push(f.records[0]), f => f.violations = 0, f => f.releaseGatePassed = true, f => f.referenceGatePassed = false, f => f.cleanup = 'failed', f => f.records[0].invariantPassed = 'yes']) {
    const f = fixture(); mutate(f); assert.equal(classifyStress(f, 2).status, 'REGRESSION');
  }
});
test('nonreproduced known failures are reported without asserting a repair', () => {
  const result = classifyStress(fixture([]), 0);
  assert.equal(result.status, 'PASS'); assert.deepEqual(result.improved, KNOWN);
});
test('overall result distinguishes blocked, missing, known and regression stages', () => {
  assert.equal(overall([], ['install']), 'INCOMPLETE');
  assert.equal(overall([{ name: 'install', status: 'NOT_RUN' }], ['install']), 'INCOMPLETE');
  assert.equal(overall([{ name: 'install', status: 'ENVIRONMENT_BLOCKED' }], ['install', 'test']), 'ENVIRONMENT_BLOCKED');
  assert.equal(overall([{ name: 'test', status: 'KNOWN_ISSUES' }], ['test']), 'KNOWN_ISSUES');
  assert.equal(overall([{ name: 'test', status: 'REGRESSION' }], ['test']), 'REGRESSION');
});
test('sanitizer removes credentials, bearer tokens, dotenv values, host paths and emails', () => {
  const secret = 'super-secret-test-value'; const token = 'a'.repeat(43);
  const result = redact(`\u001b[31mfailure\u001b[0m postgresql://user:pass@localhost/db redis://:secret@localhost/1 Bearer ${token}\npassword=abcd secret=${secret}\nC:\\Users\\Alice\\repo\n/home/alice/project\nalice@example.com`, [secret]);
  for (const value of [secret, token, 'user:pass', ':secret@', 'abcd', 'Alice', '/home/alice', 'alice@example.com', '\u001b[31m']) assert(!result.includes(value), value);
});
test('shareable report includes commit, skipped stages, scope and no raw secrets', () => {
  const result = render({ schemaVersion: 1, commit: 'b'.repeat(40), runId: 'run', node: '22', platform: 'linux', arch: 'x64', overall: 'INCOMPLETE', stages: [{ name: 'test', status: 'NOT_RUN', details: ['Bearer ' + 'c'.repeat(43)] }] });
  assert(result.includes('NOT_RUN')); assert(result.includes('No real login')); assert(result.includes('b'.repeat(40))); assert(!result.includes('c'.repeat(43)));
});
