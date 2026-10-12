import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AccessError, createPublicAccess, GUEST_COOKIE_NAME, OWNER_COOKIE_NAME, JUDGE_COOKIE_NAME,
  GUEST_SESSION_LIFETIME_MS, OWNER_SESSION_LIFETIME_MS, INTERACTION_LEASE_MS, MAX_GUEST_SESSIONS,
  GUEST_SESSION_ISSUANCE_LIMIT, GUEST_SESSION_ISSUANCE_WINDOW_MS,
  JUDGE_SESSION_LIFETIME_MS, JUDGE_LOGIN_FAILURE_LIMIT, JUDGE_LOGIN_FAILURE_WINDOW_MS,
} from './public-access.mjs';

const ORIGIN = 'https://judges.example.test';
const OWNER_TOKEN = 'mock-owner-authentication-bytes-32-plus'.repeat(2);
// Test fixtures only. No production credentials or random secrets are created by this suite.
const TOKEN = Buffer.from(OWNER_TOKEN).toString('base64url');
const JUDGE_PASSWORD = Buffer.from('test-only-judge-password-at-least-thirty-two-bytes').toString('base64url');
const JUDGE_USERNAME = 'test-judge';
const cookieHeader = setCookie => setCookie.split(';')[0];
const errorIs = (code, status) => error => error instanceof AccessError && error.code === code && error.status === status;
const execFileAsync = promisify(execFile);

test('public custom limits are configurable and invalid values fail closed', () => {
  const options = { mode: 'public', origin: ORIGIN, publicCustomAccess: true, guestDailyLimit: '24', guestQlooDailyLimit: '12' };
  assert.doesNotThrow(() => createPublicAccess(options));
  for (const value of [0, 61, '24.5', '-1', {}, true]) {
    assert.throws(() => createPublicAccess({ ...options, guestDailyLimit: value }), TypeError);
    assert.throws(() => createPublicAccess({ ...options, guestQlooDailyLimit: value }), TypeError);
  }
  assert.throws(() => createPublicAccess({ ...options, publicCustomAccess: '1' }), TypeError);
});

async function setup(t, overrides = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'reelbalance-access-'));
  const ledgerPath = resolve(directory, 'private', 'access.json');
  let at = Date.parse('2030-01-01T12:00:00.000Z');
  let sequence = 0;
  const randomBytesImpl = size => createHash('sha256').update(`test-only-id-${++sequence}`).digest().subarray(0, size);
  const options = { mode: 'public', origin: ORIGIN, ownerToken: TOKEN, ledgerPath, now: () => at, randomBytesImpl, ...overrides };
  const service = createPublicAccess(options);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { service, options, directory, ledgerPath, advance: ms => { at += ms; },
    time: () => at, recreate: () => createPublicAccess(options) };
}

async function guest(service) {
  const issued = await service.guestSession();
  return { ...issued, cookie: cookieHeader(issued.setCookie) };
}

test('public configuration accepts only a canonical HTTPS origin and sufficiently long encoded owner token', () => {
  for (const origin of [undefined, 'http://localhost:4173', 'https://example.test/', 'https://example.test/path',
    'https://example.test?x=y', 'https://user:pass@example.test', 'https://EXAMPLE.test', ['https://example.test']]) {
    assert.throws(() => createPublicAccess({ mode: 'public', origin }), /HTTPS APP_ORIGIN/);
  }
  for (const ownerToken of ['short', 'f'.repeat(62), 'a'.repeat(257), 'contains spaces'.repeat(5), {}]) {
    assert.throws(() => createPublicAccess({ mode: 'public', origin: ORIGIN, ownerToken }), /at least 32 random bytes/);
  }
  assert.doesNotThrow(() => createPublicAccess({ mode: 'public', origin: ORIGIN, ownerToken: 'f'.repeat(64) }));
  assert.doesNotThrow(() => createPublicAccess({ mode: 'public', origin: ORIGIN, ownerToken: Buffer.alloc(32, 1).toString('base64') }));
  assert.doesNotThrow(() => createPublicAccess({ mode: 'public', origin: ORIGIN }));
  assert.throws(() => createPublicAccess({ mode: 'proxy' }), /local or public/);
});

test('local mode retains explicit owner authority without reading or writing a ledger', async t => {
  const example = await setup(t, { mode: 'local', ownerToken: undefined });
  assert.equal(example.service.requireOwner(), true);
  const state = await example.service.status();
  assert.equal(state.ownerAuthenticated, true);
  assert.equal(state.ownerSignInAvailable, false);
  assert.equal(state.guestRemainingInteractions, null);
  assert.equal((await example.service.guestSession()).setCookie, undefined);
  const grant = await example.service.beginGuestInteraction();
  assert.equal(grant.role, 'owner');
  await grant.finish();
  assert.deepEqual(await readdir(example.directory), []);
});

test('public owner authorization never trusts loopback, forwarded headers, or a missing token', async t => {
  const { service } = await setup(t);
  for (const credentials of [undefined, { remoteAddress: '127.0.0.1' },
    { remoteAddress: '::1', authorization: 'Bearer wrong', forwarded: '127.0.0.1' },
    { authorization: `Basic ${TOKEN}` }, { authorization: `Bearer ${TOKEN}\n` },
    { cookieHeader: `${OWNER_COOKIE_NAME}=forged`, 'x-forwarded-for': '127.0.0.1' }]) {
    assert.throws(() => service.requireOwner(credentials), errorIs('owner_required', 401));
  }
  assert.equal(service.requireOwner({ authorization: `Bearer ${TOKEN}` }), true);
  assert.throws(() => service.requireOwner({ authorization: `Bearer ${TOKEN}`, originHeader: 'https://evil.example' }), errorIs('origin_not_allowed', 403));
  const disabled = createPublicAccess({ mode: 'public', origin: ORIGIN, ownerToken: undefined });
  assert.equal((await disabled.status()).ownerSignInAvailable, false);
  assert.throws(() => disabled.requireOwner({ authorization: `Bearer ${TOKEN}` }), errorIs('owner_required', 401));
  assert.throws(() => disabled.ownerCookie({ authorization: `Bearer ${TOKEN}`, originHeader: ORIGIN }), errorIs('owner_not_configured', 503));
});

