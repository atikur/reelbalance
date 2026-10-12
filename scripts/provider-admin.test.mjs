import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, symlink, link, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgrammeService } from '../app/programme-service.mjs';
import { createAgentService, validateOpenAIDailyLimit } from '../app/agent-service.mjs';
import { providerStatus, recoverOpenAI, runProviderAdmin } from './provider-admin.mjs';

const fixture = JSON.parse(await readFile(new URL('../release/synthetic-data.json', import.meta.url), 'utf8'));
const programmeService = createProgrammeService(fixture);
const now = () => Date.parse('2026-10-10T12:00:00Z');
const message = { message: 'Explain the cached choices.', context: { slots: 3, maximumRuntime: 110, excluded: [], locked: [], current: [] } };
const pause = { reason: 'provider_rate_limit', at: '2026-10-10T10:00:00.000Z' };
const saved = (attempts = 50, paused = pause) => ({ schemaVersion: 1, day: '2026-10-10', attempts, ...(paused ? { paused } : {}) });
const mockAnswer = () => new Response(JSON.stringify({ status: 'completed', output: [
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Invented offline answer.' }] },
] }));

async function state(t, contents) {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-provider-admin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const budgetPath = join(directory, 'openai-usage.json');
  if (contents) await writeFile(budgetPath, JSON.stringify(contents), { mode: 0o600 });
  return { directory, budgetPath };
}

test('OpenAI limit configuration rejects malformed or unbounded values', () => {
  assert.equal(validateOpenAIDailyLimit(), 36);
  assert.equal(validateOpenAIDailyLimit('120'), 120);
  assert.equal(validateOpenAIDailyLimit(360), 360);
  for (const value of [0, -1, 361, 1.5, '', '0', '01', '1e2', ' 120', null, NaN]) {
    assert.throws(() => validateOpenAIDailyLimit(value), /integer/);
  }
});

test('lowering the allowance preserves previously consumed attempts and sends no request', async t => {
  const { budgetPath } = await state(t, saved(50, null));
  let calls = 0;
  const service = createAgentService({ programmeService, budgetPath, dailyLimit: 36, apiKey: 'mock-key', now,
    persistProviderPause: true, fetchImpl: async () => { calls++; return mockAnswer(); } });
  assert.equal(service.status().remainingRequests, 0);
  assert.equal(service.status().requestsToday, 50);
  assert.equal(service.status().providerStatus, 'budget_exhausted');
  await assert.rejects(service.run(message), error => error.code === 'agent_budget_exhausted');
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(await readFile(budgetPath)), saved(50, null));
});

test('an explicitly increased allowance counts forward from the existing ledger', async t => {
  const { budgetPath } = await state(t, saved(50, null));
  let calls = 0;
  const service = createAgentService({ programmeService, budgetPath, dailyLimit: '120', apiKey: 'mock-key', now,
    persistProviderPause: true, fetchImpl: async () => { calls++; return mockAnswer(); } });
  assert.equal(service.status().remainingRequests, 70);
  await service.run(message);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(await readFile(budgetPath)), saved(51, null));
  assert.equal(service.status().remainingRequests, 69);
});

test('server-created agents read the configured allowance from the environment', async t => {
  const { budgetPath } = await state(t, saved(50, null));
  const previous = process.env.REELBALANCE_OPENAI_DAILY_LIMIT;
  try {
    process.env.REELBALANCE_OPENAI_DAILY_LIMIT = '120';
    const service = createAgentService({ programmeService, budgetPath, apiKey: 'mock-key', now,
      fetchImpl: async () => { throw Error('Status must never request a provider'); } });
    assert.equal(service.status().maxRequestsPerDay, 120);
    assert.equal(service.status().remainingRequests, 70);
  } finally {
    if (previous === undefined) delete process.env.REELBALANCE_OPENAI_DAILY_LIMIT;
    else process.env.REELBALANCE_OPENAI_DAILY_LIMIT = previous;
  }
});

