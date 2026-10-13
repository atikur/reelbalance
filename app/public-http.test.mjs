import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.mjs';
import { createProgrammeService } from './programme-service.mjs';
import { createAgentService } from './agent-service.mjs';
import { createQlooRuntime } from './qloo-runtime.mjs';
import { createPublicAccess, GUEST_SESSION_ISSUANCE_LIMIT, GUEST_SESSION_ISSUANCE_WINDOW_MS,
  GUEST_SESSION_LIFETIME_MS, MAX_GUEST_SESSIONS } from './public-access.mjs';
import { createState, receiveProposal, approveProposal, makeSheetHtml } from './public/state.js';

// Invented fixtures and injected providers only. These ranks contain no Qloo response data.
const fixture = {
  schemaVersion: 1,
  dataset: { id: 'invented-http-fixture', source: 'Invented HTTP test ranks', disclosure: 'Invented test data.', synthetic: true },
  films: ['A', 'B', 'C', 'D'].map((label, i) => ({ id: `invented-${label}`, catalogue_id: `F${i + 1}`, name: `Invented Film ${label}`, year: 2000 + i, runtime: i === 3 ? 120 : 90 + i, eligible: true })),
  profiles: ['X', 'Y', 'Z'].map((label, i) => ({ id: label, name: label, reference: `Invented Artist ${label}`, ranks: { [`invented-${'ABC'[i]}`]: 1, 'invented-D': 2 } })),
};
const context = { slots: 3, maximumRuntime: 110, excluded: [], locked: [], current: [] };
const message = { message: 'Propose a programme.', context };
const origin = 'https://reelbalance.example';
const ownerToken = 'a'.repeat(64); // Mock cryptographic-format token, never deployed.
const realShapeFixture = () => ({ ...structuredClone(fixture), dataset: { ...fixture.dataset, synthetic: false } });

function request(port, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolveResponse, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, response => {
      const pieces = [];
      response.on('data', piece => pieces.push(piece));
      response.on('end', () => {
        const text = Buffer.concat(pieces).toString();
        let json;
        try { json = JSON.parse(text); } catch {}
        resolveResponse({ status: response.statusCode, headers: response.headers, text, json });
      });
    });
    outgoing.on('error', reject); outgoing.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const post = (port, path, body, headers = {}) => request(port, path, { method: 'POST', body, headers: { 'Content-Type': 'application/json', Origin: origin, ...headers } });
async function serve(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-public-http-'));
  const server = await createServer({ dataset: realShapeFixture(), accessMode: 'public', appOrigin: origin, ownerToken,
    accessLedgerPath: join(directory, 'access.json'), ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(directory, { recursive: true, force: true }); });
  return { port: server.address().port, directory };
}

const fakeAgent = (calls = []) => ({ status: () => ({ model: 'mock', configured: true }), run: async body => { calls.push(body); return { answer: 'Injected mock, never a provider response.', llmRequests: 0, qlooRequests: 0 }; } });

test('public boot serves both browser helpers with the current source and no provider operation',async t=>{
  const calls=[];const {port}=await serve(t,{agentService:fakeAgent(calls)});
  for(const name of ['persistence.js','replacement.js']) {
    const response=await request(port,'/'+name);
    assert.equal(response.status,200);
    assert.match(response.headers['content-type'],/^text\/javascript/);
    assert.equal(response.text,await readFile(new URL('./public/'+name,import.meta.url),'utf8'));
    assert.equal(response.headers['cache-control'],'no-store');
  }
  assert.equal(calls.length,0);
});

test('public startup requires exact HTTPS origin and owner token for live Qloo', async () => {
  await assert.rejects(createServer({ dataset: fixture, accessMode: 'public' }), /HTTPS/);
  await assert.rejects(createServer({ dataset: fixture, accessMode: 'public', appOrigin: 'http://127.0.0.1' }), /HTTPS/);
  await assert.rejects(createServer({ dataset: fixture, accessMode: 'public', appOrigin: origin, qlooLive: true }), /OWNER_TOKEN/);
});

test('public guests get four bounded interactions; missing sessions and missing or foreign origins never reach agent', async t => {
  const calls = []; const { port } = await serve(t, { agentService: fakeAgent(calls) });
  assert.equal((await post(port, '/api/agent', message)).status, 401);
  const access = await request(port, '/api/access/status');
  const cookie = access.headers['set-cookie'][0].split(';')[0];
  assert.equal(access.json.mode, 'public'); assert.equal(access.json.guestRemainingInteractions, 4);
  assert.match(access.headers['set-cookie'][0], /HttpOnly/); assert.match(access.headers['set-cookie'][0], /Secure/);
  for (const badOrigin of ['', 'null', 'https://foreign.example', 'http://127.0.0.1']) {
    const stopped = await post(port, '/api/agent', message, { Cookie: cookie, Origin: badOrigin });
    assert.equal(stopped.status, 403);
  }
  assert.equal(calls.length, 0);
  for (let i = 0; i < 4; i++) assert.equal((await post(port, '/api/agent', message, { Cookie: cookie })).status, 200);
  const denied = await post(port, '/api/agent', message, { Cookie: cookie });
  assert.equal(denied.status, 429); assert.equal(calls.length, 4);
  const status = await request(port, '/api/access/status', { headers: { Cookie: cookie } });
  assert.equal(status.json.guestRemainingInteractions, 0);
  assert.ok(!status.text.includes(ownerToken));
  assert.equal((await post(port, '/api/programme', context)).status, 200, 'Manual planning remains available after the guest limit');
});