test('every public provider interaction requires the exact origin and an existing guest session', async t => {
  const { service, directory } = await setup(t);
  for (const originHeader of [undefined, 'null', 'http://judges.example.test', `${ORIGIN}/`,
    'https://evil.example', [ORIGIN], `${ORIGIN}, https://evil.example`]) {
    assert.throws(() => service.requireOrigin(originHeader), errorIs('origin_not_allowed', 403));
    await assert.rejects(service.beginGuestInteraction({ authorization: `Bearer ${TOKEN}`, originHeader }), errorIs('origin_not_allowed', 403));
  }
  await assert.rejects(service.beginGuestInteraction({ originHeader: ORIGIN }), errorIs('guest_session_required', 401));
  assert.deepEqual(await readdir(resolve(directory, 'private')), [], 'A failed POST creates no guest or attempt ledger.');
});

test('guest cookies are secure, expire after 24 hours, and only hashes enter a private ledger', async t => {
  const example = await setup(t);
  const issued = await guest(example.service);
  assert.match(issued.setCookie, /^__Host-reelbalance_guest=[A-Za-z0-9_-]{43}; /);
  assert.match(issued.setCookie, /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400$/);
  assert.equal(issued.guestRemainingInteractions, 4);
  const bytes = await readFile(example.ledgerPath, 'utf8');
  const before = await stat(example.ledgerPath);
  assert.equal(before.mode & 0o777, 0o600);
  assert.ok(!bytes.includes(issued.cookie.split('=')[1]));
  assert.ok(!bytes.includes(TOKEN));
  assert.deepEqual(Object.keys(JSON.parse(bytes).sessions[0]), ['idHash', 'createdAt', 'expiresAt', 'day', 'interactions']);
  const snapshot = await example.service.status({ cookieHeader: issued.cookie });
  assert.deepEqual(snapshot, { mode: 'public', ownerAuthenticated: false, ownerSignInAvailable: true,
    judgeAuthenticated: false, judgeSignInAvailable: false,
    guestMaxInteractionsPerDay: 4, guestRemainingInteractions: 4 });
  assert.equal(await readFile(example.ledgerPath, 'utf8'), bytes, 'Status is read-only.');
  assert.equal((await example.service.guestSession({ cookieHeader: issued.cookie })).setCookie, undefined);
  assert.equal(await readFile(example.ledgerPath, 'utf8'), bytes, 'Reusing a session does not rewrite it.');
  example.advance(GUEST_SESSION_LIFETIME_MS);
  assert.equal((await example.service.status({ cookieHeader: issued.cookie })).guestRemainingInteractions, null);
  await assert.rejects(example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN }), errorIs('guest_session_required', 401));
  const replacement = await example.service.guestSession({ cookieHeader: issued.cookie });
  assert.ok(replacement.setCookie);
  assert.equal(JSON.parse(await readFile(example.ledgerPath, 'utf8')).sessions.length, 1);
});

test('guest attempts persist across service recreation, reject a fifth attempt, and reset only on the UTC day', async t => {
  const example = await setup(t);
  const issued = await guest(example.service);
  for (let index = 0; index < 4; index++) {
    const service = example.recreate();
    const grant = await service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
    assert.equal(grant.remainingInteractions, 3 - index);
    await grant.finish();
    await grant.finish();
  }
  assert.equal((await example.recreate().status({ cookieHeader: issued.cookie })).guestRemainingInteractions, 0);
  await assert.rejects(example.recreate().beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN }), errorIs('guest_limit_reached', 429));
  example.advance(12 * 60 * 60 * 1000);
  assert.equal((await example.service.status({ cookieHeader: issued.cookie })).guestRemainingInteractions, 4);
  const fresh = await example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
  assert.equal(fresh.remainingInteractions, 3);
  await fresh.finish();
});

test('a held global lease rejects concurrent guests and owner calls without consuming rejected guest attempts', async t => {
  const example = await setup(t);
  const first = await guest(example.service);
  const second = await guest(example.service);
  const held = await example.service.beginGuestInteraction({ cookieHeader: first.cookie, originHeader: ORIGIN });
  const results = await Promise.allSettled([
    example.recreate().beginGuestInteraction({ cookieHeader: second.cookie, originHeader: ORIGIN }),
    example.recreate().beginGuestInteraction({ authorization: `Bearer ${TOKEN}`, originHeader: ORIGIN }),
  ]);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.code, 'access_busy');
  }
  assert.equal((await example.service.status({ cookieHeader: second.cookie })).guestRemainingInteractions, 4);
  await held.finish();
  const available = await example.recreate().beginGuestInteraction({ cookieHeader: second.cookie, originHeader: ORIGIN });
  assert.equal(available.remainingInteractions, 3);
  await available.finish();
});

test('independent Node processes observe the same lease and persisted guest attempts', async t => {
  const example = await setup(t);
  const issued = await guest(example.service);
  const held = await example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
  const moduleUrl = new URL('./public-access.mjs', import.meta.url).href;
  const invoke = () => execFileAsync(process.execPath, ['--input-type=module', '-e', `
    import { createPublicAccess } from ${JSON.stringify(moduleUrl)};
    const service = createPublicAccess({ mode: 'public', origin: ${JSON.stringify(ORIGIN)}, ledgerPath: ${JSON.stringify(example.ledgerPath)},
      now: () => ${example.time()}, randomBytesImpl: n => Buffer.alloc(n, 91) });
    try {
      const grant = await service.beginGuestInteraction({ cookieHeader: ${JSON.stringify(issued.cookie)}, originHeader: ${JSON.stringify(ORIGIN)} });
      await grant.finish(); console.log(JSON.stringify({ remaining: grant.remainingInteractions }));
    } catch (error) { console.log(JSON.stringify({ code: error.code, status: error.status })); }
  `]);
  assert.deepEqual(JSON.parse((await invoke()).stdout), { code: 'access_busy', status: 409 });
  await held.finish();
  assert.deepEqual(JSON.parse((await invoke()).stdout), { remaining: 2 });
  assert.equal((await example.service.status({ cookieHeader: issued.cookie })).guestRemainingInteractions, 2);
});

test('an expired crash lease can recover, and an old finish cannot release a newer interaction', async t => {
  const example = await setup(t);
  const issued = await guest(example.service);
  const old = await example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
  example.advance(INTERACTION_LEASE_MS);
  const newer = await example.recreate().beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
  await old.finish();
  await assert.rejects(example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN }), errorIs('access_busy', 409));
  await newer.finish();
  const next = await example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
  assert.equal(next.remainingInteractions, 1);
  await next.finish();
});