test('larger daily allowances retain the three-request interaction ceiling', async t => {
  const { budgetPath } = await state(t);
  let calls = 0;
  const service = createAgentService({ programmeService, budgetPath, dailyLimit: 120, apiKey: 'mock-key', now,
    persistProviderPause: true, fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', output: [
      { type: 'function_call', call_id: `mock-${++calls}`, name: 'read_programme_context', arguments: '{}' },
    ] })) });
  await assert.rejects(service.run(message), error => error.code === 'agent_round_limit');
  assert.equal(calls, 3);
  assert.equal(JSON.parse(await readFile(budgetPath)).attempts, 3);
  assert.equal(service.status().maxRequestsPerMessage, 3);
});

test('the larger allowance still permits only one interaction globally', async t => {
  const { budgetPath } = await state(t);
  let release;
  let calls = 0;
  const response = new Promise(resolve => { release = () => resolve(mockAnswer()); });
  const options = { programmeService, budgetPath, dailyLimit: 120, apiKey: 'mock-key', now, persistProviderPause: true,
    fetchImpl: async () => { calls++; return response; } };
  const service = createAgentService(options);
  const first = service.run(message);
  try {
    assert.equal(service.status().providerStatus, 'busy');
    assert.equal(service.status().operatorReviewRequired, false, 'An active interaction is healthy');
    await assert.rejects(createAgentService(options).run(message), error => error.code === 'agent_busy');
    await writeFile(`${budgetPath}.admin.lock`, '');
    assert.equal(service.status().operatorReviewRequired, true, 'Maintenance locks always require review');
    await rm(`${budgetPath}.admin.lock`);
  }
  finally { release(); await first; }
  assert.equal(calls, 1);
});

test('all unfinished durable OpenAI locks require operator review without a provider call', async t => {
  const { budgetPath } = await state(t, saved(1, null));
  let calls = 0;
  const service = createAgentService({ programmeService, budgetPath, dailyLimit: 120, apiKey: 'mock-key', now,
    persistProviderPause: true, fetchImpl: async () => { calls++; return mockAnswer(); } });
  assert.equal(service.status().providerStatus, 'ready');
  assert.equal(service.status().operatorReviewRequired, false);
  for (const suffix of ['.lock', '.interaction.lock', '.admin.lock']) {
    await writeFile(`${budgetPath}${suffix}`, '');
    const status = service.status();
    assert.equal(status.providerStatus, 'busy');
    assert.equal(status.busy, true);
    assert.equal(status.operatorReviewRequired, true);
    await assert.rejects(service.run(message), error => error.code === 'agent_busy');
    await rm(`${budgetPath}${suffix}`);
  }
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(await readFile(budgetPath)), saved(1, null));
});

test('operator status is read-only, reports an existing pause, and never claims a provider probe', async t => {
  const { directory, budgetPath } = await state(t, saved());
  await writeFile(`${budgetPath}.interaction.lock`, '');
  const before = await readFile(budgetPath);
  const files = await readdir(directory);
  const result = providerStatus({ directory, dailyLimit: 120, now });
  assert.equal(result.ledgerStatus, 'paused');
  assert.equal(result.providerAvailability, 'not_checked');
  assert.equal(result.networkRequests, 0);
  assert.equal(result.remainingRequests, 70);
  assert.deepEqual(result.locks, ['openai-usage.json.interaction.lock']);
  assert.deepEqual(await readFile(budgetPath), before);
  assert.deepEqual(await readdir(directory), files);
});

test('status of a missing state directory creates no files', async t => {
  const { directory } = await state(t);
  const missing = join(directory, 'not-created');
  const result = providerStatus({ directory: missing, now });
  assert.equal(result.ledger, null);
  assert.equal(result.dailyLimit, 36);
  assert.equal(result.networkRequests, 0);
  assert.deepEqual(await readdir(directory), []);
});