test('known unavailable assistant states preserve guest allowance, provider ledger and durable locks without reserving a lease', async t => {
  const at = Date.parse('2030-01-01T12:00:00.000Z');
  const cases = [
    { name: 'missing key', apiKey: '', status: 503, code: 'agent_not_configured' },
    { name: 'saved provider pause', paused: { reason: 'provider_rate_limit', at: new Date(at).toISOString() }, status: 503, code: 'agent_provider_paused' },
    { name: 'daily allowance exhausted', attempts: 36, status: 429, code: 'agent_budget_exhausted' },
    { name: 'unverifiable provider ledger', corrupt: true, status: 503, code: 'agent_budget_unavailable' },
    ...['.lock', '.interaction.lock', '.admin.lock'].map(lock => ({ name: `unfinished ${lock}`, lock, status: 409, code: 'agent_busy' })),
  ];
  for (const scenario of cases) await t.test(scenario.name, async subtest => {
    const directory = await mkdtemp(join(tmpdir(), 'reelbalance-http-preflight-'));
    subtest.after(() => rm(directory, { recursive: true, force: true }));
    const budgetPath = join(directory, 'budget.json'), ledgerPath = join(directory, 'access.json');
    const budget = scenario.corrupt ? '{invalid saved ledger' : JSON.stringify({ schemaVersion: 1, day: '2030-01-01',
      attempts: scenario.attempts ?? 2, ...(scenario.paused ? { paused: scenario.paused } : {}) });
    await writeFile(budgetPath, budget);
    if (scenario.lock) await writeFile(budgetPath + scenario.lock, 'Existing lock must remain untouched.');
    let providerCalls = 0, reservations = 0;
    const agent = createAgentService({ programmeService: createProgrammeService(realShapeFixture()), apiKey: scenario.apiKey ?? 'mock-key',
      budgetPath, dailyLimit: 36, persistProviderPause: true, now: () => at, fetchImpl: async () => { providerCalls++; throw Error('Must not invoke a provider'); } });
    const accessService = createPublicAccess({ mode: 'public', origin, ownerToken, ledgerPath, now: () => at });
    const begin = accessService.beginGuestInteraction;
    accessService.beginGuestInteraction = async credentials => { reservations++; return begin(credentials); };
    const { port } = await serve(subtest, { agentService: agent, accessService });
    const opened = await request(port, '/api/access/status');
    const cookie = opened.headers['set-cookie'][0].split(';')[0];
    const denied = await post(port, '/api/agent', message, { Cookie: cookie });
    assert.equal(denied.status, scenario.status); assert.equal(denied.json.code, scenario.code);
    assert.equal(reservations, 0); assert.equal(providerCalls, 0);
    assert.equal((await request(port, '/api/access/status', { headers: { Cookie: cookie } })).json.guestRemainingInteractions, 4);
    assert.equal((await readFile(budgetPath)).toString(), budget);
    await assert.rejects(readFile(ledgerPath + '.interaction'), { code: 'ENOENT' });
    if (scenario.lock) assert.equal((await readFile(budgetPath + scenario.lock)).toString(), 'Existing lock must remain untouched.');
  });
});

test('an available assistant still reserves one guest interaction and one actual mocked provider attempt', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-http-ready-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const budgetPath = join(directory, 'budget.json'), ledgerPath = join(directory, 'access.json');
  let providerCalls = 0;
  const agent = createAgentService({ programmeService: createProgrammeService(realShapeFixture()), apiKey: 'mock-key', budgetPath, dailyLimit: 36,
    persistProviderPause: true, fetchImpl: async () => { providerCalls++; return new Response(JSON.stringify({ status: 'completed', output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Invented offline answer.' }] },
    ] }), { status: 200 }); } });
  const { port } = await serve(t, { agentService: agent, accessLedgerPath: ledgerPath });
  const opened = await request(port, '/api/access/status'); const cookie = opened.headers['set-cookie'][0].split(';')[0];
  const response = await post(port, '/api/agent', message, { Cookie: cookie });
  assert.equal(response.status, 200); assert.equal(response.json.llmRequests, 1); assert.equal(providerCalls, 1);
  assert.equal((await request(port, '/api/access/status', { headers: { Cookie: cookie } })).json.guestRemainingInteractions, 3);
  assert.equal(JSON.parse(await readFile(budgetPath)).attempts, 1);
  await assert.rejects(readFile(ledgerPath + '.interaction'), { code: 'ENOENT' });
  await assert.rejects(readFile(budgetPath + '.interaction.lock'), { code: 'ENOENT' });
});