test('owner cookies are signed, origin-bound, expiring, and never persisted', async t => {
  const example = await setup(t);
  assert.throws(() => example.service.ownerCookie({ authorization: `Bearer ${TOKEN}`, originHeader: 'https://evil.example' }), errorIs('origin_not_allowed', 403));
  assert.throws(() => example.service.ownerCookie({ authorization: 'Bearer wrong', originHeader: ORIGIN }), errorIs('owner_required', 401));
  const signed = example.service.ownerCookie({ authorization: `Bearer ${TOKEN}`, originHeader: ORIGIN });
  const cookie = cookieHeader(signed);
  assert.match(signed, /^__Host-reelbalance_owner=[A-Za-z0-9_.-]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600$/);
  assert.equal(example.service.requireOwner({ cookieHeader: cookie }), true);
  assert.equal((await example.recreate().status({ cookieHeader: cookie })).ownerAuthenticated, true);
  assert.deepEqual(await readdir(example.directory), [], 'Owner credentials create no disk records.');
  const value = cookie.split('=')[1];
  const [payload, signature] = value.split('.');
  const alteredPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), expiresAt: example.time() + 2 * OWNER_SESSION_LIFETIME_MS })).toString('base64url');
  for (const tampered of [`${OWNER_COOKIE_NAME}=${alteredPayload}.${signature}`,
    `${OWNER_COOKIE_NAME}=${payload}.${'a'.repeat(43)}`, `${cookie}; ${cookie}`, `${OWNER_COOKIE_NAME}=../../secret`]) {
    assert.throws(() => example.service.requireOwner({ cookieHeader: tampered }), errorIs('owner_required', 401));
  }
  const otherOrigin = createPublicAccess({ ...example.options, origin: 'https://another.example.test' });
  assert.throws(() => otherOrigin.requireOwner({ cookieHeader: cookie }), errorIs('owner_required', 401));
  assert.match(example.service.logoutOwnerCookie(), /Max-Age=0$/);
  example.advance(OWNER_SESSION_LIFETIME_MS);
  assert.equal((await example.service.status({ cookieHeader: cookie })).ownerAuthenticated, false);
  assert.throws(() => example.service.requireOwner({ cookieHeader: cookie }), errorIs('owner_required', 401));
});

test('owner bypasses only the guest cap and is still subject to the global interaction lease', async t => {
  const example = await setup(t);
  const cookie = cookieHeader(example.service.ownerCookie({ authorization: `Bearer ${TOKEN}`, originHeader: ORIGIN }));
  for (let index = 0; index < 6; index++) {
    const grant = await example.service.beginGuestInteraction({ cookieHeader: cookie, originHeader: ORIGIN });
    assert.equal(grant.role, 'owner');
    assert.equal(grant.remainingInteractions, null);
    await assert.rejects(example.recreate().beginGuestInteraction({ cookieHeader: cookie, originHeader: ORIGIN }), errorIs('access_busy', 409));
    await grant.finish();
  }
  const contents = await readdir(resolve(example.directory, 'private'));
  assert.deepEqual(contents, [], 'No raw owner token or cookie is written to a ledger.');
});

test('judge credentials are optional, high entropy, separately configured and different from the owner secret', async () => {
  const options = { mode: 'public', origin: ORIGIN, ownerToken: TOKEN };
  for (const judgePassword of ['short', 'f'.repeat(62), 'a'.repeat(257), {}, 'has spaces'.repeat(6)]) {
    assert.throws(() => createPublicAccess({ ...options, judgePassword }), /JUDGE_PASSWORD/);
  }
  for (const judgeUsername of ['', 'judge name', '\njudge', 'a'.repeat(65), {}]) {
    assert.throws(() => createPublicAccess({ ...options, judgePassword: JUDGE_PASSWORD, judgeUsername }), /JUDGE_USERNAME/);
  }
  assert.throws(() => createPublicAccess({ ...options, judgePassword: TOKEN }), /different/);
  assert.throws(() => createPublicAccess({ ...options, judgePassword: Buffer.from(TOKEN, 'base64url').toString('hex') }), /different/);
  assert.doesNotThrow(() => createPublicAccess({ ...options, judgePassword: JUDGE_PASSWORD }));
  const disabled = createPublicAccess(options);
  assert.equal((await disabled.status()).judgeSignInAvailable, false);
  assert.throws(() => disabled.judgeCookie({ username: 'judge', password: JUDGE_PASSWORD, originHeader: ORIGIN }), errorIs('judge_not_configured', 503));
});

test('judge sign-in grants only custom access and never owner or bearer authority', async t => {
  const example = await setup(t, { judgeUsername: JUDGE_USERNAME, judgePassword: JUDGE_PASSWORD });
  const signed = example.service.judgeCookie({ username: JUDGE_USERNAME, password: JUDGE_PASSWORD, originHeader: ORIGIN });
  const cookie = cookieHeader(signed);
  assert.match(signed, /^__Host-reelbalance_judge=[A-Za-z0-9_.-]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400$/);
  assert.equal(example.service.role({ cookieHeader: cookie }), 'judge');
  assert.equal(example.service.requireCustomAccess({ cookieHeader: cookie }), true);
  assert.throws(() => example.service.requireOwner({ cookieHeader: cookie }), errorIs('owner_required', 401));
  assert.equal(example.service.role({ authorization: `Bearer ${JUDGE_PASSWORD}` }), 'guest');
  assert.throws(() => example.service.requireOwner({ authorization: `Bearer ${JUDGE_PASSWORD}` }), errorIs('owner_required', 401));
  assert.throws(() => example.service.ownerCookie({ authorization: `Bearer ${JUDGE_PASSWORD}`, originHeader: ORIGIN }), errorIs('owner_required', 401));
  assert.throws(() => example.service.requireCustomAccess(), errorIs('custom_access_required', 401));
  assert.equal(example.service.requireCustomAccess({ authorization: `Bearer ${TOKEN}` }), true);
  assert.equal(example.service.role({ authorization: `Bearer ${TOKEN}`, cookieHeader: cookie }), 'owner');
  const status = await example.recreate().status({ cookieHeader: cookie });
  assert.equal(status.ownerAuthenticated, false); assert.equal(status.judgeAuthenticated, true);
  assert.equal(status.judgeSignInAvailable, true);
  assert.ok(!JSON.stringify(status).includes(JUDGE_PASSWORD)); assert.ok(!JSON.stringify(status).includes(TOKEN));
  assert.deepEqual(await readdir(resolve(example.directory, 'private')), [], 'Successful credentials and cookies are not persisted.');
});