test('recovery requires stopped acknowledgement, reviewed reason and explicit stale-lock consent', async t => {
  const { directory, budgetPath } = await state(t, saved());
  await writeFile(`${budgetPath}.interaction.lock`, '');
  const before = await readFile(budgetPath);
  assert.throws(() => recoverOpenAI({ directory, reviewedReason: 'Provider limit reviewed.' }), /confirm-app-stopped/);
  assert.throws(() => recoverOpenAI({ directory, confirmAppStopped: true, reviewedReason: 'short' }), /10–500/);
  assert.throws(() => recoverOpenAI({ directory, confirmAppStopped: true, reviewedReason: 'Provider limit reviewed.' }), /clear-stale-locks/);
  assert.deepEqual(await readFile(budgetPath), before);
  assert.deepEqual((await readdir(directory)).sort(), ['openai-usage.json', 'openai-usage.json.interaction.lock']);
});

test('reviewed recovery preserves day and attempts, removes only approved OpenAI locks, and saves a private audit', async t => {
  const { directory, budgetPath } = await state(t, saved());
  await writeFile(`${budgetPath}.lock`, '');
  await writeFile(`${budgetPath}.interaction.lock`, '');
  await writeFile(join(directory, 'qloo-request.lock'), '');
  const reviewedReason = 'Reviewed provider billing and confirmed the old request has stopped.';
  const result = recoverOpenAI({ directory, confirmAppStopped: true, reviewedReason, clearStaleLocks: true, now });
  assert.equal(result.recovered, true);
  assert.equal(result.networkRequests, 0);
  assert.deepEqual(result.ledger, saved(50, null));
  assert.deepEqual(JSON.parse(await readFile(budgetPath)), saved(50, null));
  assert.deepEqual((await readdir(directory)).sort(), ['openai-recovery.json', 'openai-usage.json', 'qloo-request.lock']);
  const audit = JSON.parse(await readFile(join(directory, 'openai-recovery.json')));
  assert.equal(audit.reviewedReason, reviewedReason);
  assert.equal(audit.attempts, 50);
  assert.equal(audit.day, '2026-10-10');
  assert.deepEqual(audit.previousPause, pause);
  assert.equal((await stat(join(directory, 'openai-recovery.json'))).mode & 0o777, 0o600);
});

test('clearing a stale lock before the first attempt leaves the absent ledger absent', async t => {
  const { directory, budgetPath } = await state(t);
  await writeFile(`${budgetPath}.interaction.lock`, '');
  const result = recoverOpenAI({ directory, confirmAppStopped: true, clearStaleLocks: true,
    reviewedReason: 'Confirmed the stopped app never sent its first request.', now });
  assert.equal(result.ledger, null);
  assert.deepEqual(await readdir(directory), ['openai-recovery.json']);
});

test('reviewed recovery makes no call, retains the old day, and only a restarted app resumes explicitly', async t => {
  const { directory, budgetPath } = await state(t);
  let calls = 0;
  const options = { programmeService, budgetPath, dailyLimit: 120, apiKey: 'mock-key', now,
    persistProviderPause: true, fetchImpl: async () => { calls++; return new Response('{}', { status: 429 }); } };
  const stoppedService = createAgentService(options);
  await assert.rejects(stoppedService.run(message));
  assert.equal(calls, 1);
  const recoveryDay = () => Date.parse('2026-10-11T12:00:00Z');
  const recovered = recoverOpenAI({ directory, confirmAppStopped: true,
    reviewedReason: 'Reviewed the provider rate limit and confirmed billing availability.', now: recoveryDay });
  assert.equal(calls, 1);
  assert.equal(recovered.ledger.day, '2026-10-10');
  assert.equal(recovered.ledger.attempts, 1);
  await assert.rejects(stoppedService.run(message), error => error.code === 'agent_provider_paused');
  assert.equal(calls, 1, 'Old in-memory pauses must require the documented restart');
  const restarted = createAgentService({ ...options, fetchImpl: async () => { calls++; return mockAnswer(); } });
  await restarted.run(message);
  assert.equal(calls, 2);
  assert.deepEqual(JSON.parse(await readFile(budgetPath)), saved(2, null));
});