test('a provider failure keeps its guest and model attempts; later paused requests do not spend another guest interaction', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-http-provider-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const budgetPath = join(directory, 'budget.json'), ledgerPath = join(directory, 'access.json');
  let providerCalls = 0;
  const agent = createAgentService({ programmeService: createProgrammeService(realShapeFixture()), apiKey: 'mock-key', budgetPath, dailyLimit: 36,
    persistProviderPause: true, fetchImpl: async () => { providerCalls++; return new Response('{}', { status: 429 }); } });
  const { port } = await serve(t, { agentService: agent, accessLedgerPath: ledgerPath });
  const opened = await request(port, '/api/access/status'); const cookie = opened.headers['set-cookie'][0].split(';')[0];
  const failed = await post(port, '/api/agent', message, { Cookie: cookie });
  assert.equal(failed.json.code, 'agent_provider_error'); assert.equal(providerCalls, 1);
  const saved = (await readFile(budgetPath)).toString(); assert.equal(JSON.parse(saved).attempts, 1); assert.ok(JSON.parse(saved).paused);
  assert.equal((await request(port, '/api/access/status', { headers: { Cookie: cookie } })).json.guestRemainingInteractions, 3);
  const blocked = await post(port, '/api/agent', message, { Cookie: cookie });
  assert.equal(blocked.status, 503); assert.equal(blocked.json.code, 'agent_provider_paused'); assert.equal(providerCalls, 1);
  assert.equal((await readFile(budgetPath)).toString(), saved);
  assert.equal((await request(port, '/api/access/status', { headers: { Cookie: cookie } })).json.guestRemainingInteractions, 3);
  await assert.rejects(readFile(ledgerPath + '.interaction'), { code: 'ENOENT' });
});

test('a lock acquired after the availability snapshot is still enforced by the agent without refunding a reservation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-http-preflight-race-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const budgetPath = join(directory, 'budget.json'), ledgerPath = join(directory, 'access.json');
  const saved = JSON.stringify({ schemaVersion: 1, day: new Date().toISOString().slice(0, 10), attempts: 2 });
  await writeFile(budgetPath, saved);
  let providerCalls = 0;
  const agent = createAgentService({ programmeService: createProgrammeService(realShapeFixture()), apiKey: 'mock-key', budgetPath, dailyLimit: 36,
    persistProviderPause: true, fetchImpl: async () => { providerCalls++; throw Error('Must not invoke a provider'); } });
  const snapshotThenLock = { ...agent, status: async () => {
    const status = agent.status();
    await writeFile(budgetPath + '.interaction.lock', 'A concurrent interaction acquired this lock.');
    return status;
  } };
  const { port } = await serve(t, { agentService: snapshotThenLock, accessLedgerPath: ledgerPath });
  const opened = await request(port, '/api/access/status'); const cookie = opened.headers['set-cookie'][0].split(';')[0];
  const blocked = await post(port, '/api/agent', message, { Cookie: cookie });
  assert.equal(blocked.status, 409); assert.equal(blocked.json.code, 'agent_busy'); assert.equal(providerCalls, 0);
  assert.equal((await readFile(budgetPath)).toString(), saved);
  assert.equal((await readFile(budgetPath + '.interaction.lock')).toString(), 'A concurrent interaction acquired this lock.');
  assert.equal((await request(port, '/api/access/status', { headers: { Cookie: cookie } })).json.guestRemainingInteractions, 3);
  await assert.rejects(readFile(ledgerPath + '.interaction'), { code: 'ENOENT' });
});

