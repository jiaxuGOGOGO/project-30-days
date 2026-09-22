#!/usr/bin/env node
'use strict';
// Synthetic sensitivity study, NOT observed retention or a production benchmark.
// Run: node test/social-simulation.cjs [--runs=500] [--seed=20260922] [--self-test]
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

function option(name, fallback, min, max) {
  const arg = process.argv.find(x => x.startsWith(`--${name}=`));
  const value = arg ? Number(arg.split('=')[1]) : fallback;
  assert(Number.isSafeInteger(value) && value >= min && value <= max, `Invalid ${name}`);
  return value;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function summary(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  const avg = mean(xs);
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - avg) ** 2, 0) / Math.max(1, xs.length - 1));
  return { mean: avg, p10: sorted[Math.floor((xs.length - 1) * .1)], p90: sorted[Math.floor((xs.length - 1) * .9)], monteCarloMean95: [avg - 1.96 * sd / Math.sqrt(xs.length), avg + 1.96 * sd / Math.sqrt(xs.length)] };
}
const scenarios = [
  { id: 'engaged', attendance: .85, compatibility: .30, willing: .90, daily: .90, dropoutHazard: .008, delayMaxHours: 36 },
  { id: 'busy', attendance: .70, compatibility: .25, willing: .85, daily: .72, dropoutHazard: .018, delayMaxHours: 96 },
  { id: 'sparse', attendance: .40, compatibility: .08, willing: .80, daily: .80, dropoutHazard: .02, delayMaxHours: 72 },
  { id: 'low_intent', attendance: .65, compatibility: .25, willing: .45, daily: .65, dropoutHazard: .05, delayMaxHours: 120 },
];
const policies = ['24h', '24h_opt_in_24h_grace', '48h', '72h'];
function simulate(seed, scenario, cohortSize) {
  const random = rng(seed);
  const attended = Array.from({ length: cohortSize }, () => random() < scenario.attendance);
  const users = attended.map((a, i) => a ? i : -1).filter(i => i >= 0);
  // Symmetric random compatibility graph; not a demographic matching model.
  const edges = [], degree = new Map(users.map(i => [i, 0]));
  for (let i = 0; i < users.length; i++) for (let j = i + 1; j < users.length; j++) {
    if (random() < scenario.compatibility) {
      edges.push([users[i], users[j]]);
      degree.set(users[i], degree.get(users[i]) + 1); degree.set(users[j], degree.get(users[j]) + 1);
    }
  }
  for (let i = edges.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [edges[i], edges[j]] = [edges[j], edges[i]];
  }
  const occupied = new Set(), pairs = [];
  for (const [a, b] of edges) if (!occupied.has(a) && !occupied.has(b)) {
    occupied.add(a); occupied.add(b); pairs.push([a, b]);
  }
  const output = Object.fromEntries(policies.map(p => [p, { activated: 0, feedbackEligibleDay30: 0, jointDays: 0, unresolvedHours: 0, safetyExits: 0 }]));
  for (const pair of pairs) {
    void pair;
    // Identical latent users/traces for every policy (common random numbers).
    const willingA = random() < scenario.willing, willingB = random() < scenario.willing;
    const delayA = 1 + random() * scenario.delayMaxHours, delayB = 1 + random() * scenario.delayMaxHours;
    const graceOptIn = random() < .5; // explicit prior opt-in; assumption, not measured
    const safetyExit = random() < .02;
    let aliveA = true, aliveB = true, joint = 0, lastWeek = 0;
    for (let day = 2; day <= 30; day++) {
      aliveA = aliveA && random() >= scenario.dropoutHazard;
      aliveB = aliveB && random() >= scenario.dropoutHazard;
      const commonOutage = random() < .03;
      const answerA = random() < scenario.daily, answerB = random() < scenario.daily;
      if (aliveA && aliveB && !commonOutage && answerA && answerB) {
        joint++; if (day >= 24) lastWeek++;
      }
    }
    for (const policy of policies) {
      const deadline = policy === '72h' ? 72 : policy === '48h' ? 48 : policy === '24h_opt_in_24h_grace' && graceOptIn ? 48 : 24;
      const active = willingA && willingB && Math.max(delayA, delayB) <= deadline && !safetyExit;
      const m = output[policy];
      m.unresolvedHours += active ? Math.max(delayA, delayB) : safetyExit ? 0 : deadline;
      if (safetyExit) m.safetyExits++;
      if (active) {
        m.activated++; m.jointDays += joint;
        if (aliveA && aliveB && lastWeek >= 3) m.feedbackEligibleDay30++;
      }
    }
  }
  return { attendees: users.length, noCompatiblePeer: users.filter(u => degree.get(u) === 0).length, proposedPairs: pairs.length, policies: output };
}