test('an existing administration lock blocks both recovery and new assistant work', async t => {
  const { directory, budgetPath } = await state(t, saved(1, null));
  await writeFile(`${budgetPath}.admin.lock`, '');
  const service = createAgentService({ programmeService, budgetPath, apiKey: 'mock-key', now, fetchImpl: async () => { throw Error('Must never request'); } });
  assert.equal(service.status().busy, true);
  await assert.rejects(service.run(message), error => error.code === 'agent_busy');
  assert.throws(() => recoverOpenAI({ directory, confirmAppStopped: true, reviewedReason: 'Reviewed the saved operator lock.', now }), /operator recovery/);
  // A pause also makes recovery necessary; the existing operator lock remains untouched.
  await writeFile(budgetPath, JSON.stringify(saved()));
  assert.throws(() => recoverOpenAI({ directory, confirmAppStopped: true, reviewedReason: 'Reviewed the saved provider failure.', now }), /operator recovery/);
  assert.equal(await readFile(`${budgetPath}.admin.lock`, 'utf8'), '');
});

test('unsafe ledgers fail closed in both the app and operator tool', async t => {
  const { directory, budgetPath } = await state(t);
  const target = join(directory, 'private-target.json');
  await writeFile(target, JSON.stringify(saved()));
  await symlink(target, budgetPath);
  assert.throws(() => providerStatus({ directory, now }), /could not be verified/);
  assert.throws(() => recoverOpenAI({ directory, confirmAppStopped: true, reviewedReason: 'Reviewed the provider failure.', now }), /could not be verified/);
  const service = createAgentService({ programmeService, budgetPath, apiKey: 'mock-key', now, fetchImpl: async () => { throw Error('Must never request'); } });
  await assert.rejects(service.run(message), error => error.code === 'agent_budget_unavailable');
  assert.deepEqual(JSON.parse(await readFile(target)), saved());
});

test('operator recovery rejects symlink directories and unsafe lock or audit files', async t => {
  const { directory, budgetPath } = await state(t, saved());
  const alias = `${directory}-alias`;
  await symlink(directory, alias); t.after(() => rm(alias, { force: true }));
  assert.throws(() => providerStatus({ directory: alias, now }), /real directory/);
  await symlink(budgetPath, `${budgetPath}.interaction.lock`);
  assert.throws(() => providerStatus({ directory, now }), /unsafe/);
  await rm(`${budgetPath}.interaction.lock`);
  await symlink(budgetPath, join(directory, 'openai-recovery.json'));
  assert.throws(() => recoverOpenAI({ directory, confirmAppStopped: true, reviewedReason: 'Reviewed the provider failure.', now }), /unsafe/);
  assert.deepEqual(JSON.parse(await readFile(budgetPath)), saved());
});

test('hard-linked, malformed and oversized usage files cannot be recovered', async t => {
  const { directory, budgetPath } = await state(t, saved());
  const alias = join(directory, 'hard-link.json');
  await link(budgetPath, alias);
  assert.throws(() => providerStatus({ directory, now }), /could not be verified/);
  await rm(alias);
  for (const contents of ['{invalid', 'x'.repeat(2049), JSON.stringify(saved(361))]) {
    await writeFile(budgetPath, contents);
    assert.throws(() => recoverOpenAI({ directory, confirmAppStopped: true, reviewedReason: 'Reviewed the provider failure.', now }), /could not be verified/);
    assert.equal(await readFile(budgetPath, 'utf8'), contents);
  }
});

test('CLI status rejects mutation flags and recovery requires explicit review options', async t => {
  const { directory } = await state(t, saved());
  assert.equal(runProviderAdmin(['status', '--state-dir', directory]).networkRequests, 0);
  assert.throws(() => runProviderAdmin(['status', '--confirm-app-stopped']), /Unknown operator option/);
  assert.throws(() => runProviderAdmin(['status', '--reviewed-reason', 'Reviewed failure.']), /read-only/);
  assert.throws(() => runProviderAdmin(['recover-openai', '--state-dir', directory]), /confirm-app-stopped/);
  assert.throws(() => runProviderAdmin(['status', '--state-dir', directory, '--state-dir', directory]), /Repeated/);
});

