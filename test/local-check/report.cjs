// Pure reporting logic: no database, Docker or project dependencies.
'use strict';
const KNOWN = [
  'boarding-duplicate-1', 'daily-reward-1', 'simultaneous-echo-1',
  'duplicate-freeze-1', 'redeem-balance-1', 'first-round-extension-1',
  'serializable-retry-1', 'matching-replay-1', 'cron-replay-1',
];
const REQUIRED = [
  ['production-migration', 'production-migration-chain'],
  ...KNOWN.map(id => ['current-service', id]),
  ...['boarding-duplicate-1', 'daily-reward-1', 'simultaneous-echo-1',
    'outbox-replay-after-crash', 'outbox-transaction-rollback'].map(id => ['reference-pattern', id]),
];
function redact(text, secrets = []) {
  let value = String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
  for (const secret of secrets.filter(x => typeof x === 'string' && x.length > 3)) value = value.split(secret).join('[REDACTED]');
  return value
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/(?:postgres(?:ql)?|redis):\/\/[^\s'"<>]+/gi, '[DATABASE_URL_REDACTED]')
    .replace(/Bearer\s+[^\s,'"<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{43}\b/g, '[TOKEN_REDACTED]')
    .replace(/((?:password|secret|api[_-]?key|token)\s*[=:]\s*)[^\s,'"<>]+/gi, '$1[REDACTED]')
    .replace(/[A-Za-z]:[\\/][^\r\n'"<>]+/g, '[HOST_PATH_REDACTED]')
    .replace(/\/home\/[^/\s]+/g, '/home/[USER]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL_REDACTED]');
}
function classifyStress(raw, exitCode) {
  const invalid = () => ({ status: 'REGRESSION', known: [], newFailures: ['stress-report-invalid-or-incomplete'], improved: [] });
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.records) || ![0, 1, 2].includes(exitCode)) return invalid();
  const keys = raw.records.map(x => `${x.layer}:${x.id}`);
  if (new Set(keys).size !== keys.length || REQUIRED.some(([layer, id]) => !keys.includes(`${layer}:${id}`))) return invalid();
  if (raw.records.some(x => typeof x.invariantPassed !== 'boolean')) return invalid();
  const failed = raw.records.filter(x => !x.invariantPassed);
  const referenceOK = !failed.some(x => x.layer === 'reference-pattern');
  if (raw.violations !== failed.length || raw.releaseGatePassed !== (failed.length === 0) || raw.referenceGatePassed !== referenceOK) return invalid();
  const expectedExit = !referenceOK ? 1 : failed.length ? 2 : 0;
  if (exitCode !== expectedExit || raw.cleanup !== 'run fixtures removed') return invalid();
  const known = failed.filter(x => x.layer === 'current-service' && KNOWN.includes(x.id)).map(x => x.id);
  const newFailures = failed.filter(x => !(x.layer === 'current-service' && KNOWN.includes(x.id))).map(x => `${x.layer}:${x.id}`);
  const improved = KNOWN.filter(id => raw.records.some(x => x.layer === 'current-service' && x.id === id && x.invariantPassed));
  return { status: newFailures.length ? 'REGRESSION' : known.length ? 'KNOWN_ISSUES' : 'PASS', known, newFailures, improved };
}
function overall(stages, expectedNames) {
  if (stages.some(s => s.status === 'REGRESSION')) return 'REGRESSION';
  if (stages.some(s => s.status === 'ENVIRONMENT_BLOCKED')) return 'ENVIRONMENT_BLOCKED';
  if (expectedNames.some(name => !stages.some(s => s.name === name && s.status !== 'NOT_RUN'))) return 'INCOMPLETE';
  return stages.some(s => s.status === 'KNOWN_ISSUES') ? 'KNOWN_ISSUES' : 'PASS';
}
function render(report) {
  const lines = ['PROJECT30 LOCAL CHECK - paste this report', `Schema: ${report.schemaVersion}`, `Source commit: ${report.commit}`, `Source archive SHA256: ${report.archiveSha256 || 'not-container-archive'}`, `Run: ${report.runId}`, `Runtime: ${report.node} / ${report.platform} / ${report.arch}`, `Overall: ${report.overall}`, 'Known-issue catalog: U02-A / bed7e29 (update explicitly when fixing each invariant)', ''];
  for (const stage of report.stages) {
    lines.push(`${stage.name}: ${stage.status} (exit=${stage.exitCode ?? 'n/a'}, seconds=${stage.seconds ?? 0})`);
    for (const detail of stage.details || []) lines.push(`  ${detail}`);
  }
  lines.push('', 'Scope: synthetic engineering tests only. No real login, browser/WeChat device UX, retention, or production capacity acceptance.', 'Public login is not implemented; legacy matching/join/media/ticket/admin/WS features remain disabled.', 'GitHub Actions is NOT enabled; local PASS does not mean release-ready.', 'Cleanup: see launcher section below (container run); interrupted runs are not passes.');
  return redact(lines.join('\n')) + '\n';
}
module.exports = { KNOWN, REQUIRED, redact, classifyStress, overall, render };
