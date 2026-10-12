import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createQlooRuntime } from './qloo-runtime.mjs';
import { guardedFetch } from '../scripts/qloo-fetch-guard.mjs';

// All responses below are invented fixtures. No provider requests are made.
const AT = Date.parse('2030-01-01T12:00:00.000Z');
const URL = 'https://hackathon.api.qloo.com/search?query=Invented';
const state = (attempts = 0, lastAttemptAt = null, paused = null) =>
  ({ day: '2030-01-01', attempts, lastAttemptAt, paused });

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-qloo-pools-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const clock = { at: AT };
  const legacy = join(directory, 'qloo-request-state.json');
  const publicLedger = join(directory, 'qloo-public-request-state.json');
  const read = async path => JSON.parse(await readFile(path, 'utf8'));
  const save = (path, value) => writeFile(path, JSON.stringify(value));
  const runtime = (pool, options = {}) => createQlooRuntime({ pool, guardDirectory: directory,
    now: () => clock.at, execFileImpl: async () => assert.fail('Unexpected CLI invocation'), ...options });
  const guard = (pool, options = {}) => guardedFetch({ pool, directory, live: true,
    now: () => clock.at, fetchImpl: async () => new Response('[]'), ...options });
  return { directory, clock, legacy, publicLedger, read, save, runtime, guard };
}

test('public Qloo budget exhaustion leaves the reserved judge counter available', async t => {
  const { clock, legacy, publicLedger, read, save, runtime, guard } = await setup(t);
  await save(legacy, state(1, AT - 60_000));
  let requests = 0;
  const fetchImpl = async () => { requests++; return new Response('[]'); };
  await guard('public', { dailyLimit: 2, fetchImpl })(URL);
  clock.at += 60_000;
  await guard('public', { dailyLimit: 2, fetchImpl })(URL);
  assert.equal((await read(legacy)).attempts, 1);
  assert.equal((await read(publicLedger)).attempts, 2);
  assert.equal((await runtime('public', { dailyLimit: 2 }).status()).remainingRequests, 0);
  clock.at += 60_000;
  await assert.rejects(guard('public', { dailyLimit: 2, fetchImpl })(URL), /daily experiment budget/);
  await guard('judge', { dailyLimit: 3, fetchImpl })(URL);
  assert.equal(requests, 3);
  assert.equal((await read(legacy)).attempts, 2);
  assert.equal((await read(publicLedger)).attempts, 2);
  assert.equal((await runtime('judge', { dailyLimit: 3 }).status()).remainingRequests, 1);
});

test('both Qloo pools share the same sixty-second request spacing', async t => {
  const { clock, legacy, read, runtime, guard } = await setup(t);
  await guard('public')(URL);
  assert.equal((await read(legacy)).attempts, 0);
  assert.equal((await runtime('judge').status()).cooldownMs, 60_000);
  await assert.rejects(guard('judge')(URL), /60 seconds/);
  clock.at += 60_000;
  await guard('judge')(URL);
  assert.equal((await runtime('public').status()).cooldownMs, 60_000);
  await assert.rejects(guard('public')(URL), /60 seconds/);
});

test('legacy Qloo attempts, timestamp and provider pause survive the pool split', async t => {
  const { legacy, read, save, runtime } = await setup(t);
  const original = state(42, AT - 10_000);
  await save(legacy, original);
  const judges = runtime('judge', { dailyLimit: 60 });
  const visitors = runtime('public', { dailyLimit: 120 });
  assert.equal((await judges.status()).requestsToday, 42);
  assert.equal((await visitors.status()).requestsToday, 0);
  assert.equal((await visitors.status()).cooldownMs, 50_000);
  await assert.rejects(visitors.execute({ operation: 'search', query: 'Invented' }), error => error.code === 'qloo_cooldown');
  assert.deepEqual(await read(legacy), original);
  assert.equal(await visitors.pause(), true);
  const paused = await read(legacy);
  assert.equal(paused.attempts, original.attempts);
  assert.equal(paused.lastAttemptAt, original.lastAttemptAt);
  assert.equal(paused.paused.status, 'runtime_failure');
  assert.equal((await judges.status()).paused, true);
  assert.equal((await visitors.status()).paused, true);
});

test('a failed public Qloo request consumes only its pool and pauses both pools without retries', async t => {
  const { clock, legacy, publicLedger, read, save, runtime, guard } = await setup(t);
  await save(legacy, state(7, AT - 60_000));
  let requests = 0;
  const failed = guard('public', { fetchImpl: async () => {
    requests++; return new Response('{}', { status: 429, headers: { 'retry-after': '120' } });
  } });
  assert.equal((await failed(URL)).status, 429);
  assert.equal((await read(publicLedger)).attempts, 1);
  assert.equal((await read(legacy)).attempts, 7);
  assert.equal((await read(legacy)).paused.status, 429);
  assert.equal((await runtime('public').status()).paused, true);
  assert.equal((await runtime('judge').status()).paused, true);
  await assert.rejects(failed(URL), /one network attempt/);
  clock.at += 120_000;
  await assert.rejects(guard('judge', { fetchImpl: async () => assert.fail('Paused request sent') })(URL), /paused/);
  assert.equal(requests, 1);
});