test('public exhaustion leaves the reserved judge budget available and preserves both counters', async t => {
  const { directory, budgetPath } = await state(t, saved(36, null));
  const judgeBudgetPath = join(directory, 'openai-judge-usage.json');
  let calls = 0;
  const options = { programmeService, apiKey: 'mock-key', providerPausePath: budgetPath, now,
    persistProviderPause: true, fetchImpl: async () => { calls++; return mockAnswer(); } };
  const publicAgent = createAgentService({ ...options, budgetPath, dailyLimit: 36 });
  const judgeAgent = createAgentService({ ...options, budgetPath: judgeBudgetPath, dailyLimit: 240 });
  await assert.rejects(publicAgent.run(message), error => error.code === 'agent_budget_exhausted');
  assert.equal(calls, 0);
  assert.equal(judgeAgent.status().remainingRequests, 240);
  await judgeAgent.run(message);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(await readFile(budgetPath)), saved(36, null));
  assert.deepEqual(JSON.parse(await readFile(judgeBudgetPath)), saved(1, null));
  const status = providerStatus({ directory, dailyLimit: 36, judgeDailyLimit: 240, now });
  assert.equal(status.ledgerStatus, 'budget_exhausted');
  assert.equal(status.judge.ledgerStatus, 'available');
  assert.equal(status.judge.remainingRequests, 239);
});

test('the judge budget has its own durable exhaustion ceiling', async t => {
  const { directory, budgetPath } = await state(t, saved(2, null));
  const judgeBudgetPath = join(directory, 'openai-judge-usage.json');
  await writeFile(judgeBudgetPath, JSON.stringify(saved(240, null)));
  let calls = 0;
  const options = { programmeService, apiKey: 'mock-key', providerPausePath: budgetPath, now,
    persistProviderPause: true, fetchImpl: async () => { calls++; return mockAnswer(); } };
  const judgeAgent = createAgentService({ ...options, budgetPath: judgeBudgetPath, dailyLimit: 240 });
  await assert.rejects(judgeAgent.run(message), error => error.code === 'agent_budget_exhausted');
  await createAgentService({ ...options, budgetPath, dailyLimit: 36 }).run(message);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(await readFile(judgeBudgetPath)), saved(240, null));
  assert.deepEqual(JSON.parse(await readFile(budgetPath)), saved(3, null));
});

test('public and judge interactions share the durable provider lease despite isolated counters', async t => {
  const { directory, budgetPath } = await state(t);
  const judgeBudgetPath = join(directory, 'openai-judge-usage.json');
  let release;
  let calls = 0;
  const response = new Promise(resolve => { release = () => resolve(mockAnswer()); });
  const options = { programmeService, apiKey: 'mock-key', providerPausePath: budgetPath, now, persistProviderPause: true,
    fetchImpl: async () => { calls++; return response; } };
  const publicAgent = createAgentService({ ...options, budgetPath, dailyLimit: 36 });
  const judgeAgent = createAgentService({ ...options, budgetPath: judgeBudgetPath, dailyLimit: 240 });
  const interaction = judgeAgent.run(message);
  try {
    assert.equal(publicAgent.status().providerStatus, 'busy');
    assert.equal(publicAgent.status().operatorReviewRequired, false);
    assert.equal(judgeAgent.status().providerStatus, 'busy');
    assert.equal(await readFile(`${budgetPath}.interaction.lock`, 'utf8'), '');
    await assert.rejects(publicAgent.run(message), error => error.code === 'agent_busy');
  } finally { release(); await interaction; }
  assert.equal(calls, 1);
  await assert.rejects(readFile(budgetPath), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await readFile(judgeBudgetPath)), saved(1, null));
});