test('cookie-less HTTP bursts get a short retry limit while existing guests, owners and manual planning stay usable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-http-session-rate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let at = Date.parse('2030-01-01T12:00:00.000Z');
  const ledgerPath = join(directory, 'access.json');
  const accessService = createPublicAccess({ mode: 'public', origin, ownerToken, ledgerPath, now: () => at });
  const calls = [];
  const { port } = await serve(t, { accessService, agentService: fakeAgent(calls) });
  const existing = await request(port, '/api/access/status');
  const cookie = existing.headers['set-cookie'][0].split(';')[0];
  for (let index = 1; index < 257; index++) {
    const response = await request(port, '/api/access/status', { headers: { 'X-Forwarded-For': `198.51.100.${index % 255}` } });
    if (index < GUEST_SESSION_ISSUANCE_LIMIT) assert.equal(response.status, 200);
    else {
      assert.equal(response.status, 429); assert.equal(response.json.code, 'access_session_rate_limit');
      assert.equal(response.headers['retry-after'], String(GUEST_SESSION_ISSUANCE_WINDOW_MS / 1000));
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.json.mode, 'public'); assert.equal(response.json.ownerAuthenticated, false);
      assert.equal(response.json.ownerSignInAvailable, true); assert.equal(response.json.guestRemainingInteractions, null);
      assert.equal(response.json.guestMaxInteractionsPerDay, 4); assert.equal(response.json.synthetic, false);
      assert.equal(response.json.recordedAvailable, false);
      assert.ok(!response.text.includes(ownerToken)); assert.ok(!response.text.includes(cookie.split('=')[1]));
    }
  }
  assert.equal(JSON.parse(await readFile(ledgerPath)).sessions.length, GUEST_SESSION_ISSUANCE_LIMIT);
  assert.equal((await request(port, '/api/access/status', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await post(port, '/api/agent', message, { Cookie: cookie })).status, 200);
  assert.equal((await request(port, '/api/access/status', { headers: { Cookie: cookie } })).json.guestRemainingInteractions, 3);
  assert.equal((await post(port, '/api/access/owner', { token: ownerToken })).status, 200);
  const owner = await request(port, '/api/access/status', { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(owner.status, 200); assert.equal(owner.json.ownerAuthenticated, true);
  assert.equal((await post(port, '/api/programme', context)).status, 200);
  assert.equal((await request(port, '/api/bootstrap')).status, 200);
  assert.equal(calls.length, 1, 'Only the deliberate mock guest interaction was invoked.');
  at += GUEST_SESSION_ISSUANCE_WINDOW_MS;
  const recovered = await request(port, '/api/access/status');
  assert.equal(recovered.status, 200); assert.equal(recovered.json.guestRemainingInteractions, 4);
  assert.ok(recovered.headers['set-cookie']);
});

test('a full used guest pool still returns verified owner and recording availability without exposing ledger data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-http-session-full-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const at = Date.parse('2030-01-01T12:00:00.000Z');
  const ledgerPath = join(directory, 'access.json');
  const sessions = Array.from({ length: MAX_GUEST_SESSIONS }, (_, index) => ({ idHash: index.toString(16).padStart(64, '0'),
    createdAt: at, expiresAt: at + GUEST_SESSION_LIFETIME_MS, day: '2030-01-01', interactions: 4 }));
  await writeFile(ledgerPath, JSON.stringify({ schemaVersion: 2, sessions, issuance: null }));
  const accessService = createPublicAccess({ mode: 'public', origin, ownerToken, ledgerPath, now: () => at });
  const calls = [];
  const { port } = await serve(t, { accessService, agentService: fakeAgent(calls) });
  const response = await request(port, '/api/access/status');
  assert.equal(response.status, 503); assert.equal(response.json.code, 'access_session_limit');
  assert.equal(response.json.mode, 'public'); assert.equal(response.json.ownerAuthenticated, false);
  assert.equal(response.json.ownerSignInAvailable, true); assert.equal(response.json.guestRemainingInteractions, null);
  assert.equal(response.json.guestMaxInteractionsPerDay, 4); assert.equal(response.json.recordedAvailable, false);
  assert.equal(response.json.synthetic, false); assert.equal(response.headers['set-cookie'], undefined);
  assert.ok(!response.text.includes(ownerToken)); assert.ok(!response.text.includes(sessions[0].idHash));
  const login = await post(port, '/api/access/owner', { token: ownerToken });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request(port, '/api/access/status', { headers: { Cookie: cookie } })).json.ownerAuthenticated, true);
  assert.equal((await post(port, '/api/programme', context)).status, 200);
  assert.equal(calls.length, 0);
  assert.equal(JSON.parse(await readFile(ledgerPath)).sessions.length, MAX_GUEST_SESSIONS);
});

test('loopback hosting proxy and forwarded headers never authorize owner routes; signed owner cookie does', async t => {
  let tasteCalls = 0;
  const tasteService = { status: async () => { tasteCalls++; return { mock: true }; } };
  const { port } = await serve(t, { tasteService });
  for (const headers of [{}, { 'X-Forwarded-For': '127.0.0.1' }, { Authorization: 'Bearer invalid' }]) {
    assert.equal((await request(port, '/api/tastes/status', { headers })).status, 401);
  }
  assert.equal(tasteCalls, 0);
  const failed = await post(port, '/api/access/owner', { token: 'invalid' });
  assert.equal(failed.status, 401); assert.ok(!failed.text.includes(ownerToken));
  const login = await post(port, '/api/access/owner', { token: ownerToken });
  assert.equal(login.status, 200); assert.ok(!login.text.includes(ownerToken));
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request(port, '/api/tastes/status', { headers: { Cookie: cookie } })).status, 200);
  assert.equal(tasteCalls, 1);
  const status = await request(port, '/api/access/status', { headers: { Cookie: cookie } });
  assert.equal(status.json.ownerAuthenticated, true);
  const logout = await post(port, '/api/access/logout', {});
  assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
});

test('synthetic fixtures block all provider and recorded routes even with injected configured services', async t => {
  const calls = [];
  const { port } = await serve(t, { dataset: fixture, agentService: fakeAgent(calls), tasteService: { status: () => { throw Error('Must not run'); } } });
  const bootstrap = await request(port, '/api/bootstrap');
  assert.equal(bootstrap.json.dataset.synthetic, true); assert.match(bootstrap.json.policy.transport, /Invented/);
  const status = await request(port, '/api/agent-status');
  assert.equal(status.json.configured, false); assert.equal(status.json.providerStatus, 'synthetic_mode');
  for (const path of ['/api/agent', '/api/tastes/search', '/api/tastes/rank']) {
    const result = await post(port, path, message); assert.equal(result.status, 503); assert.equal(result.json.code, 'synthetic_mode');
  }
  assert.equal((await request(port, '/api/demo-scenarios')).status, 503); assert.equal(calls.length, 0);
  const service = createProgrammeService(fixture);
  let state = createState(service.bootstrap());
  const proposal = service.repairOptions(context);
  state = approveProposal(receiveProposal(state, proposal, state.revision), 'current', '2026-10-07T00:00:00.000Z');
  const html = makeSheetHtml(state);
  assert.match(html, /APPROVED SYNTHETIC SETUP/); assert.match(html, /invented year/); assert.ok(!html.includes('(Qloo year)'));
});

