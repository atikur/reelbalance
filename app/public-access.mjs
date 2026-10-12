import {
  closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUEST_COOKIE_NAME = '__Host-reelbalance_guest';
export const OWNER_COOKIE_NAME = '__Host-reelbalance_owner';
export const JUDGE_COOKIE_NAME = '__Host-reelbalance_judge';
export const GUEST_MAX_INTERACTIONS_PER_DAY = 4;
export const GUEST_MAX_DAILY_LIMIT = 60;
export const GUEST_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const OWNER_SESSION_LIFETIME_MS = 60 * 60 * 1000;
export const JUDGE_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const JUDGE_LOGIN_FAILURE_LIMIT = 8;
export const JUDGE_LOGIN_FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const INTERACTION_LEASE_MS = 120_000;
export const MAX_GUEST_SESSIONS = 256;
export const GUEST_SESSION_ISSUANCE_LIMIT = 32;
export const GUEST_SESSION_ISSUANCE_WINDOW_MS = 60_000;

const COOKIE_ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Strict';
const MAX_COOKIE_HEADER_BYTES = 8192;
const MAX_LEDGER_BYTES = 128 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export class AccessError extends Error {
  constructor(message, { status = 503, code = 'access_unavailable', retryAfterSeconds } = {}) {
    super(message);
    this.name = 'AccessError';
    this.status = status;
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

function unavailable() {
  return new AccessError('The saved access limits could not be verified. No provider interaction was started.');
}

function busy() {
  return new AccessError('Another provider interaction is in progress. Try again manually after it finishes.', { status: 409, code: 'access_busy' });
}

function ownerRequired() {
  return new AccessError('Owner sign-in is required for custom taste collection and private evidence.', { status: 401, code: 'owner_required' });
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, keys) {
  return plainObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function canonicalOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch {}
  if (typeof value !== 'string' || !parsed || parsed.protocol !== 'https:' || parsed.origin !== value ||
      parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new TypeError('Public access requires one exact canonical HTTPS APP_ORIGIN.');
  }
  return value;
}

function validOwnerToken(value) {
  if (typeof value !== 'string' || value.length > 256) return false;
  if (/^[a-fA-F0-9]{64,256}$/.test(value) && value.length % 2 === 0) return true;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return false;
  const normalized = value.replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_');
  const decoded = Buffer.from(normalized, 'base64url');
  return decoded.length >= 32 && decoded.toString('base64url') === normalized;
}

function tokenBytes(value) {
  return /^[a-fA-F0-9]{64,256}$/.test(value) && value.length % 2 === 0
    ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64url');
}

function hash(value) {
  return createHash('sha256').update(value).digest();
}

function parseCookie(header, name) {
  if (header === undefined || header === null || header === '') return null;
  if (typeof header !== 'string' || Buffer.byteLength(header, 'utf8') > MAX_COOKIE_HEADER_BYTES || /[\r\n\0]/.test(header)) return null;
  let found = null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    if (found !== null) return null;
    found = part.slice(separator + 1).trim();
  }
  return found;
}

function readJson(path, maxBytes) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const details = fstatSync(descriptor);
    if (!details.isFile() || details.size > maxBytes) throw unavailable();
    return JSON.parse(readFileSync(descriptor, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw unavailable();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

function readLedger(path, publicCustomAccess = false) {
  const ledger = readJson(path, MAX_LEDGER_BYTES);
  if (ledger === undefined) return { schemaVersion: publicCustomAccess ? 3 : 2, sessions: [], issuance: null };
  const legacy = ledger?.schemaVersion === 1 && exactKeys(ledger, ['schemaVersion', 'sessions']);
  const extended = ledger?.schemaVersion === 3;
  if (!(legacy || ([2, 3].includes(ledger?.schemaVersion) && exactKeys(ledger, ['schemaVersion', 'sessions', 'issuance']))) ||
      !Array.isArray(ledger.sessions) || ledger.sessions.length > MAX_GUEST_SESSIONS) throw unavailable();
  if (!legacy && ledger.issuance !== null &&
      (!exactKeys(ledger.issuance, ['startedAt', 'count']) || !validTimestamp(ledger.issuance.startedAt) ||
       !Number.isInteger(ledger.issuance.count) || ledger.issuance.count < 1 ||
       ledger.issuance.count > GUEST_SESSION_ISSUANCE_LIMIT)) throw unavailable();
  const seen = new Set();
  for (const session of ledger.sessions) {
    if (!exactKeys(session, ['idHash', 'createdAt', 'expiresAt', 'day', 'interactions', ...(extended ? ['qlooDay', 'qlooRequests'] : [])]) ||
        !HASH_PATTERN.test(session.idHash) || seen.has(session.idHash) || !validTimestamp(session.createdAt) ||
        session.expiresAt !== session.createdAt + GUEST_SESSION_LIFETIME_MS ||
        typeof session.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(session.day) ||
        !Number.isInteger(session.interactions) || session.interactions < 0 || session.interactions > GUEST_MAX_DAILY_LIMIT ||
        (extended && (typeof session.qlooDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(session.qlooDay) ||
          !Number.isInteger(session.qlooRequests) || session.qlooRequests < 0 || session.qlooRequests > GUEST_MAX_DAILY_LIMIT))) throw unavailable();
    seen.add(session.idHash);
  }
  // Preserve deployed guest cookies and attempt counts while upgrading on the next write.
  const normalized = legacy ? { schemaVersion: 2, sessions: ledger.sessions, issuance: null } : ledger;
  return publicCustomAccess && !extended ? { ...normalized, schemaVersion: 3,
    sessions: normalized.sessions.map(session => ({ ...session, qlooDay: session.day, qlooRequests: 0 })) } : normalized;
}

function readLease(path) {
  const lease = readJson(path, 1024);
  if (lease === undefined) return null;
  if (!exactKeys(lease, ['schemaVersion', 'leaseId', 'startedAt', 'expiresAt']) || lease.schemaVersion !== 1 ||
      !ID_PATTERN.test(lease.leaseId) || !validTimestamp(lease.startedAt) ||
      lease.expiresAt !== lease.startedAt + INTERACTION_LEASE_MS) throw unavailable();
  return lease;
}

function readJudgeLoginWindow(path) {
  const window = readJson(path, 1024);
  if (window === undefined) return null;
  if (!exactKeys(window, ['schemaVersion', 'startedAt', 'failures']) || window.schemaVersion !== 1 ||
      !validTimestamp(window.startedAt) || !Number.isInteger(window.failures) ||
      window.failures < 1 || window.failures > JUDGE_LOGIN_FAILURE_LIMIT) throw unavailable();
  return window;
}

/** Server-side access only. Provider budgets remain the responsibility of the existing provider services. */
export function createPublicAccess({
  mode = 'local', origin, ownerToken, judgeUsername = 'judge', judgePassword,
  publicCustomAccess = false, guestDailyLimit = GUEST_MAX_INTERACTIONS_PER_DAY, guestQlooDailyLimit = 12,
  ledgerPath = new URL('../.cache/access-ledger.json', import.meta.url),
  now = Date.now, randomBytesImpl = randomBytes,
} = {}) {
  if (!['local', 'public'].includes(mode)) throw new TypeError('Access mode must be local or public.');
  if (typeof publicCustomAccess !== 'boolean') throw new TypeError('Public custom access must be a boolean.');
  const limit = value => {
    if (typeof value === 'string' && /^[1-9]\d?$/.test(value)) value = Number(value);
    if (!Number.isInteger(value) || value < 1 || value > GUEST_MAX_DAILY_LIMIT) throw new TypeError('Guest daily limits must be integers from 1 to 60.');
    return value;
  };
  const guestLimit = limit(guestDailyLimit), guestQlooLimit = limit(guestQlooDailyLimit);
  const publicOrigin = mode === 'public' ? canonicalOrigin(origin) : null;
  if (ownerToken !== undefined && ownerToken !== null && ownerToken !== '' && !validOwnerToken(ownerToken)) {
    throw new TypeError('REELBALANCE_OWNER_TOKEN must represent at least 32 random bytes as hex or base64.');
  }
  const configuredToken = typeof ownerToken === 'string' && ownerToken !== '' ? ownerToken : null;
  const ownerDigest = configuredToken ? hash(configuredToken) : null;
  if (judgePassword !== undefined && judgePassword !== null && judgePassword !== '' && !validOwnerToken(judgePassword)) {
    throw new TypeError('REELBALANCE_JUDGE_PASSWORD must represent at least 32 random bytes as hex or base64.');
  }
  const configuredJudgePassword = typeof judgePassword === 'string' && judgePassword !== '' ? judgePassword : null;
  if (configuredJudgePassword && (typeof judgeUsername !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(judgeUsername))) {
    throw new TypeError('REELBALANCE_JUDGE_USERNAME must use 1–64 letters, numbers, dots, underscores or hyphens.');
  }
  const judgeDigest = configuredJudgePassword ? hash(configuredJudgePassword) : null;
  if (configuredToken && configuredJudgePassword) {
    const ownerBytes = tokenBytes(configuredToken), judgeBytes = tokenBytes(configuredJudgePassword);
    if (timingSafeEqual(ownerDigest, judgeDigest) ||
        (ownerBytes.length === judgeBytes.length && timingSafeEqual(ownerBytes, judgeBytes))) {
      throw new TypeError('The judge password must be different from REELBALANCE_OWNER_TOKEN.');
    }
  }
  const judgeUsernameDigest = configuredJudgePassword ? hash(judgeUsername) : null;
  const path = ledgerPath instanceof URL ? fileURLToPath(ledgerPath) : resolve(ledgerPath);
  const lockPath = `${path}.lock`;
  const leasePath = `${path}.interaction`;
  const judgeLoginPath = `${path}.judge-login`;
  let temporarySequence = 0;

  function timestamp() {
    const value = now();
    if (!validTimestamp(value)) throw unavailable();
    return value;
  }

  function randomId() {
    const value = randomBytesImpl(32);
    if (!Buffer.isBuffer(value) || value.length !== 32) throw unavailable();
    return value.toString('base64url');
  }

  function withLock(action) {
    let descriptor;
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      try { descriptor = openSync(lockPath, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') throw busy(); throw error; }
      return action();
    } catch (error) {
      if (error instanceof AccessError) throw error;
      throw unavailable();
    } finally {
      if (descriptor !== undefined) {
        try { closeSync(descriptor); } catch {}
        try { unlinkSync(lockPath); } catch {}
      }
    }
  }

  function saveJson(target, value) {
    // This nonce coordinates atomic writes; it is never an authentication token.
    const temporary = `${target}.${process.pid}.${++temporarySequence}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
      renameSync(temporary, target);
    } finally {
      try { unlinkSync(temporary); } catch {}
    }
  }

  function utcDay(at) { return new Date(at).toISOString().slice(0, 10); }

  function guestRecord(cookieHeader, ledger, at) {
    const raw = parseCookie(cookieHeader, GUEST_COOKIE_NAME);
    if (!raw || !ID_PATTERN.test(raw) || Buffer.from(raw, 'base64url').toString('base64url') !== raw) return null;
    const idHash = hash(raw).toString('hex');
    return ledger.sessions.find(session => session.idHash === idHash && session.createdAt <= at && session.expiresAt > at) ?? null;
  }

  function remaining(session, at) {
    return Math.max(0, guestLimit - (session.day === utcDay(at) ? session.interactions : 0));
  }

  function qlooRemaining(session, at) {
    return Math.max(0, guestQlooLimit - (session.qlooDay === utcDay(at) ? session.qlooRequests ?? 0 : 0));
  }

  function guestMetadata(session, at) {
    return { guestMaxInteractionsPerDay: guestLimit, guestRemainingInteractions: session ? remaining(session, at) : null,
      ...(publicCustomAccess ? { publicCustomAccess: true, guestMaxQlooRequestsPerDay: guestQlooLimit,
        guestRemainingQlooRequests: session ? qlooRemaining(session, at) : null } : {}) };
  }

  function validBearer(authorization) {
    if (!ownerDigest || typeof authorization !== 'string' || authorization.length > 512 || !authorization.startsWith('Bearer ')) return false;
    const candidate = authorization.slice(7);
    if (!candidate || /\s/.test(candidate)) return false;
    return timingSafeEqual(ownerDigest, hash(candidate));
  }

  function signature(payload) {
    return createHmac('sha256', configuredToken).update(`${publicOrigin}\n${OWNER_COOKIE_NAME}\n${payload}`).digest();
  }

  function validOwnerCookie(cookieHeader, at) {
    if (!configuredToken) return false;
    const raw = parseCookie(cookieHeader, OWNER_COOKIE_NAME);
    if (!raw || raw.length > 512) return false;
    const parts = raw.split('.');
    if (parts.length !== 2 || !ID_PATTERN.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[0])) return false;
    try {
      const suppliedSignature = Buffer.from(parts[1], 'base64url');
      if (suppliedSignature.length !== 32 || suppliedSignature.toString('base64url') !== parts[1] ||
          !timingSafeEqual(signature(parts[0]), suppliedSignature)) return false;
      const payloadBytes = Buffer.from(parts[0], 'base64url');
      if (payloadBytes.toString('base64url') !== parts[0]) return false;
      const payload = JSON.parse(payloadBytes.toString('utf8'));
      return exactKeys(payload, ['v', 'issuedAt', 'expiresAt', 'nonce']) && payload.v === 1 &&
        validTimestamp(payload.issuedAt) && payload.issuedAt <= at &&
        payload.expiresAt === payload.issuedAt + OWNER_SESSION_LIFETIME_MS && payload.expiresAt > at && ID_PATTERN.test(payload.nonce);
    } catch { return false; }
  }

  function isOwner({ authorization, cookieHeader } = {}, at = timestamp()) {
    return mode === 'local' || validBearer(authorization) || validOwnerCookie(cookieHeader, at);
  }

  function judgeSignature(payload) {
    return createHmac('sha256', configuredJudgePassword)
      .update(`${publicOrigin}\n${JUDGE_COOKIE_NAME}\njudge\n${judgeUsername}\n${payload}`).digest();
  }

  function validJudgeCookie(cookieHeader, at) {
    if (!configuredJudgePassword) return false;
    const raw = parseCookie(cookieHeader, JUDGE_COOKIE_NAME);
    if (!raw || raw.length > 512) return false;
    const parts = raw.split('.');
    if (parts.length !== 2 || !ID_PATTERN.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[0])) return false;
    try {
      const suppliedSignature = Buffer.from(parts[1], 'base64url');
      if (suppliedSignature.length !== 32 || suppliedSignature.toString('base64url') !== parts[1] ||
          !timingSafeEqual(judgeSignature(parts[0]), suppliedSignature)) return false;
      const payloadBytes = Buffer.from(parts[0], 'base64url');
      if (payloadBytes.toString('base64url') !== parts[0]) return false;
      const payload = JSON.parse(payloadBytes.toString('utf8'));
      return exactKeys(payload, ['v', 'role', 'issuedAt', 'expiresAt', 'nonce']) && payload.v === 1 && payload.role === 'judge' &&
        validTimestamp(payload.issuedAt) && payload.issuedAt <= at &&
        payload.expiresAt === payload.issuedAt + JUDGE_SESSION_LIFETIME_MS && payload.expiresAt > at && ID_PATTERN.test(payload.nonce);
    } catch { return false; }
  }

  function accessRole(credentials = {}, at = timestamp()) {
    if (isOwner(credentials, at)) return 'owner';
    return validJudgeCookie(credentials.cookieHeader, at) ? 'judge' : 'guest';
  }

  function role(credentials = {}) { return accessRole(credentials); }

  function requireOrigin(originHeader) {
    if (mode === 'local') return true;
    if (typeof originHeader !== 'string' || originHeader !== publicOrigin) {
      throw new AccessError('Use this application’s exact HTTPS origin for provider actions.', { status: 403, code: 'origin_not_allowed' });
    }
    return true;
  }

  function requireOwner(credentials = {}) {
    if (mode === 'public' && credentials.originHeader !== undefined) requireOrigin(credentials.originHeader);
    if (!isOwner(credentials)) throw ownerRequired();
    return true;
  }

  function requireCustomAccess(credentials = {}) {
    if (mode === 'public' && credentials.originHeader !== undefined) requireOrigin(credentials.originHeader);
    if (accessRole(credentials) === 'guest') {
      if (publicCustomAccess) {
        const at = timestamp();
        if (!guestRecord(credentials.cookieHeader, readLedger(path, publicCustomAccess), at)) {
          throw new AccessError('Open the application or check availability to receive a browser session. Your programme is kept.', {
            status: 401, code: 'access_session_required',
          });
        }
        return true;
      }
      throw new AccessError('Judge or organiser sign-in is required to use custom artists and their evidence.', {
        status: 401, code: 'custom_access_required',
      });
    }
    return true;
  }

  function ownerCookie({ authorization, originHeader } = {}) {
    requireOrigin(originHeader);
    if (mode !== 'public' || !configuredToken) {
      throw new AccessError('Owner sign-in is not configured on this server.', { status: 503, code: 'owner_not_configured' });
    }
    if (!validBearer(authorization)) throw ownerRequired();
    const at = timestamp();
    const payload = Buffer.from(JSON.stringify({ v: 1, issuedAt: at, expiresAt: at + OWNER_SESSION_LIFETIME_MS, nonce: randomId() })).toString('base64url');
    return `${OWNER_COOKIE_NAME}=${payload}.${signature(payload).toString('base64url')}; ${COOKIE_ATTRIBUTES}; Max-Age=3600`;
  }

  function logoutOwnerCookie() {
    return `${OWNER_COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
  }

  function judgeCookie({ username, password, originHeader } = {}) {
    requireOrigin(originHeader);
    if (mode !== 'public' || !configuredJudgePassword) {
      throw new AccessError('Judge sign-in is not configured on this server.', { status: 503, code: 'judge_not_configured' });
    }
    const at = timestamp();
    const validUsername = timingSafeEqual(judgeUsernameDigest, hash(typeof username === 'string' && username.length <= 64 ? username : ''));
    const validPassword = timingSafeEqual(judgeDigest, hash(typeof password === 'string' && password.length <= 256 ? password : ''));
    return withLock(() => {
      const saved = readJudgeLoginWindow(judgeLoginPath);
      if (saved && at < saved.startedAt) throw unavailable();
      const active = saved && at < saved.startedAt + JUDGE_LOGIN_FAILURE_WINDOW_MS ? saved : null;
      // A public failed-login window must never lock out a judge who supplies
      // the correct high-entropy credentials. Only rejected guesses are throttled.
      if (active && active.failures >= JUDGE_LOGIN_FAILURE_LIMIT && (!validUsername || !validPassword)) {
        throw new AccessError('Judge sign-in is temporarily limited after unsuccessful attempts. Try again shortly.', {
          status: 429, code: 'judge_login_rate_limit',
          retryAfterSeconds: Math.ceil((active.startedAt + JUDGE_LOGIN_FAILURE_WINDOW_MS - at) / 1000),
        });
      }
      if (!validUsername || !validPassword) {
        saveJson(judgeLoginPath, { schemaVersion: 1, startedAt: active?.startedAt ?? at, failures: (active?.failures ?? 0) + 1 });
        throw new AccessError('The judge username or password was not accepted.', { status: 401, code: 'judge_login_invalid' });
      }
      const payload = Buffer.from(JSON.stringify({ v: 1, role: 'judge', issuedAt: at,
        expiresAt: at + JUDGE_SESSION_LIFETIME_MS, nonce: randomId() })).toString('base64url');
      if (saved) unlinkSync(judgeLoginPath);
      return `${JUDGE_COOKIE_NAME}=${payload}.${judgeSignature(payload).toString('base64url')}; ${COOKIE_ATTRIBUTES}; Max-Age=86400`;
    });
  }

  function logoutJudgeCookie() {
    return `${JUDGE_COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
  }

  async function status(credentials = {}) {
    const at = timestamp();
    const ownerAuthenticated = isOwner(credentials, at);
    const guest = mode === 'public' && parseCookie(credentials.cookieHeader, GUEST_COOKIE_NAME)
      ? guestRecord(credentials.cookieHeader, readLedger(path, publicCustomAccess), at) : null;
    return {
      mode, ownerAuthenticated, ownerSignInAvailable: mode === 'public' && Boolean(configuredToken),
      judgeAuthenticated: mode === 'public' && validJudgeCookie(credentials.cookieHeader, at),
      judgeSignInAvailable: mode === 'public' && Boolean(configuredJudgePassword),
      ...guestMetadata(guest, at),
    };
  }

  async function guestSession({ cookieHeader } = {}) {
    if (mode === 'local') return guestMetadata(null, timestamp());
    const at = timestamp();
    return withLock(() => {
      const ledger = readLedger(path, publicCustomAccess);
      const existing = guestRecord(cookieHeader, ledger, at);
      if (existing) return { ...guestMetadata(existing, at), expiresAt: new Date(existing.expiresAt).toISOString() };
      const issuance = ledger.issuance;
      if (issuance && at < issuance.startedAt) throw unavailable();
      if (issuance && at < issuance.startedAt + GUEST_SESSION_ISSUANCE_WINDOW_MS &&
          issuance.count >= GUEST_SESSION_ISSUANCE_LIMIT) {
        throw new AccessError('New guest sessions are temporarily limited. Try again shortly; existing sessions, recorded demos and manual planning remain available.', {
          status: 429, code: 'access_session_rate_limit',
          retryAfterSeconds: Math.ceil((issuance.startedAt + GUEST_SESSION_ISSUANCE_WINDOW_MS - at) / 1000),
        });
      }
      ledger.sessions = ledger.sessions.filter(session => session.expiresAt > at);
      if (ledger.sessions.length >= MAX_GUEST_SESSIONS) {
        // A cookie issued to a client that never started an interaction must not reserve
        // capacity for 24 hours. Used records retain their complete attempt history.
        const unused = ledger.sessions.reduce((oldest, session) => session.interactions === 0 && (session.qlooRequests ?? 0) === 0 &&
          (!oldest || session.createdAt < oldest.createdAt) ? session : oldest, null);
        if (!unused) throw new AccessError('The server’s guest-session capacity is full. The recorded demo and local planning remain available.', { status: 503, code: 'access_session_limit' });
        ledger.sessions = ledger.sessions.filter(session => session !== unused);
      }
      const raw = randomId();
      const idHash = hash(raw).toString('hex');
      if (ledger.sessions.some(session => session.idHash === idHash)) throw unavailable();
      const session = { idHash, createdAt: at, expiresAt: at + GUEST_SESSION_LIFETIME_MS, day: utcDay(at), interactions: 0,
        ...(ledger.schemaVersion === 3 ? { qlooDay: utcDay(at), qlooRequests: 0 } : {}) };
      ledger.sessions.push(session);
      ledger.issuance = issuance && at < issuance.startedAt + GUEST_SESSION_ISSUANCE_WINDOW_MS
        ? { ...issuance, count: issuance.count + 1 } : { startedAt: at, count: 1 };
      saveJson(path, ledger);
      return {
        setCookie: `${GUEST_COOKIE_NAME}=${raw}; ${COOKIE_ATTRIBUTES}; Max-Age=86400`,
        ...guestMetadata(session, at),
        expiresAt: new Date(at + GUEST_SESSION_LIFETIME_MS).toISOString(),
      };
    });
  }

  async function beginGuestInteraction({ cookieHeader, authorization, originHeader, kind = 'openai', count = true } = {}) {
    if (!['openai', 'qloo'].includes(kind) || typeof count !== 'boolean') throw new TypeError('Use a supported provider interaction.');
    requireOrigin(originHeader);
    if (mode === 'local') return { role: 'owner', remainingInteractions: null,
      maxInteractionsPerDay: guestLimit, finish: async () => {} };
    const at = timestamp();
    const authenticatedRole = accessRole({ cookieHeader, authorization }, at);
    const grant = withLock(() => {
      const ledger = readLedger(path, publicCustomAccess);
      const guest = authenticatedRole === 'guest' ? guestRecord(cookieHeader, ledger, at) : null;
      if (authenticatedRole === 'guest' && !guest) {
        throw new AccessError('Open the application to receive a guest session before starting the assistant.', { status: 401, code: 'guest_session_required' });
      }
      if (guest && kind === 'openai' && count && remaining(guest, at) === 0) {
        throw new AccessError(`This browser has reached its ${guestLimit} assistant interactions for this UTC day. Manual planning remains available.`, { status: 429, code: 'guest_limit_reached' });
      }
      if (guest && kind === 'qloo' && count) {
        throw new TypeError('Reserve fresh Qloo attempts at provider admission, separately from the interaction lease.');
      }
      const previous = readLease(leasePath);
      if (previous && previous.expiresAt > at) throw busy();
      const leaseId = randomId();
      // Reserve before returning permission to invoke a provider; failures still count as attempts.
      saveJson(leasePath, { schemaVersion: 1, leaseId, startedAt: at, expiresAt: at + INTERACTION_LEASE_MS });
      if (guest && count) {
        guest.interactions = guest.day === utcDay(at) ? guest.interactions + 1 : 1;
        guest.day = utcDay(at);
        saveJson(path, ledger);
      }
      return { leaseId, remainingInteractions: guest ? remaining(guest, at) : null };
    });
    let finished = false;
    return {
      role: authenticatedRole, remainingInteractions: grant.remainingInteractions,
      maxInteractionsPerDay: guestLimit,
      finish: async () => {
        if (finished) return;
        withLock(() => {
          const current = readLease(leasePath);
          if (current?.leaseId === grant.leaseId) unlinkSync(leasePath);
        });
        finished = true;
      },
    };
  }

  async function reserveGuestQlooRequest({ cookieHeader, authorization, originHeader } = {}) {
    requireOrigin(originHeader);
    if (accessRole({ cookieHeader, authorization }) !== 'guest') return { remainingRequests: null };
    if (!publicCustomAccess) throw new AccessError('Public artist collection is disabled.', { status: 401, code: 'custom_access_required' });
    const at = timestamp();
    return withLock(() => {
      const ledger = readLedger(path, true), guest = guestRecord(cookieHeader, ledger, at);
      if (!guest) throw new AccessError('Open the application to receive a browser session.', { status: 401, code: 'access_session_required' });
      if (qlooRemaining(guest, at) === 0) throw new AccessError(`This browser has reached its ${guestQlooLimit} fresh Qloo requests for this UTC day. Saved artist evidence remains available.`, {
        status: 429, code: 'guest_qloo_limit_reached',
      });
      guest.qlooRequests = guest.qlooDay === utcDay(at) ? guest.qlooRequests + 1 : 1;
      guest.qlooDay = utcDay(at);
      saveJson(path, ledger);
      return { remainingRequests: qlooRemaining(guest, at) };
    });
  }

  return { status, guestSession, requireOwner, requireCustomAccess, requireOrigin, role,
    ownerCookie, logoutOwnerCookie, judgeCookie, logoutJudgeCookie, beginGuestInteraction, reserveGuestQlooRequest };
}