test('judge provider failures pause both pools across restart and day rollover without charging the public pool', async t => {
  const { directory, budgetPath } = await state(t, saved(7, null));
  const judgeBudgetPath = join(directory, 'openai-judge-usage.json');
  await writeFile(judgeBudgetPath, JSON.stringify(saved(8, null)));
  let calls = 0;
  const options = { programmeService, apiKey: 'mock-key', providerPausePath: budgetPath, now, persistProviderPause: true,
    fetchImpl: async () => { calls++; return new Response('{}', { status: 429 }); } };
  await assert.rejects(createAgentService({ ...options, budgetPath: judgeBudgetPath, dailyLimit: 240 }).run(message),
    error => error.code === 'agent_provider_error');
  assert.equal(calls, 1);
  const publicSaved = JSON.parse(await readFile(budgetPath));
  assert.equal(publicSaved.attempts, 7);
  assert.equal(publicSaved.paused.reason, 'provider_rate_limit');
  assert.deepEqual(JSON.parse(await readFile(judgeBudgetPath)), saved(9, null));
  for (const path of [budgetPath, judgeBudgetPath]) {
    const restarted = createAgentService({ ...options, budgetPath: path, dailyLimit: 240,
      now: () => Date.parse('2026-10-11T12:00:00Z') });
    assert.equal(restarted.status().providerStatus, 'paused');
    await assert.rejects(restarted.run(message), error => error.code === 'agent_provider_paused');
  }
  assert.equal(calls, 1);
  const recovered = recoverOpenAI({ directory, confirmAppStopped: true,
    reviewedReason: 'Reviewed provider rate limits and billing before restarting both pools.', now });
  assert.equal(recovered.networkRequests, 0);
  assert.deepEqual(recovered.ledger, saved(7, null));
  assert.deepEqual(recovered.judgeLedger, saved(9, null));
  assert.equal(providerStatus({ directory, now }).judge.ledgerStatus, 'available');
});

test('a judge failure before public usage still creates a durable global pause with zero public attempts', async t => {
  const { directory, budgetPath } = await state(t);
  const judgeBudgetPath = join(directory, 'openai-judge-usage.json');
  const options = { programmeService, apiKey: 'mock-key', providerPausePath: budgetPath, now, persistProviderPause: true,
    fetchImpl: async () => { throw Error('Invented network failure'); } };
  await assert.rejects(createAgentService({ ...options, budgetPath: judgeBudgetPath, dailyLimit: 240 }).run(message));
  const publicSaved = JSON.parse(await readFile(budgetPath));
  assert.equal(publicSaved.attempts, 0);
  assert.equal(publicSaved.paused.reason, 'provider_network');
  assert.equal(createAgentService({ ...options, budgetPath, dailyLimit: 36 }).status().providerStatus, 'paused');
  assert.deepEqual(JSON.parse(await readFile(judgeBudgetPath)), saved(1, null));
});

test('operator review includes judge locks and counters while preserving unrelated provider state', async t => {
  const { directory, budgetPath } = await state(t, saved(7, null));
  const judgeBudgetPath = join(directory, 'openai-judge-usage.json');
  await writeFile(judgeBudgetPath, JSON.stringify(saved(8, null)));
  await writeFile(`${judgeBudgetPath}.lock`, '');
  await writeFile(join(directory, 'qloo-request.lock'), '');
  assert.deepEqual(providerStatus({ directory, now }).locks, ['openai-judge-usage.json.lock']);
  assert.throws(() => recoverOpenAI({ directory, confirmAppStopped: true,
    reviewedReason: 'Reviewed the stopped judge budget reservation.', now }), /clear-stale-locks/);
  const recovered = recoverOpenAI({ directory, confirmAppStopped: true, clearStaleLocks: true,
    reviewedReason: 'Reviewed the stopped judge budget reservation.', now });
  assert.deepEqual(recovered.clearedLocks, ['openai-judge-usage.json.lock']);
  assert.deepEqual(JSON.parse(await readFile(budgetPath)), saved(7, null));
  assert.deepEqual(JSON.parse(await readFile(judgeBudgetPath)), saved(8, null));
  assert.equal(await readFile(join(directory, 'qloo-request.lock'), 'utf8'), '');
});