test('public provider pause survives new services and UTC rollover without resetting attempt counts or retrying', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-public-provider-')); t.after(() => rm(directory, { recursive: true, force: true }));
  for (const kind of ['rate', 'network']) {
    const budgetPath = join(directory, `${kind}.json`); let calls = 0;
    const options = { programmeService: createProgrammeService(realShapeFixture()), apiKey: 'mock-key', budgetPath, persistProviderPause: true,
      now: () => Date.parse('2026-10-07T00:00:00Z'), fetchImpl: async () => { calls++; if (kind === 'network') throw Error('Injected offline failure'); return new Response('{}', { status: 429 }); } };
    const service = createAgentService(options);
    await assert.rejects(service.run(message)); assert.equal(calls, 1); assert.equal(service.status().paused, true);
    const saved = JSON.parse(await readFile(budgetPath)); assert.equal(saved.attempts, 1); assert.ok(saved.paused);
    const restarted = createAgentService({ ...options, now: () => Date.parse('2026-10-08T00:00:00Z') });
    assert.equal(restarted.status().paused, true);
    await assert.rejects(restarted.run(message), error => error.code === 'agent_provider_paused');
    assert.equal(calls, 1); assert.deepEqual(JSON.parse(await readFile(budgetPath)), saved);
  }
});

test('malformed saved public pause fails closed before a provider call', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-public-provider-corrupt-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const budgetPath = join(directory, 'budget.json'); let calls = 0;
  await writeFile(budgetPath, JSON.stringify({ schemaVersion: 1, day: '2026-10-07', attempts: 3, paused: { reason: 'unrecognized', at: 'invalid' } }));
  const agent = createAgentService({ programmeService: createProgrammeService(realShapeFixture()), apiKey: 'mock-key', budgetPath, persistProviderPause: true, fetchImpl: async () => { calls++; throw Error(); } });
  await assert.rejects(agent.run(message), error => error.code === 'agent_budget_unavailable'); assert.equal(calls, 0);
});

test('failed public pause persistence leaves a restart-blocking interaction lock without another provider attempt', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-public-pause-write-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const budgetPath = join(directory, 'budget.json'); let calls = 0;
  const options = { programmeService: createProgrammeService(realShapeFixture()), apiKey: 'mock-key', budgetPath, persistProviderPause: true,
    fetchImpl: async () => { calls++; return new Response('{}', { status: 429 }); },
    pauseWriter: () => { throw Error('Injected disk write failure'); } };
  await assert.rejects(createAgentService(options).run(message), error => error.code === 'agent_budget_unavailable');
  assert.equal(calls, 1); assert.equal(JSON.parse(await readFile(budgetPath)).attempts, 1);
  const restarted = createAgentService(options); assert.equal(restarted.status().busy, true);
  await assert.rejects(restarted.run(message), error => error.code === 'agent_busy'); assert.equal(calls, 1);
});

test('every custom evidence HTTP route rejects guests before reading private evidence or invoking a service', async t => {
  let privateReads = 0; const calls = [];
  const tasteService = { completed: async () => { privateReads++; throw Error('Must never read private evidence'); },
    search: () => { privateReads++; }, select: () => { privateReads++; }, rankNext: () => { privateReads++; } };
  const { port } = await serve(t, { tasteService, agentService: fakeAgent(calls) });
  const evidenceId = 'private-evidence-for-http-test';
  for (const path of ['/api/programme', '/api/repair-options']) assert.equal((await post(port, path, { ...context, evidenceId })).status, 401);
  assert.equal((await post(port, '/api/agent', { ...message, evidenceId })).status, 401);
  assert.equal((await request(port, '/api/agent-status?evidenceId=' + evidenceId)).status, 401);
  assert.equal((await request(port, '/api/tastes/progress?evidenceId=' + evidenceId)).status, 401);
  for (const path of ['/api/tastes/search', '/api/tastes/select', '/api/tastes/rank']) assert.equal((await post(port, path, {})).status, 401);
  const payload = { ...context, evidenceId, seasonName: 'Invented private HTTP test', approvedAt: '2026-10-07T00:00:00.000Z' };
  assert.equal((await request(port, '/api/programme-sheet?payload=' + encodeURIComponent(JSON.stringify(payload)))).status, 401);
  assert.equal(privateReads, 0); assert.equal(calls.length, 0);
});

