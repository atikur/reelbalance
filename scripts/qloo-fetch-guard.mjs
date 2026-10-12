import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { QLOO_POLICY, validateQlooDailyLimit, validateQlooPool, validQlooState, emptyQlooState } from '../app/qloo-runtime.mjs';

// These are our conservative development limits, not published Qloo quotas.
export const POLICY = QLOO_POLICY;
export function guardedFetch({ fetchImpl, directory, live = false, now = Date.now, writeFileImpl = writeFile,
  pool = process.env.REELBALANCE_QLOO_POOL ?? 'judge', dailyLimit }) {
  validateQlooPool(pool);
  const configuredDailyLimit = validateQlooDailyLimit(dailyLimit ??
    (pool === 'public' ? process.env.REELBALANCE_PUBLIC_QLOO_DAILY_LIMIT : process.env.REELBALANCE_QLOO_DAILY_LIMIT) ?? POLICY.dailyAttempts);
  let attempted = false;
  return async (input, options = {}) => {
    if (!live) throw Error('Qloo live access disabled; use cached results.');
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== 'https://hackathon.api.qloo.com' || url.username || url.password ||
        !['/search', '/v2/tags', '/v2/insights'].includes(url.pathname) ||
        (options.method ?? input?.method ?? 'GET').toUpperCase() !== 'GET' ||
        url.searchParams.has('api_key') || url.searchParams.has('api-key')) {
      throw Error('Qloo request is outside the approved experiment endpoints.');
    }
    if (attempted) throw Error('Only one network attempt per CLI invocation; internal retries blocked.');
    await mkdir(directory, { recursive: true });
    const lock = resolve(directory, 'qloo-request.lock');
    // Exclusive creation serializes independent processes. Never auto-clear a stale lock.
    await writeFileImpl(lock, '', { flag: 'wx', mode: 0o600 });
    const sharedStatePath = resolve(directory, 'qloo-request-state.json');
    const statePath = pool === 'public' ? resolve(directory, 'qloo-public-request-state.json') : sharedStatePath;
    let releaseLock = true;
    try {
      const readState = async path => {
        try {
          const bytes = await readFile(path);
          if (bytes.length > 16 * 1024) throw Error('Invalid request guard state; refusing live access.');
          const state = JSON.parse(bytes.toString('utf8'));
          if (!validQlooState(state)) throw Error('Invalid request guard state; refusing live access.');
          return state;
        } catch (error) {
          if (error.code === 'ENOENT') return emptyQlooState();
          throw Error('Cannot read request guard state; refusing live access.');
        }
      };
      const shared = await readState(sharedStatePath);
      const state = pool === 'judge' ? shared : await readState(statePath);
      if (shared.paused || state.paused) throw Error('Qloo live access paused after an error; review before resuming.');
      const timestamp = now();
      const lastAttemptAt = Math.max(shared.lastAttemptAt ?? -Infinity, state.lastAttemptAt ?? -Infinity);
      if (timestamp - lastAttemptAt < POLICY.minimumGapMs) {
        throw Error('Wait at least 60 seconds between Qloo requests; no request was sent.');
      }
      const day = new Date(timestamp).toISOString().slice(0, 10);
      if (state.day !== day) { state.day = day; state.attempts = 0; }
      if (state.attempts >= configuredDailyLimit) throw Error('Local daily experiment budget reached.');
      state.attempts += 1;
      state.lastAttemptAt = timestamp;
      shared.lastAttemptAt = timestamp;
      // Count before sending: failures, crashes, and timeouts consume budget too.
      // A partial reservation retains the shared lock, preventing another pool
      // from sending after a failed write or a crash between the two ledgers.
      releaseLock = false;
      await writeFileImpl(sharedStatePath, JSON.stringify(shared, null, 2) + '\n', { mode: 0o600 });
      if (pool === 'public') await writeFileImpl(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
      releaseLock = true;
      attempted = true;
      const savePause = async () => {
        releaseLock = false;
        try {
          await writeFileImpl(sharedStatePath, JSON.stringify(shared, null, 2) + '\n', { mode: 0o600 });
          releaseLock = true;
        } catch {
          throw Error('Qloo pause could not be saved. Request lock retained; operator review is required. No automatic retry.');
        }
      };
      let response;
      try {
        response = await fetchImpl(input, { ...options, redirect: 'error' });
      } catch {
        shared.paused = { at: new Date(timestamp).toISOString(), status: 'network_failure' };
        await savePause();
        throw Error('Qloo request failed; live access paused. No automatic retry.');
      }
      if (!response.ok) {
        shared.paused = { at: new Date(timestamp).toISOString(), status: response.status,
          retry_after: response.headers.get('retry-after') };
        await savePause();
      }
      return response;
    } finally { if (releaseLock) await unlink(lock); }
  };
}

globalThis.fetch = guardedFetch({
  fetchImpl: globalThis.fetch,
  directory: resolve(import.meta.dirname, '../.cache'),
  live: process.env.CROSSCUE_QLOO_LIVE === '1',
});
