import { access, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QLOO_POLICY = Object.freeze({ minimumGapMs: 60_000, dailyAttempts: 12 });
export const QLOO_MAX_DAILY_LIMIT = 120;
export function validateQlooPool(pool = 'judge') {
  if (!['public', 'judge'].includes(pool)) throw new TypeError('Qloo pool must be public or judge.');
  return pool;
}
export function validateQlooDailyLimit(value = QLOO_POLICY.dailyAttempts) {
  if (typeof value === 'string' && /^[1-9]\d{0,2}$/.test(value)) value = Number(value);
  if (!Number.isInteger(value) || value < 1 || value > QLOO_MAX_DAILY_LIMIT) {
    throw new TypeError(`REELBALANCE_QLOO_DAILY_LIMIT must be an integer from 1 to ${QLOO_MAX_DAILY_LIMIT}.`);
  }
  return value;
}
const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const runFile = promisify(execFile);

export class QlooRuntimeError extends Error {
  constructor(message, { status = 503, code = 'qloo_unavailable' } = {}) {
    super(message); this.name = 'QlooRuntimeError'; this.status = status; this.code = code;
  }
}

const unavailable = () => new QlooRuntimeError('Qloo access is unavailable. No automatic retry will be made.', { code: 'qloo_guard_unavailable' });
const exists = async path => { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
export const emptyQlooState = () => ({ day: '', attempts: 0, lastAttemptAt: null, paused: null });

export function validQlooState(state) {
  const pause = state?.paused;
  const validPause = pause === null || (pause && typeof pause === 'object' && !Array.isArray(pause) &&
    Object.keys(pause).every(key => ['at', 'status', 'retry_after'].includes(key)) &&
    typeof pause.at === 'string' && Number.isFinite(Date.parse(pause.at)) && new Date(pause.at).toISOString() === pause.at &&
    ((Number.isInteger(pause.status) && pause.status >= 100 && pause.status <= 599) || ['network_failure', 'runtime_failure'].includes(pause.status)) &&
    (pause.retry_after === undefined || pause.retry_after === null || (typeof pause.retry_after === 'string' && pause.retry_after.length <= 200)));
  return state && typeof state === 'object' && !Array.isArray(state) && typeof state.day === 'string' &&
    (state.day === '' || /^\d{4}-\d{2}-\d{2}$/.test(state.day)) && Number.isInteger(state.attempts) &&
    state.attempts >= 0 && state.attempts <= QLOO_MAX_DAILY_LIMIT &&
    (state.lastAttemptAt === null || (Number.isFinite(state.lastAttemptAt) && state.lastAttemptAt >= 0)) &&
    Object.hasOwn(state, 'paused') && validPause;
}

export function createQlooRuntime({ rootDirectory = DEFAULT_ROOT, guardDirectory = resolve(rootDirectory, '.cache'),
  execFileImpl = runFile, now = Date.now, writeFileImpl = writeFile,
  pool = 'judge', dailyLimit } = {}) {
  const root = resolve(rootDirectory);
  const directory = resolve(guardDirectory);
  validateQlooPool(pool);
  const configuredDailyLimit = validateQlooDailyLimit(dailyLimit ??
    (pool === 'public' ? process.env.REELBALANCE_PUBLIC_QLOO_DAILY_LIMIT : process.env.REELBALANCE_QLOO_DAILY_LIMIT) ?? QLOO_POLICY.dailyAttempts);
  // The CLI guard owns reservations. The legacy judge ledger also retains the
  // shared timestamp and pause so existing provider state survives this split.
  if (execFileImpl === runFile && directory !== resolve(root, '.cache')) throw new TypeError('Live Qloo uses the established workspace guard directory.');
  if (typeof writeFileImpl !== 'function') throw new TypeError('Qloo runtime requires a file writer.');
  const sharedStatePath = resolve(directory, 'qloo-request-state.json');
  const statePath = pool === 'public' ? resolve(directory, 'qloo-public-request-state.json') : sharedStatePath;
  const guardLock = resolve(directory, 'qloo-request.lock');
  const runtimeLock = resolve(directory, 'qloo-runtime.lock');

  async function readState(path) {
    try {
      const bytes = await readFile(path);
      if (bytes.length > 16 * 1024) throw unavailable();
      const state = JSON.parse(bytes.toString('utf8'));
      if (!validQlooState(state)) throw unavailable();
      return state;
    } catch (error) { if (error.code === 'ENOENT') return emptyQlooState(); throw unavailable(); }
  }

  async function inspect(ignoreRuntimeLock = false) {
    const timestamp = now();
    const day = new Date(timestamp).toISOString().slice(0, 10);
    try {
      const shared = await readState(sharedStatePath);
      const state = pool === 'judge' ? shared : await readState(statePath);
      const requestsToday = state.day === day ? state.attempts : 0;
      const lastAttemptAt = Math.max(shared.lastAttemptAt ?? -Infinity, state.lastAttemptAt ?? -Infinity);
      const next = lastAttemptAt === -Infinity ? null : lastAttemptAt + QLOO_POLICY.minimumGapMs;
      const cooldownMs = next === null ? 0 : Math.max(0, next - timestamp);
      const busy = await exists(guardLock) || (!ignoreRuntimeLock && await exists(runtimeLock));
      const paused = Boolean(shared.paused || state.paused);
      return { pool, day, remainingRequests: Math.max(0, configuredDailyLimit - requestsToday), requestsToday, cooldownMs,
        nextAllowedAt: next === null ? null : new Date(next).toISOString(), paused, busy,
        pauseReason: paused ? 'A previous Qloo request failed. Review access before resuming.' : null,
        minimumGapMs: QLOO_POLICY.minimumGapMs, dailyAttemptLimit: configuredDailyLimit };
    } catch { throw unavailable(); }
  }

  async function pause() {
    try {
      await mkdir(directory, { recursive: true });
      await writeFileImpl(guardLock, '', { flag: 'wx', mode: 0o600 });
    } catch { return false; } // A lock owned by another operation is not ours to release or rely on after it finishes.
    let saved = false;
    try {
      const state = await readState(sharedStatePath);
      if (!state.paused) {
        state.paused = { at: new Date(now()).toISOString(), status: 'runtime_failure' };
        await writeFileImpl(sharedStatePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      }
      saved = true;
    } catch { /* Corrupt/unreadable state remains fail-closed. */ }
    finally {
      // Retain this already-created blocker when the pause could not be saved.
      // A restart or recovered filesystem must not silently resume provider calls.
      if (saved) await unlink(guardLock).catch(() => {});
    }
    return true; // Either a verified pause is saved, or this method's own guard lock remains.
  }

  function argumentsFor(intent) {
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) throw new TypeError('Invalid Qloo operation.');
    const prefix = ['--import', resolve(root, 'scripts/qloo-fetch-guard.mjs'), resolve(root, 'node_modules/@qloo/qloo-harness/dist/bin.js'), 'api'];
    if (intent.operation === 'search' && Object.keys(intent).length === 2 && typeof intent.query === 'string' &&
        intent.query.trim() && intent.query.length <= 80 && !/[\u0000-\u001f\u007f]/.test(intent.query)) {
      return [...prefix, 'search', '--query', intent.query, '--type', 'urn:entity:artist', '--take', '5', '--json'];
    }
    if (intent.operation === 'rank' && Object.keys(intent).length === 3 && typeof intent.artistId === 'string' && UUID.test(intent.artistId) &&
        Array.isArray(intent.filmIds) && intent.filmIds.length === 20 && intent.filmIds.every(id => typeof id === 'string' && UUID.test(id)) &&
        new Set(intent.filmIds.map(id => id.toUpperCase())).size === 20) {
      const query = { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': intent.artistId,
        'filter.results.entities': intent.filmIds.join(','), take: 20 };
      return [...prefix, 'insights', '--type', 'urn:entity:movie', '--params', JSON.stringify(query), '--json'];
    }
    throw new TypeError('Invalid Qloo operation.');
  }

  async function execute(intent, { beforeRequest } = {}) {
    if (beforeRequest !== undefined && typeof beforeRequest !== 'function') throw new TypeError('Qloo request hook must be a function.');
    const args = argumentsFor(intent);
    await mkdir(directory, { recursive: true });
    try { await writeFileImpl(runtimeLock, '', { flag: 'wx', mode: 0o600 }); }
    catch { throw new QlooRuntimeError('Another Qloo operation is active or unfinished. No request was sent.', { status: 409, code: 'qloo_busy' }); }
    let releaseRuntimeLock = true;
    try {
      const before = await inspect(true);
      if (before.paused) throw new QlooRuntimeError('Qloo access is paused after a previous error. Review access before resuming.', { code: 'qloo_paused' });
      if (before.busy) throw new QlooRuntimeError('Another Qloo request is active or unfinished. No request was sent.', { status: 409, code: 'qloo_busy' });
      if (before.cooldownMs) throw new QlooRuntimeError('Wait at least 60 seconds between Qloo requests. No request was sent.', { status: 409, code: 'qloo_cooldown' });
      if (!before.remainingRequests) throw new QlooRuntimeError(`The local ${configuredDailyLimit}-request daily budget has been reached. No request was sent.`, { status: 429, code: 'qloo_daily_limit' });
      // Access quotas reserve only when the operation is ready to spawn its
      // single CLI attempt. A rejected access reservation does not pause Qloo.
      if (beforeRequest) await beforeRequest();
      try {
        // No credential-bearing environment is copied. The harness alone reads its
        // existing private Qloo configuration; it never returns that configuration.
        const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'LANG', 'LC_ALL']
          .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
        Object.assign(env, { QLOO_BASE_URL: 'https://hackathon.api.qloo.com',
          QLOO_TRUSTED_BASE_URL: 'https://hackathon.api.qloo.com', CROSSCUE_QLOO_LIVE: '1',
          REELBALANCE_QLOO_POOL: pool, REELBALANCE_QLOO_DAILY_LIMIT: String(configuredDailyLimit) });
        if (pool === 'public') env.REELBALANCE_PUBLIC_QLOO_DAILY_LIMIT = String(configuredDailyLimit);
        const result = await execFileImpl(process.execPath, args, { cwd: root, env, timeout: 40_000, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' });
        const after = await inspect(true);
        const delta = after.day === before.day ? after.requestsToday - before.requestsToday : after.requestsToday;
        if (delta !== 1 || after.paused) throw unavailable();
        const entities = JSON.parse(result.stdout);
        if (!Array.isArray(entities)) throw unavailable();
        return { entities, fetchedAt: new Date(now()).toISOString(), qlooRequests: 1 };
      } catch {
        if (!await pause()) releaseRuntimeLock = false;
        throw new QlooRuntimeError('The Qloo operation failed or returned unusable data. Access is paused; no automatic retry will be made.', { code: 'qloo_operation_failed' });
      }
    } finally { if (releaseRuntimeLock) await unlink(runtimeLock).catch(() => {}); }
  }

  return { status: () => inspect(), execute, pause };
}