test('owner Qloo actions and guest model actions share one durable public interaction lease', async t => {
  let finishSearch; const waiting = new Promise(done => { finishSearch = done; });
  let started; const entered = new Promise(done => { started = done; });
  const calls = [];
  const { port } = await serve(t, { agentService: fakeAgent(calls), tasteService: {
    search: async () => { started(); await waiting; return { qlooRequests: 0, source: 'mock' }; },
  } });
  const access = await request(port, '/api/access/status'); const cookie = access.headers['set-cookie'][0].split(';')[0];
  const active = post(port, '/api/tastes/search', { query: 'Invented Artist' }, { Authorization: `Bearer ${ownerToken}` });
  await entered;
  try {
    const denied = await post(port, '/api/agent', message, { Cookie: cookie });
    assert.equal(denied.status, 409); assert.equal(denied.json.code, 'access_busy'); assert.equal(calls.length, 0);
  } finally { finishSearch(); }
  assert.equal((await active).status, 200);
  assert.equal((await post(port, '/api/agent', message, { Cookie: cookie })).status, 200); assert.equal(calls.length, 1);
});


test('judge login routes privileged calls to the reserved pool without owner authority or guest depletion', async t => {
  const judgePassword = 'b'.repeat(64); // Fictional test credential, never deployed.
  const publicCalls = [], judgeCalls = [], tasteCalls = [];
  const evidenceId = 'rb-taste-' + '2'.repeat(32);
  const dataset = realShapeFixture(); dataset.dataset.id = evidenceId;
  const tastes = {
    status: async () => ({ injected: true }),
    search: async body => { tasteCalls.push(body); return { status: 'pending', qlooRequests: 0 }; },
    rankNext: async body => { tasteCalls.push(body); return { status: 'pending', qlooRequests: 0 }; },
    completed: async id => ({ evidenceId: id, dataset }),
  };
  const publicAgent = fakeAgent(publicCalls), judgeAgent = fakeAgent(judgeCalls);
  judgeAgent.status = () => ({ configured: true, maxRequestsPerDay: 240, remainingRequests: 240 });
  const { port } = await serve(t, { judgeUsername: 'judge', judgePassword, tasteService: tastes,
    agentService: publicAgent, judgeAgentService: judgeAgent, judgeAgentFactory: () => judgeAgent });
  const opened = await request(port, '/api/access/status');
  const guestCookie = opened.headers['set-cookie'][0].split(';')[0];
  assert.equal(opened.json.judgeSignInAvailable, true);
  assert.equal(opened.json.judgeAuthenticated, false);
  assert.equal((await post(port, '/api/access/judge', { username: 'judge', password: 'wrong' })).status, 401);
  assert.equal((await post(port, '/api/access/judge', { username: 'judge', password: judgePassword }, { Origin: 'https://wrong.example' })).status, 403);
  assert.equal((await post(port, '/api/access/owner', { token: judgePassword })).status, 401);
  assert.equal((await request(port, '/api/tastes/status', { headers: { Cookie: guestCookie } })).status, 401);
  for (let n = 0; n < 4; n++) assert.equal((await post(port, '/api/agent', message, { Cookie: guestCookie })).status, 200);
  assert.equal((await post(port, '/api/agent', message, { Cookie: guestCookie })).status, 429);
  const login = await post(port, '/api/access/judge', { username: 'judge', password: judgePassword });
  assert.equal(login.status, 200); assert.ok(!login.text.includes(judgePassword));
  assert.match(login.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/);
  const judgeCookie = login.headers['set-cookie'][0].split(';')[0];
  const cookies = guestCookie + '; ' + judgeCookie;
  const headers = { Cookie: cookies };
  const access = await request(port, '/api/access/status', { headers });
  assert.equal(access.json.judgeAuthenticated, true); assert.equal(access.json.ownerAuthenticated, false);
  assert.equal(access.json.guestRemainingInteractions, 0);
  assert.equal((await request(port, '/api/agent-status', { headers })).json.maxRequestsPerDay, 240);
  assert.equal((await request(port, '/api/tastes/status', { headers })).status, 200);
  for (let n = 0; n < 3; n++) {
    assert.equal((await post(port, '/api/tastes/search', { query: 'Invented artist' }, headers)).status, 200);
    assert.equal((await post(port, '/api/tastes/rank', { evidenceId }, headers)).status, 200);
  }
  for (let n = 0; n < 6; n++) assert.equal((await post(port, '/api/agent', message, headers)).status, 200);
  assert.equal((await post(port, '/api/agent', { ...message, evidenceId }, headers)).status, 200);
  assert.equal((await post(port, '/api/programme', { ...context, evidenceId }, headers)).status, 200);
  const payload = { ...context, current: dataset.films.slice(0,3).map(f => f.id), evidenceId,
    seasonName: 'Invented judge programme', organiserNote: '', approvedAt: '2030-01-01T00:00:00.000Z' };
  assert.equal((await request(port, '/api/programme-sheet?payload=' + encodeURIComponent(JSON.stringify(payload)), { headers })).status, 200);
  assert.equal((await request(port, '/api/access/status', { headers })).json.guestRemainingInteractions, 0);
  assert.equal(publicCalls.length, 4); assert.equal(judgeCalls.length, 7); assert.equal(tasteCalls.length, 6);
  const logout = await post(port, '/api/access/logout', {}, headers);
  assert.equal(logout.headers['set-cookie'].length, 2);
  assert.ok(logout.headers['set-cookie'].every(cookie => /Max-Age=0/.test(cookie)));
  assert.equal((await request(port, '/api/tastes/status')).status, 401);
});