test('public runtime forwards its pool and cap to the CLI and verifies its own reservation', async t => {
  const context = await setup(t);
  const { legacy, publicLedger, read, save, runtime, guard } = context;
  await save(legacy, state(4, AT - 60_000));
  const visitors = runtime('public', { dailyLimit: 120, execFileImpl: async (executable, args, options) => {
    assert.equal(options.env.REELBALANCE_QLOO_POOL, 'public');
    assert.equal(options.env.REELBALANCE_PUBLIC_QLOO_DAILY_LIMIT, '120');
    const response = await guard(options.env.REELBALANCE_QLOO_POOL,
      { dailyLimit: Number(options.env.REELBALANCE_PUBLIC_QLOO_DAILY_LIMIT) })(URL);
    return { stdout: await response.text() };
  } });
  let reservations = 0;
  assert.equal((await visitors.execute({ operation: 'search', query: 'Invented' }, { beforeRequest: () => { reservations++; } })).qlooRequests, 1);
  assert.equal(reservations, 1);
  await assert.rejects(visitors.execute({ operation: 'search', query: 'Invented' },
    { beforeRequest: () => { reservations++; } }), error => error.code === 'qloo_cooldown');
  assert.equal(reservations, 1);
  assert.equal((await read(legacy)).attempts, 4);
  assert.equal((await read(publicLedger)).attempts, 1);
  const status = await visitors.status();
  assert.equal(status.pool, 'public');
  assert.equal(status.remainingRequests, 119);
});

test('a rejected access reservation sends no Qloo attempt and does not pause the provider', async t => {
  const { runtime } = await setup(t);
  const visitors = runtime('public');
  await assert.rejects(visitors.execute({ operation: 'search', query: 'Invented' },
    { beforeRequest: () => { throw Object.assign(Error('Guest allowance exhausted'), { code: 'guest_qloo_limit' }); } }),
  error => error.code === 'guest_qloo_limit');
  const status = await visitors.status();
  assert.equal(status.requestsToday, 0);
  assert.equal(status.busy, false);
  assert.equal(status.paused, false);
});

test('unusable public CLI output pauses the shared Qloo provider without resetting counters', async t => {
  const { legacy, publicLedger, read, save, runtime, guard } = await setup(t);
  await save(legacy, state(8, AT - 60_000));
  const visitors = runtime('public', { execFileImpl: async () => {
    await guard('public')(URL);
    return { stdout: 'unusable output' };
  } });
  await assert.rejects(visitors.execute({ operation: 'search', query: 'Invented' }), error => error.code === 'qloo_operation_failed');
  assert.equal((await read(publicLedger)).attempts, 1);
  assert.equal((await read(legacy)).attempts, 8);
  assert.equal((await runtime('judge').status()).paused, true);
});

test('corrupt shared Qloo state fails closed for both public and judge requests', async t => {
  const { legacy, runtime, guard } = await setup(t);
  await writeFile(legacy, '{broken');
  for (const pool of ['public', 'judge']) {
    await assert.rejects(runtime(pool).status(), error => error.code === 'qloo_guard_unavailable');
    await assert.rejects(guard(pool, { fetchImpl: async () => assert.fail('Corrupt state request sent') })(URL), /Cannot read/);
  }
});

test('a partial public reservation retains the global lock and sends no provider request', async t => {
  const { directory, publicLedger, runtime, guard } = await setup(t);
  const failPublicWrite = async (path, value, options) => {
    if (path === publicLedger) throw Error('Injected ledger failure');
    return writeFile(path, value, options);
  };
  await assert.rejects(guard('public', { writeFileImpl: failPublicWrite,
    fetchImpl: async () => assert.fail('Partially reserved request sent') })(URL), /Injected ledger failure/);
  await access(join(directory, 'qloo-request.lock'));
  assert.equal((await runtime('judge').status()).busy, true);
  assert.equal((await runtime('public').status()).busy, true);
});

test('the shared request lock blocks concurrent Qloo calls across pools', async t => {
  const { guard, runtime } = await setup(t);
  let release;
  let notify;
  const started = new Promise(resolve => { notify = resolve; });
  const pending = guard('public', { fetchImpl: async () => {
    notify(); await new Promise(resolve => { release = resolve; }); return new Response('[]');
  } })(URL);
  await started;
  assert.equal((await runtime('judge').status()).busy, true);
  try {
    await assert.rejects(guard('judge', { fetchImpl: async () => assert.fail('Concurrent request sent') })(URL), error => error.code === 'EEXIST');
  } finally { release(); }
  await pending;
});