test('judge cookies reject forgery, cross-role reuse, another origin, changed credentials and altered signed roles', async t => {
  const example = await setup(t, { judgeUsername: JUDGE_USERNAME, judgePassword: JUDGE_PASSWORD });
  const cookie = cookieHeader(example.service.judgeCookie({ username: JUDGE_USERNAME, password: JUDGE_PASSWORD, originHeader: ORIGIN }));
  const [payload, signature] = cookie.split('=')[1].split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url'));
  const altered = Buffer.from(JSON.stringify({ ...decoded, role: 'owner' })).toString('base64url');
  const signedAltered = createHmac('sha256', JUDGE_PASSWORD)
    .update(`${ORIGIN}\n${JUDGE_COOKIE_NAME}\njudge\n${JUDGE_USERNAME}\n${altered}`).digest('base64url');
  const owner = cookieHeader(example.service.ownerCookie({ authorization: `Bearer ${TOKEN}`, originHeader: ORIGIN }));
  for (const forged of [`${cookie}; ${cookie}`, `${JUDGE_COOKIE_NAME}=${payload}.${'a'.repeat(43)}`,
    `${JUDGE_COOKIE_NAME}=${altered}.${signature}`, `${JUDGE_COOKIE_NAME}=${altered}.${signedAltered}`,
    owner.replace(OWNER_COOKIE_NAME, JUDGE_COOKIE_NAME), `${JUDGE_COOKIE_NAME}=../../secret`]) {
    assert.equal(example.service.role({ cookieHeader: forged }), 'guest');
    assert.throws(() => example.service.requireCustomAccess({ cookieHeader: forged }), errorIs('custom_access_required', 401));
  }
  assert.throws(() => example.service.requireOwner({ cookieHeader: cookie.replace(JUDGE_COOKIE_NAME, OWNER_COOKIE_NAME) }), errorIs('owner_required', 401));
  for (const overrides of [{ origin: 'https://other.example.test' }, { judgeUsername: 'changed-judge' },
    { judgePassword: Buffer.alloc(32, 81).toString('base64url') }]) {
    const other = createPublicAccess({ ...example.options, ...overrides });
    assert.equal((await other.status({ cookieHeader: cookie })).judgeAuthenticated, false);
  }
});