test('exhausted public model allowance does not block judge status or interaction routing', async t => {
  const judgeCalls = [];
  const exhausted = { status: () => ({ configured: true, providerStatus: 'budget_exhausted', remainingRequests: 0 }),
    run: () => { throw Error('Exhausted public agent must not run'); } };
  const judges = fakeAgent(judgeCalls);
  const { port } = await serve(t, { judgeUsername: 'judge', judgePassword: 'b'.repeat(64),
    agentService: exhausted, judgeAgentService: judges });
  const guest = await request(port, '/api/access/status');
  const guestCookie = guest.headers['set-cookie'][0].split(';')[0];
  assert.equal((await post(port, '/api/agent', message, { Cookie: guestCookie })).status, 429);
  const login = await post(port, '/api/access/judge', { username: 'judge', password: 'b'.repeat(64) });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request(port, '/api/agent-status', { headers: { Cookie: cookie } })).json.configured, true);
  assert.equal((await post(port, '/api/agent', message, { Cookie: cookie })).status, 200);
  assert.equal(judgeCalls.length, 1);
});

test('configurable Qloo headroom preserves consumed attempts and forwards the same cap to the CLI guard', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-qloo-headroom-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const at = Date.parse('2030-01-01T12:00:00.000Z');
  const statePath = join(directory, 'qloo-request-state.json');
  await writeFile(statePath, JSON.stringify({ day: '2030-01-01', attempts: 60, lastAttemptAt: at - 60_000, paused: null }));
  let calls = 0;
  const blocked = createQlooRuntime({ guardDirectory: directory, dailyLimit: 12, now: () => at, execFileImpl: async () => { calls++; } });
  assert.equal((await blocked.status()).remainingRequests, 0);
  await assert.rejects(blocked.execute({ operation: 'search', query: 'Invented artist' }), error => error.code === 'qloo_daily_limit');
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).attempts, 60); assert.equal(calls, 0);
  for (const dailyLimit of [0,121,'60.5']) assert.throws(() => createQlooRuntime({ dailyLimit }), TypeError);
  await writeFile(statePath, JSON.stringify({ day: '2030-01-01', attempts: 12, lastAttemptAt: at - 60_000, paused: null }));
  const runtime = createQlooRuntime({ guardDirectory: directory, dailyLimit: 60, now: () => at,
    execFileImpl: async (executable,args,options) => {
      calls++; assert.equal(options.env.REELBALANCE_QLOO_DAILY_LIMIT, '60');
      await writeFile(statePath, JSON.stringify({ day: '2030-01-01', attempts: 13, lastAttemptAt: at, paused: null }));
      return { stdout: '[]' };
    } });
  assert.equal((await runtime.status()).dailyAttemptLimit, 60);
  assert.equal((await runtime.execute({ operation: 'search', query: 'Invented artist' })).qlooRequests, 1);
  assert.equal(calls, 1); assert.equal((await runtime.status()).remainingRequests, 47);
  await assert.rejects(runtime.execute({ operation: 'search', query: 'Invented artist' }), error => error.code === 'qloo_cooldown');
  assert.equal(calls, 1);
});