// Executable specification of the proposed vote lifecycle. Not production code.
const DAY = 86400000;
function createJudgment() { return { state: 'VOTING', round: 1, reopenAt: 0, votes: {}, result: null }; }
function vote(state, user, choice, now) {
  assert(['a', 'b'].includes(user), 'not a member');
  assert(['STAY', 'PAUSE'].includes(choice), 'invalid choice');
  if (state.state !== 'VOTING') throw new Error('not open');
  if (state.votes[user] && state.votes[user] !== choice) throw new Error('immutable vote');
  const next = structuredClone(state); next.votes[user] = choice;
  if (!next.votes.a || !next.votes.b) return next;
  if (next.votes.a === 'STAY' && next.votes.b === 'STAY') { next.state = 'LEGACY'; next.result = 'LEGACY'; }
  else if (next.round === 2) { next.state = 'DESTROYED'; next.result = 'ASH'; }
  else {
    next.state = next.votes.a === 'PAUSE' && next.votes.b === 'PAUSE' ? 'COOLDOWN' : 'EXTENSION';
    next.reopenAt = now + (next.state === 'COOLDOWN' ? 14 : 7) * DAY;
  }
  return next;
}
function tick(state, now) {
  if (!['EXTENSION', 'COOLDOWN'].includes(state.state) || now < state.reopenAt) return structuredClone(state);
  return { ...structuredClone(state), state: 'VOTING', round: 2, votes: {} };
}
function selfTest() {
  assert.deepEqual(simulate(7, scenarios[0], 50), simulate(7, scenarios[0], 50));
  assert.equal(simulate(7, { ...scenarios[0], attendance: 0 }, 50).proposedPairs, 0);
  assert.equal(simulate(7, { ...scenarios[0], compatibility: 0 }, 50).proposedPairs, 0);
  let transitions = 0;
  for (const a of ['STAY', 'PAUSE']) for (const b of ['STAY', 'PAUSE']) {
    let state = createJudgment(); state = vote(state, 'a', a, 0);
    assert.deepEqual(vote(state, 'a', a, 0), state);
    assert.throws(() => vote(state, 'outsider', a, 0));
    assert.throws(() => vote(state, 'a', a === 'STAY' ? 'PAUSE' : 'STAY', 0));
    state = vote(state, 'b', b, 0); transitions++;
    if (a === 'STAY' && b === 'STAY') { assert.equal(state.state, 'LEGACY'); continue; }
    assert.equal(state.state, a === b ? 'COOLDOWN' : 'EXTENSION');
    assert.deepEqual(tick(state, state.reopenAt - 1), state);
    assert.throws(() => vote(state, 'a', 'STAY', 0));
    const reopened = tick(state, state.reopenAt);
    assert.equal(reopened.round, 2); assert.deepEqual(tick(reopened, state.reopenAt), reopened);
    for (const c of ['STAY', 'PAUSE']) for (const d of ['STAY', 'PAUSE']) {
      const end = vote(vote(reopened, 'a', c, state.reopenAt), 'b', d, state.reopenAt);
      assert.equal(end.state, c === 'STAY' && d === 'STAY' ? 'LEGACY' : 'DESTROYED'); transitions++;
      assert.throws(() => vote(end, 'a', c, state.reopenAt));
    }
  }
  for (let seed = 1; seed <= 200; seed++) {
    const result = simulate(seed, scenarios[seed % scenarios.length], 50);
    assert(result.proposedPairs * 2 <= result.attendees);
    const p = result.policies;
    assert(p['24h'].activated <= p['24h_opt_in_24h_grace'].activated);
    assert(p['24h_opt_in_24h_grace'].activated <= p['48h'].activated);
    assert(p['48h'].activated <= p['72h'].activated);
    for (const metric of Object.values(p)) assert(metric.feedbackEligibleDay30 <= metric.activated);
  }
  return { deterministicAndBoundaryTests: 'passed', judgmentPaths: transitions, randomizedCohorts: 200 };
}
function main() {
  const tests = selfTest();
  if (process.argv.includes('--self-test')) { console.log(JSON.stringify(tests, null, 2)); return; }
  const runs = option('runs', 500, 2, 10000), seed = option('seed', 20260922, 1, 4294967295);
  const results = [];
  for (const scenario of scenarios) {
    const samples = Array.from({ length: runs }, (_, i) => simulate(seed + i, scenario, 50));
    const metrics = {};
    for (const policy of policies) {
      metrics[policy] = {
        activatedPairsPerCohort: summary(samples.map(x => x.policies[policy].activated)),
        feedbackEligiblePairsDay30: summary(samples.map(x => x.policies[policy].feedbackEligibleDay30)),
        meanUnresolvedHoursPerProposedPair: summary(samples.map(x => x.proposedPairs ? x.policies[policy].unresolvedHours / x.proposedPairs : 0)),
        pairedActivationDifferenceVs24h: summary(samples.map(x => x.policies[policy].activated - x.policies['24h'].activated)),
      };
    }
    results.push({ assumptions: scenario, attendees: summary(samples.map(x => x.attendees)), proposedPairs: summary(samples.map(x => x.proposedPairs)), noCompatiblePeer: summary(samples.map(x => x.noCompatiblePeer)), metrics });
  }
  const density = [20, 50, 100].map(size => ({ size, attendance: .4, compatibility: .08,
    noPeerShareAmongAttendees: summary(Array.from({ length: runs }, (_, i) => { const x = simulate(seed + i, scenarios[2], size); return x.attendees ? x.noCompatiblePeer / x.attendees : 0; })) }));
  const dailyFragility = [.7, .8, .9, .95].map(p => ({ assumedIndividualDailyReply: p, probabilityBothReplyAll28DaysUnderIndependence: p ** 56 }));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  console.log(JSON.stringify({ schemaVersion: 1, modelVersion: 'social-sensitivity-v1', commit, scriptSha256: createHash('sha256').update(readFileSync(__filename)).digest('hex'), seed, runsPerScenario: runs, cohortSize: 50, tests,
    limitations: ['Synthetic assumptions, not calibrated user data or causal estimates.', 'No production RPS measurement.', 'Policies use identical traces; longer deadlines mechanically admit more replies and delay closure.', 'Feedback eligibility means alive on day30 with >=3 joint replies in last7 days, NOT relationship success.', 'Greedy one-pair assignment is an experiment assumption, not current production matchmaking.', '95% intervals measure Monte Carlo error only, not uncertainty in human behavior.', 'Strict daily fragility formula is a hypothetical rule, not current implemented DEEP_LINK behavior.'],
    results, density, dailyFragility }, null, 2));
}
if (require.main === module) main();
module.exports = { simulate, scenarios, vote, tick, createJudgment, selfTest };