test('judge sessions survive recreation, expire after 24 hours and logout clears only the judge cookie', async t => {
  const example = await setup(t, { judgePassword: JUDGE_PASSWORD });
  const cookie = cookieHeader(example.service.judgeCookie({ username: 'judge', password: JUDGE_PASSWORD, originHeader: ORIGIN }));
  assert.equal(example.recreate().role({ cookieHeader: cookie }), 'judge');
  const logout = example.service.logoutJudgeCookie();
  assert.equal(logout, `${JUDGE_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  assert.equal(example.service.role({ cookieHeader: cookieHeader(logout) }), 'guest');
  example.advance(JUDGE_SESSION_LIFETIME_MS - 1);
  assert.equal(example.recreate().role({ cookieHeader: cookie }), 'judge');
  example.advance(1);
  assert.equal((await example.recreate().status({ cookieHeader: cookie })).judgeAuthenticated, false);
  assert.throws(() => example.service.requireCustomAccess({ cookieHeader: cookie }), errorIs('custom_access_required', 401));
});

test('judge interactions do not spend or reset guest allowance and still share the global lease', async t => {
  const example = await setup(t, { judgePassword: JUDGE_PASSWORD });
  const issued = await guest(example.service);
  for (let index = 0; index < 4; index++) {
    const grant = await example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
    await grant.finish();
  }
  const saved = await readFile(example.ledgerPath, 'utf8');
  const judge = cookieHeader(example.service.judgeCookie({ username: 'judge', password: JUDGE_PASSWORD, originHeader: ORIGIN }));
  const cookies = `${judge}; ${issued.cookie}`;
  for (let index = 0; index < 8; index++) {
    const grant = await example.recreate().beginGuestInteraction({ cookieHeader: cookies, originHeader: ORIGIN });
    assert.equal(grant.role, 'judge'); assert.equal(grant.remainingInteractions, null);
    await assert.rejects(example.service.beginGuestInteraction({ cookieHeader: judge, originHeader: ORIGIN }), errorIs('access_busy', 409));
    await assert.rejects(example.service.beginGuestInteraction({ authorization: `Bearer ${TOKEN}`, originHeader: ORIGIN }), errorIs('access_busy', 409));
    await grant.finish();
  }
  assert.equal(await readFile(example.ledgerPath, 'utf8'), saved);
  assert.equal((await example.service.status({ cookieHeader: issued.cookie })).guestRemainingInteractions, 0);
  await assert.rejects(example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN }), errorIs('guest_limit_reached', 429));
  const fresh = await guest(example.service);
  const held = await example.service.beginGuestInteraction({ cookieHeader: fresh.cookie, originHeader: ORIGIN });
  await assert.rejects(example.recreate().beginGuestInteraction({ cookieHeader: judge, originHeader: ORIGIN }), errorIs('access_busy', 409));
  await held.finish();
});

test('judge actions require the exact origin before writing failures or reserving an interaction', async t => {
  const example = await setup(t, { judgePassword: JUDGE_PASSWORD });
  for (const originHeader of [undefined, 'null', `${ORIGIN}/`, 'https://evil.example', [ORIGIN]]) {
    assert.throws(() => example.service.judgeCookie({ username: 'judge', password: JUDGE_PASSWORD, originHeader }), errorIs('origin_not_allowed', 403));
  }
  assert.deepEqual(await readdir(example.directory), []);
  const cookie = cookieHeader(example.service.judgeCookie({ username: 'judge', password: JUDGE_PASSWORD, originHeader: ORIGIN }));
  assert.throws(() => example.service.requireCustomAccess({ cookieHeader: cookie, originHeader: 'https://evil.example' }), errorIs('origin_not_allowed', 403));
  await assert.rejects(example.service.beginGuestInteraction({ cookieHeader: cookie, originHeader: 'https://evil.example' }), errorIs('origin_not_allowed', 403));
  assert.deepEqual(await readdir(resolve(example.directory, 'private')), []);
});

test('failed judge sign-ins share a bounded durable throttle and never change existing quotas', async t => {
  const example = await setup(t, { judgePassword: JUDGE_PASSWORD });
  const issued = await guest(example.service);
  const activeJudge = cookieHeader(example.service.judgeCookie({ username: 'judge', password: JUDGE_PASSWORD, originHeader: ORIGIN }));
  const savedQuota = await readFile(example.ledgerPath, 'utf8');
  for (let index = 0; index < JUDGE_LOGIN_FAILURE_LIMIT; index++) {
    assert.throws(() => example.recreate().judgeCookie({ username: 'judge', password: 'wrong', originHeader: ORIGIN }), errorIs('judge_login_invalid', 401));
  }
  const loginPath = `${example.ledgerPath}.judge-login`, savedFailures = await readFile(loginPath, 'utf8');
  assert.deepEqual(JSON.parse(savedFailures), { schemaVersion: 1, startedAt: example.time(), failures: JUDGE_LOGIN_FAILURE_LIMIT });
  assert.equal((await stat(loginPath)).mode & 0o777, 0o600);
  assert.ok(!savedFailures.includes('wrong')); assert.ok(!savedFailures.includes(JUDGE_PASSWORD));
  assert.throws(() => example.recreate().judgeCookie({ username: 'judge', password: 'wrong', originHeader: ORIGIN }), error =>
    errorIs('judge_login_rate_limit', 429)(error) && error.retryAfterSeconds === JUDGE_LOGIN_FAILURE_WINDOW_MS / 1000);
  assert.equal(await readFile(loginPath, 'utf8'), savedFailures);
  assert.equal(await readFile(example.ledgerPath, 'utf8'), savedQuota);
  const allowed = await example.service.beginGuestInteraction({ cookieHeader: activeJudge, originHeader: ORIGIN });
  assert.equal(allowed.role, 'judge'); await allowed.finish();
  assert.equal((await example.service.status({ cookieHeader: issued.cookie })).guestRemainingInteractions, 4);
  example.advance(JUDGE_LOGIN_FAILURE_WINDOW_MS - 1);
  assert.throws(() => example.service.judgeCookie({ username: 'judge', password: 'wrong', originHeader: ORIGIN }), error =>
    errorIs('judge_login_rate_limit', 429)(error) && error.retryAfterSeconds === 1);
  example.advance(1);
  const fresh = cookieHeader(example.recreate().judgeCookie({ username: 'judge', password: JUDGE_PASSWORD, originHeader: ORIGIN }));
  assert.equal(example.service.role({ cookieHeader: fresh }), 'judge');
  assert.ok(!(await readdir(resolve(example.directory, 'private'))).includes('access.json.judge-login'));
});

test('correct judge credentials bypass an exhausted anonymous failure window and restart rejected-guess counts', async t => {
  const example = await setup(t, { judgePassword: JUDGE_PASSWORD });
  for (let index = 0; index < JUDGE_LOGIN_FAILURE_LIMIT; index++) {
    assert.throws(() => example.service.judgeCookie({ username: 'judge', password: 'wrong', originHeader: ORIGIN }), errorIs('judge_login_invalid', 401));
  }
  assert.throws(() => example.recreate().judgeCookie({ username: 'judge', password: 'wrong', originHeader: ORIGIN }), errorIs('judge_login_rate_limit', 429));
  const signed = example.recreate().judgeCookie({ username: 'judge', password: JUDGE_PASSWORD, originHeader: ORIGIN });
  assert.equal(example.service.role({ cookieHeader: cookieHeader(signed) }), 'judge');
  assert.ok(!(await readdir(resolve(example.directory, 'private'))).includes('access.json.judge-login'));
  assert.throws(() => example.service.judgeCookie({ username: 'judge', password: 'wrong', originHeader: ORIGIN }), errorIs('judge_login_invalid', 401));
  assert.deepEqual(JSON.parse(await readFile(`${example.ledgerPath}.judge-login`, 'utf8')),
    { schemaVersion: 1, startedAt: example.time(), failures: 1 });
});

test('a successful judge login clears earlier failures and malformed throttle state fails closed', async t => {
  const example = await setup(t, { judgePassword: JUDGE_PASSWORD });
  assert.throws(() => example.service.judgeCookie({ username: 'wrong', password: JUDGE_PASSWORD, originHeader: ORIGIN }), errorIs('judge_login_invalid', 401));
  assert.equal(example.service.role({ cookieHeader: cookieHeader(example.service.judgeCookie({ username: 'judge', password: JUDGE_PASSWORD, originHeader: ORIGIN })) }), 'judge');
  const loginPath = `${example.ledgerPath}.judge-login`;
  for (const corrupt of [null, { schemaVersion: 1, startedAt: example.time(), failures: JUDGE_LOGIN_FAILURE_LIMIT + 1 },
    { schemaVersion: 1, startedAt: example.time() + 1, failures: 1 }, { schemaVersion: 1, startedAt: example.time(), failures: 0 }]) {
    await writeFile(loginPath, JSON.stringify(corrupt));
    assert.throws(() => example.recreate().judgeCookie({ username: 'judge', password: JUDGE_PASSWORD, originHeader: ORIGIN }), errorIs('access_unavailable', 503));
  }
});

test('cookie-less session bursts are durably throttled without affecting guests or owners', async t => {
  const example = await setup(t);
  const used = await guest(example.service);
  const grant = await example.service.beginGuestInteraction({ cookieHeader: used.cookie, originHeader: ORIGIN });
  await grant.finish();
  for (let index = 1; index < GUEST_SESSION_ISSUANCE_LIMIT; index++) await guest(example.service);
  const saved = await readFile(example.ledgerPath, 'utf8');
  assert.equal(JSON.parse(saved).sessions.length, GUEST_SESSION_ISSUANCE_LIMIT);
  const limited = error => {
    assert.equal(error.code, 'access_session_rate_limit'); assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, GUEST_SESSION_ISSUANCE_WINDOW_MS / 1000);
    return true;
  };
  await assert.rejects(example.service.guestSession(), limited);
  await assert.rejects(example.recreate().guestSession(), limited);
  assert.equal(await readFile(example.ledgerPath, 'utf8'), saved, 'Rejected issuance never rewrites or resets the window.');
  assert.equal((await example.recreate().guestSession({ cookieHeader: used.cookie })).guestRemainingInteractions, 3);
  assert.equal(await readFile(example.ledgerPath, 'utf8'), saved, 'Existing guest refreshes bypass issuance throttling without changing counts.');
  const owner = await example.recreate().beginGuestInteraction({ authorization: `Bearer ${TOKEN}`, originHeader: ORIGIN });
  assert.equal(owner.role, 'owner'); await owner.finish();
  example.advance(GUEST_SESSION_ISSUANCE_WINDOW_MS - 1);
  await assert.rejects(example.recreate().guestSession(), error => errorIs('access_session_rate_limit', 429)(error) && error.retryAfterSeconds === 1);
  example.advance(1);
  await guest(example.recreate());
  assert.deepEqual(JSON.parse(await readFile(example.ledgerPath, 'utf8')).issuance, { startedAt: example.time(), count: 1 });
  assert.equal((await example.service.status({ cookieHeader: used.cookie })).guestRemainingInteractions, 3);
});

test('independent processes share the durable session issuance limit', async t => {
  const example = await setup(t);
  for (let index = 0; index < GUEST_SESSION_ISSUANCE_LIMIT; index++) await guest(example.service);
  const moduleUrl = new URL('./public-access.mjs', import.meta.url).href;
  const result = await execFileAsync(process.execPath, ['--input-type=module', '-e', `
    import { createPublicAccess } from ${JSON.stringify(moduleUrl)};
    const service = createPublicAccess({ mode: 'public', origin: ${JSON.stringify(ORIGIN)}, ledgerPath: ${JSON.stringify(example.ledgerPath)}, now: () => ${example.time()} });
    try { await service.guestSession(); console.log(JSON.stringify({ issued: true })); }
    catch (error) { console.log(JSON.stringify({ code: error.code, status: error.status, retryAfterSeconds: error.retryAfterSeconds })); }
  `]);
  assert.deepEqual(JSON.parse(result.stdout), { code: 'access_session_rate_limit', status: 429, retryAfterSeconds: GUEST_SESSION_ISSUANCE_WINDOW_MS / 1000 });
  assert.equal(JSON.parse(await readFile(example.ledgerPath, 'utf8')).sessions.length, GUEST_SESSION_ISSUANCE_LIMIT);
});

test('full guest capacity reclaims only unused records and preserves spent session quotas', async t => {
  const example = await setup(t);
  let used; let oldestUnused;
  for (let index = 0; index < MAX_GUEST_SESSIONS; index++) {
    if (index && index % GUEST_SESSION_ISSUANCE_LIMIT === 0) example.advance(GUEST_SESSION_ISSUANCE_WINDOW_MS);
    const issued = await guest(example.service);
    if (index === 0) {
      used = issued;
      const grant = await example.service.beginGuestInteraction({ cookieHeader: used.cookie, originHeader: ORIGIN });
      await grant.finish();
    }
    if (index === 1) oldestUnused = issued;
  }
  example.advance(GUEST_SESSION_ISSUANCE_WINDOW_MS);
  const fresh = await guest(example.recreate());
  const ledger = JSON.parse(await readFile(example.ledgerPath, 'utf8'));
  assert.equal(ledger.sessions.length, MAX_GUEST_SESSIONS);
  assert.equal((await example.service.status({ cookieHeader: used.cookie })).guestRemainingInteractions, 3);
  assert.equal((await example.service.status({ cookieHeader: oldestUnused.cookie })).guestRemainingInteractions, null);
  await assert.rejects(example.service.beginGuestInteraction({ cookieHeader: oldestUnused.cookie, originHeader: ORIGIN }), errorIs('guest_session_required', 401));
  assert.equal((await example.service.status({ cookieHeader: fresh.cookie })).guestRemainingInteractions, 4);
  assert.ok(!JSON.stringify(ledger).includes(fresh.cookie.split('=')[1]));
});

test('used guest records stay bounded until expiry and are never evicted to reset quotas', async t => {
  const example = await setup(t);
  let first;
  for (let index = 0; index < MAX_GUEST_SESSIONS; index++) {
    if (index && index % GUEST_SESSION_ISSUANCE_LIMIT === 0) example.advance(GUEST_SESSION_ISSUANCE_WINDOW_MS);
    const issued = await guest(example.service);
    first ??= issued;
    const grant = await example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
    await grant.finish();
  }
  example.advance(GUEST_SESSION_ISSUANCE_WINDOW_MS);
  await assert.rejects(example.service.guestSession(), errorIs('access_session_limit', 503));
  assert.equal(JSON.parse(await readFile(example.ledgerPath, 'utf8')).sessions.length, MAX_GUEST_SESSIONS);
  assert.equal((await example.service.status({ cookieHeader: first.cookie })).guestRemainingInteractions, 3);
  example.advance(GUEST_SESSION_LIFETIME_MS);
  await guest(example.service);
  assert.equal(JSON.parse(await readFile(example.ledgerPath, 'utf8')).sessions.length, 1);
});

test('legacy guest ledgers retain deployed cookies and quotas while upgrading on mutation', async t => {
  const example = await setup(t);
  const issued = await guest(example.service);
  const grant = await example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
  await grant.finish();
  const { sessions } = JSON.parse(await readFile(example.ledgerPath, 'utf8'));
  const legacy = JSON.stringify({ schemaVersion: 1, sessions });
  await writeFile(example.ledgerPath, legacy);
  assert.equal((await example.recreate().guestSession({ cookieHeader: issued.cookie })).guestRemainingInteractions, 3);
  assert.equal(await readFile(example.ledgerPath, 'utf8'), legacy, 'Read-only reuse does not force migration.');
  await guest(example.recreate());
  const upgraded = JSON.parse(await readFile(example.ledgerPath, 'utf8'));
  assert.equal(upgraded.schemaVersion, 2);
  assert.deepEqual(upgraded.sessions[0], sessions[0]);
  assert.deepEqual(upgraded.issuance, { startedAt: example.time(), count: 1 });
});

test('corrupt issuance state and a backwards clock cannot reset the durable throttle', async t => {
  const example = await setup(t);
  const issued = await guest(example.service);
  const saved = JSON.parse(await readFile(example.ledgerPath, 'utf8'));
  for (const issuance of [{ startedAt: example.time(), count: GUEST_SESSION_ISSUANCE_LIMIT + 1 },
    { startedAt: example.time(), count: 0 }, { startedAt: -1, count: 1 }, { startedAt: example.time(), count: 1, extra: true }, {}]) {
    await writeFile(example.ledgerPath, JSON.stringify({ ...saved, issuance }));
    await assert.rejects(example.recreate().guestSession(), errorIs('access_unavailable', 503));
    await assert.rejects(example.recreate().status({ cookieHeader: issued.cookie }), errorIs('access_unavailable', 503));
  }
  await writeFile(example.ledgerPath, JSON.stringify(saved));
  example.advance(-1);
  await assert.rejects(example.recreate().guestSession(), errorIs('access_unavailable', 503));
  assert.deepEqual(JSON.parse(await readFile(example.ledgerPath, 'utf8')), saved);
});

test('a literal null ledger fails closed instead of resetting guest quotas or session throttling', async t => {
  const example = await setup(t);
  const issued = await guest(example.service);
  const grant = await example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
  await grant.finish();
  for (let index = 1; index < GUEST_SESSION_ISSUANCE_LIMIT; index++) await guest(example.service);
  const saved = await readFile(example.ledgerPath, 'utf8');
  await writeFile(example.ledgerPath, 'null\n');
  await assert.rejects(example.recreate().status({ cookieHeader: issued.cookie }), errorIs('access_unavailable', 503));
  await assert.rejects(example.recreate().guestSession(), errorIs('access_unavailable', 503));
  await assert.rejects(example.recreate().guestSession({ cookieHeader: issued.cookie }), errorIs('access_unavailable', 503));
  for (const credentials of [{ cookieHeader: issued.cookie }, { authorization: `Bearer ${TOKEN}` }]) {
    await assert.rejects(example.recreate().beginGuestInteraction({ ...credentials, originHeader: ORIGIN }), errorIs('access_unavailable', 503));
  }
  assert.equal(await readFile(example.ledgerPath, 'utf8'), 'null\n', 'Corrupt state is never replaced by an empty ledger.');
  assert.deepEqual(await readdir(resolve(example.directory, 'private')), ['access.json'], 'Rejected interactions reserve no new lease.');
  await writeFile(example.ledgerPath, saved);
  assert.equal((await example.recreate().status({ cookieHeader: issued.cookie })).guestRemainingInteractions, 3);
  await assert.rejects(example.recreate().guestSession(), errorIs('access_session_rate_limit', 429));
});

test('a literal null interaction lease blocks guests and owners without consuming another attempt', async t => {
  const example = await setup(t);
  const issued = await guest(example.service);
  const held = await example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
  const leasePath = `${example.ledgerPath}.interaction`;
  const savedLease = await readFile(leasePath, 'utf8');
  const savedLedger = await readFile(example.ledgerPath, 'utf8');
  await writeFile(leasePath, 'null\n');
  for (const credentials of [{ cookieHeader: issued.cookie }, { authorization: `Bearer ${TOKEN}` }]) {
    await assert.rejects(example.recreate().beginGuestInteraction({ ...credentials, originHeader: ORIGIN }), errorIs('access_unavailable', 503));
  }
  await assert.rejects(held.finish(), errorIs('access_unavailable', 503));
  assert.equal(await readFile(leasePath, 'utf8'), 'null\n', 'Corrupt leases are not silently replaced or released.');
  assert.equal(await readFile(example.ledgerPath, 'utf8'), savedLedger);
  await writeFile(leasePath, savedLease);
  await held.finish();
  const next = await example.recreate().beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN });
  assert.equal(next.remainingInteractions, 2);
  await next.finish();
});

test('tampered, duplicate, or overlong guest cookies cannot become authorized sessions', async t => {
  const example = await setup(t);
  const issued = await guest(example.service);
  for (const invalid of [`${GUEST_COOKIE_NAME}=${'a'.repeat(43)}`, `${issued.cookie}; ${issued.cookie}`,
    `${GUEST_COOKIE_NAME}=${'a'.repeat(9000)}`, `${issued.cookie}\n`, `${GUEST_COOKIE_NAME}=../../.env`]) {
    assert.equal((await example.service.status({ cookieHeader: invalid })).guestRemainingInteractions, null);
    await assert.rejects(example.service.beginGuestInteraction({ cookieHeader: invalid, originHeader: ORIGIN }), errorIs('guest_session_required', 401));
  }
  assert.equal((await example.service.status({ cookieHeader: issued.cookie })).guestRemainingInteractions, 4);
});

test('corrupt ledgers, symlinks, and occupied locks fail closed with safe errors and no retries', async t => {
  for (const corrupt of ['{not json', JSON.stringify({ schemaVersion: 1, sessions: [], key: TOKEN }), 'x'.repeat(128 * 1024 + 1)]) {
    const example = await setup(t);
    const issued = await guest(example.service);
    await writeFile(example.ledgerPath, corrupt);
    await assert.rejects(example.service.status({ cookieHeader: issued.cookie }), errorIs('access_unavailable', 503));
    await assert.rejects(example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN }), errorIs('access_unavailable', 503));
  }
  const example = await setup(t);
  const issued = await guest(example.service);
  const bytes = await readFile(example.ledgerPath, 'utf8');
  await writeFile(`${example.ledgerPath}.lock`, 'held');
  await assert.rejects(example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN }), errorIs('access_busy', 409));
  assert.equal(await readFile(example.ledgerPath, 'utf8'), bytes);
  await rm(`${example.ledgerPath}.lock`);
  await rm(example.ledgerPath);
  const target = resolve(example.directory, 'unrelated-private-file');
  await writeFile(target, JSON.stringify({ secret: 'fake-private-sentinel' }));
  await symlink(target, example.ledgerPath);
  await assert.rejects(example.service.guestSession(), error => {
    assert.equal(error.code, 'access_unavailable');
    assert.ok(!error.message.includes('sentinel'));
    assert.ok(!error.message.includes(example.directory));
    return true;
  });
});

test('opening public custom access preserves existing cookies and usage while adding Qloo counters on mutation', async t => {
  const example = await setup(t);
  const issued = await guest(example.service);
  for (let i = 0; i < 4; i++) await (await example.service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN })).finish();
  const before = await readFile(example.ledgerPath, 'utf8');
  const oldRecord = JSON.parse(before).sessions[0];
  const service = createPublicAccess({ ...example.options, publicCustomAccess: true, guestDailyLimit: 24, guestQlooDailyLimit: 12 });
  assert.equal(service.requireCustomAccess({ cookieHeader: issued.cookie }), true);
  assert.throws(() => service.requireCustomAccess(), errorIs('access_session_required', 401));
  assert.throws(() => service.requireCustomAccess({ cookieHeader: issued.cookie, originHeader: 'https://wrong.example' }), errorIs('origin_not_allowed', 403));
  const status = await service.status({ cookieHeader: issued.cookie });
  assert.equal(status.publicCustomAccess, true); assert.equal(status.guestRemainingInteractions, 20);
  assert.equal(status.guestRemainingQlooRequests, 12); assert.equal(service.role({ cookieHeader: issued.cookie }), 'guest');
  assert.equal(await readFile(example.ledgerPath, 'utf8'), before, 'Reading the upgrade does not rewrite or reset deployed usage.');
  const lease = await service.beginGuestInteraction({ cookieHeader: issued.cookie, originHeader: ORIGIN, kind: 'qloo', count: false });
  await lease.finish();
  assert.equal(await readFile(example.ledgerPath, 'utf8'), before, 'A cache-only Qloo operation spends neither quota.');
  await service.reserveGuestQlooRequest({ cookieHeader: issued.cookie, originHeader: ORIGIN });
  const upgraded = JSON.parse(await readFile(example.ledgerPath, 'utf8'));
  assert.equal(upgraded.schemaVersion, 3);
  assert.deepEqual(Object.fromEntries(Object.keys(oldRecord).map(key => [key, upgraded.sessions[0][key]])), oldRecord);
  assert.equal(upgraded.sessions[0].qlooRequests, 1);
  assert.equal((await service.status({ cookieHeader: issued.cookie })).guestRemainingInteractions, 20);
  assert.equal((await service.status({ cookieHeader: issued.cookie })).guestRemainingQlooRequests, 11);
});

test('public Qloo and Luna quotas are independent, durable and reset only by their UTC day', async t => {
  const example = await setup(t, { publicCustomAccess: true, guestDailyLimit: 24, guestQlooDailyLimit: 12 });
  const issued = await guest(example.service);
  const credentials = { cookieHeader: issued.cookie, originHeader: ORIGIN };
  for (let i = 0; i < 24; i++) await (await example.service.beginGuestInteraction(credentials)).finish();
  await assert.rejects(example.service.beginGuestInteraction(credentials), errorIs('guest_limit_reached', 429));
  assert.equal((await example.service.status(credentials)).guestRemainingQlooRequests, 12);
  for (let i = 0; i < 12; i++) await example.recreate().reserveGuestQlooRequest(credentials);
  await assert.rejects(example.service.reserveGuestQlooRequest(credentials), errorIs('guest_qloo_limit_reached', 429));
  const exhausted = await readFile(example.ledgerPath, 'utf8');
  assert.equal(example.service.requireCustomAccess(credentials), true, 'Saved custom evidence remains accessible after live quotas are used.');
  await (await example.service.beginGuestInteraction({ ...credentials, kind: 'qloo', count: false })).finish();
  assert.equal(await readFile(example.ledgerPath, 'utf8'), exhausted);
  example.advance(12 * 60 * 60 * 1000);
  const next = await example.recreate().status(credentials);
  assert.equal(next.guestRemainingInteractions, 24); assert.equal(next.guestRemainingQlooRequests, 12);
  await example.recreate().reserveGuestQlooRequest(credentials);
  const updated = JSON.parse(await readFile(example.ledgerPath, 'utf8')).sessions[0];
  assert.equal(updated.interactions, 24); assert.equal(updated.day, '2030-01-01');
  assert.equal(updated.qlooRequests, 1); assert.equal(updated.qlooDay, '2030-01-02');
});

test('judge access bypasses both browser quotas without changing them or gaining owner authority', async t => {
  const example = await setup(t, { publicCustomAccess: true, guestDailyLimit: 1, guestQlooDailyLimit: 1,
    judgeUsername: JUDGE_USERNAME, judgePassword: JUDGE_PASSWORD });
  const issued = await guest(example.service);
  const credentials = { cookieHeader: issued.cookie, originHeader: ORIGIN };
  await (await example.service.beginGuestInteraction(credentials)).finish();
  await example.service.reserveGuestQlooRequest(credentials);
  const before = await readFile(example.ledgerPath, 'utf8');
  const judgeCookie = cookieHeader(example.service.judgeCookie({ username: JUDGE_USERNAME, password: JUDGE_PASSWORD, originHeader: ORIGIN }));
  const authenticated = { ...credentials, cookieHeader: issued.cookie + '; ' + judgeCookie };
  await (await example.service.beginGuestInteraction(authenticated)).finish();
  await example.service.reserveGuestQlooRequest(authenticated);
  assert.equal(await readFile(example.ledgerPath, 'utf8'), before);
  assert.throws(() => example.service.requireOwner(authenticated), errorIs('owner_required', 401));
  assert.equal(example.service.requireCustomAccess(authenticated), true);
});

test('guest capacity never evicts a Qloo-used record to restore its fresh-request allowance', async t => {
  const example = await setup(t, { publicCustomAccess: true, guestDailyLimit: 24, guestQlooDailyLimit: 12 });
  const issued = await guest(example.service);
  const original = JSON.parse(await readFile(example.ledgerPath, 'utf8')).sessions[0];
  const sessions = [original, ...Array.from({ length: MAX_GUEST_SESSIONS - 1 }, (_, i) => ({
    ...original, idHash: createHash('sha256').update('synthetic-other-' + i).digest('hex'),
  }))].map(session => ({ ...session, qlooRequests: 1 }));
  await writeFile(example.ledgerPath, JSON.stringify({ schemaVersion: 3, sessions, issuance: null }));
  const before = await readFile(example.ledgerPath, 'utf8');
  await assert.rejects(example.service.guestSession(), errorIs('access_session_limit', 503));
  assert.equal(await readFile(example.ledgerPath, 'utf8'), before);
  assert.equal((await example.service.guestSession({ cookieHeader: issued.cookie })).guestRemainingQlooRequests, 11);
});