test('full public custom routes use the public pool, charge only fresh Qloo and preserve cached planning after live quotas', async t => {
  const evidenceId = 'rb-taste-' + '7'.repeat(32), calls = [], pools = [], agentPools = [];
  const custom = realShapeFixture(); custom.dataset.id = evidenceId;
  const packet = { schemaVersion: 1, evidenceId, status: 'complete', source: 'custom_taste', qlooRequests: 0,
    guard: { remainingRequests: 120, paused: null, busy: false } };
  const { port } = await serve(t, { publicCustomAccess: true, guestDailyLimit: 24, guestQlooDailyLimit: 2,
    judgeUsername: 'judge', judgePassword: 'b'.repeat(64),
    tasteFactory: ({ pool }) => {
      pools.push(pool);
      const guard = () => ({ pool, remainingRequests: pool === 'public' ? 120 : 60, paused: null, busy: false });
      return {
        status: async () => ({ liveEnabled: true, guard: guard(), knownArtists: { options: [] } }),
        search: async (body, { beforeLiveRequest }) => {
          if (body.query === 'Fresh artist') { await beforeLiveRequest(); calls.push(pool); }
          return { qlooRequests: body.query === 'Fresh artist' ? 1 : 0, guard: guard() };
        },
        select: async () => ({ ...packet, guard: guard() }),
        progress: async () => ({ ...packet, guard: guard() }),
        rankNext: async () => ({ ...packet, guard: guard() }),
        completed: async () => ({ evidenceId, dataset: custom, provenance: {} }),
      };
    }, agentFactory: (service, { pool }) => {
      agentPools.push(pool);
      return { status: () => ({ configured: true, remainingRequests: pool === 'public' ? 180 : 240 }),
        run: async () => ({ answer: 'Injected public access check.', llmRequests: 0 }) };
    },
  });
  assert.equal((await request(port, '/api/tastes/status')).status, 401, 'Cookie-less access receives no private session or provider permission.');
  const opened = await request(port, '/api/access/status');
  const cookie = opened.headers['set-cookie'][0].split(';')[0], headers = { Cookie: cookie };
  assert.equal(opened.json.publicCustomAccess, true); assert.equal(opened.json.guestRemainingInteractions, 24);
  assert.equal(opened.json.guestRemainingQlooRequests, 2);
  const artistStatus = await request(port, '/api/tastes/status', { headers });
  assert.equal(artistStatus.status, 200); assert.equal(artistStatus.json.guard.pool, 'public');
  assert.equal(artistStatus.json.guard.remainingRequests, 2); assert.equal(artistStatus.json.guard.poolRemainingRequests, 120);
  for (let n = 0; n < 2; n++) assert.equal((await post(port, '/api/tastes/search', { query: 'Fresh artist', live: true }, headers)).status, 200);
  const exhausted = await post(port, '/api/tastes/search', { query: 'Fresh artist', live: true }, headers);
  assert.equal(exhausted.status, 429); assert.equal(exhausted.json.code, 'guest_qloo_limit_reached');
  assert.equal(calls.length, 2);
  assert.equal((await request(port, '/api/access/status', { headers })).json.guestRemainingInteractions, 24);
  assert.equal((await post(port, '/api/tastes/search', { query: 'Saved artist' }, headers)).status, 200);
  assert.equal((await post(port, '/api/tastes/select', { artists: [] }, headers)).status, 200);
  assert.equal((await request(port, '/api/tastes/progress?evidenceId=' + evidenceId, { headers })).status, 200);
  assert.equal((await post(port, '/api/tastes/rank', { evidenceId, live: true }, headers)).status, 200, 'Completed rankings do not spend a fresh request.');
  const programme = await post(port, '/api/programme', { ...context, evidenceId }, headers);
  assert.equal(programme.status, 200);
  const approved = approveProposal(receiveProposal(createState(custom), { result: programme.json }, 0));
  const sheet = await request(port, '/api/programme-sheet?payload=' + encodeURIComponent(JSON.stringify({ ...context,
    evidenceId, current: approved.approved.selection, seasonName: 'Public custom check', approvedAt: approved.approved.approvedAt })), { headers });
  assert.equal(sheet.status, 200); assert.match(sheet.text, /Public custom check/);
  assert.equal((await post(port, '/api/agent', { ...message, evidenceId }, headers)).status, 200);
  assert.deepEqual(agentPools, ['public']); assert.deepEqual(pools, ['public']);
  const afterPublic = (await request(port, '/api/access/status', { headers })).json;
  assert.equal(afterPublic.guestRemainingInteractions, 23); assert.equal(afterPublic.guestRemainingQlooRequests, 0);
  const login = await post(port, '/api/access/judge', { username: 'judge', password: 'b'.repeat(64) });
  const judgeHeaders = { Cookie: cookie + '; ' + login.headers['set-cookie'][0].split(';')[0] };
  const judgeStatus = await request(port, '/api/tastes/status', { headers: judgeHeaders });
  assert.equal(judgeStatus.json.guard.pool, 'judge'); assert.equal(judgeStatus.json.guard.remainingRequests, 60);
  assert.equal((await post(port, '/api/tastes/search', { query: 'Fresh artist', live: true }, judgeHeaders)).status, 200);
  assert.equal((await post(port, '/api/agent', { ...message, evidenceId }, judgeHeaders)).status, 200);
  assert.deepEqual(calls, ['public', 'public', 'judge']); assert.deepEqual(agentPools, ['public', 'judge']);
  const afterJudge = (await request(port, '/api/access/status', { headers })).json;
  assert.equal(afterJudge.guestRemainingInteractions, 23); assert.equal(afterJudge.guestRemainingQlooRequests, 0);
});

test('invalid public assistant bodies cannot spend a browser interaction or mark an unused session as used', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reelbalance-invalid-public-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let providerCalls = 0;
  const agent = createAgentService({ programmeService: createProgrammeService(realShapeFixture()), apiKey: 'mock-key',
    budgetPath: join(directory, 'usage.json'), fetchImpl: async () => { providerCalls++; throw Error('No provider request expected'); } });
  const { port } = await serve(t, { publicCustomAccess: true, guestDailyLimit: 24, agentService: agent });
  const opened = await request(port, '/api/access/status');
  const headers = { Cookie: opened.headers['set-cookie'][0].split(';')[0] };
  const invalid = await post(port, '/api/agent', { message: '', context }, headers);
  assert.equal(invalid.status, 400); assert.equal(invalid.json.code, 'agent_invalid_request');
  assert.equal((await request(port, '/api/access/status', { headers })).json.guestRemainingInteractions, 24);
  assert.equal(providerCalls, 0);
  await assert.rejects(readFile(join(directory, 'usage.json')), { code: 'ENOENT' });
});
