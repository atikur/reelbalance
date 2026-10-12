import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createProgrammeService, loadDemoDataset, ProgrammeInputError } from './programme-service.mjs';
import { createAgentService, AgentError, OPENAI_DEFAULT_DAILY_LIMIT } from './agent-service.mjs';
import { createDemoService, loadRecordedDemo, DemoRecordingError } from './demo-service.mjs';
import { createTasteService } from './taste-service.mjs';
import { createPublicAccess } from './public-access.mjs';
import { createState, makeSheetHtml } from './public/state.js';

const BODY_LIMIT = 16 * 1024;
const SHEET_KEYS = new Set(['slots', 'maximumRuntime', 'excluded', 'locked', 'current', 'seasonName', 'organiserNote', 'approvedAt', 'source', 'evidenceId']);
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/state.js', ['state.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

function send(response, status, body, type = 'application/json; charset=utf-8', extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    ...extraHeaders,
  });
  response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    let rejected = false;
    const chunks = [];
    request.on('data', chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        rejected = true;
        reject(Object.assign(new Error('JSON body exceeds 16 KiB.'), { status: 413, code: 'body_too_large' }));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ProgrammeInputError('Request body must be valid JSON.')); }
    });
    request.on('error', () => reject(new ProgrammeInputError('Request body could not be read.')));
  });
}

function requireAgentAvailable(status) {
  if (status?.configured !== true) {
    throw new AgentError('The live assistant is not configured. Cached planning remains available.', { status: 503, code: 'agent_not_configured' });
  }
  if (status.paused || status.providerStatus === 'paused') {
    throw new AgentError('Model requests are paused for operator review. Cached planning remains available.', { status: 503, code: 'agent_provider_paused' });
  }
  if (status.providerStatus === 'budget_unavailable') {
    throw new AgentError('The saved model-request allowance could not be verified. No model request was sent.', { status: 503, code: 'agent_budget_unavailable' });
  }
  if (status.remainingRequests === 0 || status.providerStatus === 'budget_exhausted') {
    throw new AgentError('The shared daily model-request allowance is used. Cached planning remains available.', { status: 429, code: 'agent_budget_exhausted' });
  }
  if (status.busy || status.operatorReviewRequired || status.providerStatus === 'busy') {
    throw new AgentError('An assistant interaction or operator review is in progress. No model request was sent.', { status: 409, code: 'agent_busy' });
  }
}

export function validateAppOrigin(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('APP_ORIGIN must be one canonical HTTPS origin.');
  let origin;
  try { origin = new URL(value); }
  catch { throw new TypeError('APP_ORIGIN must be one canonical HTTPS origin.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (value !== origin.origin || origin.hostname.includes('*') || origin.username || origin.password || origin.search || origin.hash ||
      !(origin.protocol === 'https:' || (origin.protocol === 'http:' && loopback))) {
    throw new TypeError('APP_ORIGIN must be one canonical HTTPS origin; HTTP is allowed only for loopback.');
  }
  return origin.origin;
}

export function validateServerHost(value = '127.0.0.1') {
  if (!['127.0.0.1', '0.0.0.0'].includes(value)) throw new TypeError('HOST must be 127.0.0.1 or explicitly 0.0.0.0 for a container.');
  return value;
}

async function renderProgrammeSheet(getService, requestUrl) {
  if (Buffer.byteLength(requestUrl, 'utf8') > BODY_LIMIT) {
    throw Object.assign(new Error('Programme-sheet URL exceeds 16 KiB.'), { status: 414, code: 'url_too_large' });
  }
  const parameters = new URL(requestUrl, 'http://127.0.0.1').searchParams;
  if ([...parameters.keys()].some(key => key !== 'payload') || parameters.getAll('payload').length !== 1) {
    throw new ProgrammeInputError('Include exactly one programme-sheet payload.');
  }
  const rawPayload = parameters.get('payload');
  if (Buffer.byteLength(rawPayload, 'utf8') > BODY_LIMIT) throw new ProgrammeInputError('Programme-sheet payload exceeds 16 KiB.');
  let payload;
  try { payload = JSON.parse(rawPayload); }
  catch { throw new ProgrammeInputError('Programme-sheet payload must be valid JSON.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !SHEET_KEYS.has(key))) {
    throw new ProgrammeInputError('Programme-sheet payload contains unsupported fields.');
  }
  if (typeof payload.seasonName !== 'string' || !payload.seasonName.trim() || payload.seasonName.length > 80) {
    throw new ProgrammeInputError('Season name must contain from 1 to 80 characters.');
  }
  if (payload.organiserNote !== undefined && (typeof payload.organiserNote !== 'string' || payload.organiserNote.length > 800)) {
    throw new ProgrammeInputError('Organiser note must be text with at most 800 characters.');
  }
  if (typeof payload.approvedAt !== 'string' || !Number.isFinite(Date.parse(payload.approvedAt)) ||
      new Date(payload.approvedAt).toISOString() !== payload.approvedAt) {
    throw new ProgrammeInputError('Approval timestamp must be a canonical ISO date and time.');
  }
  if (payload.source !== undefined && payload.source !== 'recorded') throw new ProgrammeInputError('Programme-sheet source must be recorded when supplied.');
  const evidenceId = evidenceIdentifier(payload.evidenceId);
  if (evidenceId && payload.source === 'recorded') throw new ProgrammeInputError('A recorded example cannot use custom taste evidence.');
  const service = await getService(evidenceId);
  if (service.bootstrap().dataset.synthetic && payload.source === 'recorded') throw new ProgrammeInputError('An invented setup example cannot claim a recorded model response.');
  const planning = Object.fromEntries(['slots', 'maximumRuntime', 'excluded', 'locked', 'current']
    .filter(key => Object.hasOwn(payload, key)).map(key => [key, payload[key]]));
  service.programme(planning); // Reuse strict ID, count and numeric validation without applying its proposal.
  const state = {
    ...createState(service.bootstrap()), ...planning, evidenceId,
    excluded: planning.excluded ?? [], locked: planning.locked ?? [],
    seasonName: payload.seasonName, organiserNote: payload.organiserNote ?? '',
    approved: { selection: planning.current ?? [], approvedAt: payload.approvedAt, ...(payload.source === 'recorded' ? { source: 'recorded' } : {}) },
  };
  try { return makeSheetHtml(state); }
  catch (error) { throw new ProgrammeInputError(error.message); }
}

function evidenceIdentifier(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,96}$/.test(value)) throw new ProgrammeInputError('Use a valid completed taste-evidence ID.');
  return value;
}

function queryEvidenceId(requestUrl) {
  const parameters = new URL(requestUrl, 'http://127.0.0.1').searchParams;
  if ([...parameters.keys()].some(key => key !== 'evidenceId') || parameters.getAll('evidenceId').length > 1) {
    throw new ProgrammeInputError('Include at most one taste-evidence ID.');
  }
  return evidenceIdentifier(parameters.has('evidenceId') ? parameters.get('evidenceId') : undefined);
}

function separateEvidence(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { evidenceId: null, body };
  const { evidenceId, ...payload } = body;
  return { evidenceId: evidenceIdentifier(evidenceId), body: payload };
}

export function requireLocalTasteAccess(remoteAddress) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress)) {
    throw Object.assign(new Error('Custom taste evidence is available only to the local organiser.'), { status: 403, code: 'owner_required' });
  }
}

export async function createServer({ dataset, datasetPath, agentService, agentFactory, tasteService, tasteFactory, qlooLive = false,
  openAiApiKey = process.env.OPENAI_API_KEY, openAiDailyLimit = process.env.REELBALANCE_OPENAI_DAILY_LIMIT,
  openAiJudgeDailyLimit = process.env.REELBALANCE_OPENAI_JUDGE_DAILY_LIMIT ?? 240,
  judgeAgentService, judgeAgentFactory, judgeUsername, judgePassword,
  publicCustomAccess = false, guestDailyLimit = 4, guestQlooDailyLimit = 12,
  accessMode = 'local', ownerToken, accessLedgerPath, accessService,
  recording, recordingPath, appOrigin, publicDirectory = new URL('./public/', import.meta.url) } = {}) {
  const configuredOrigin = validateAppOrigin(appOrigin);
  const service = createProgrammeService(dataset ?? await loadDemoDataset(datasetPath));
  const synthetic = service.bootstrap().dataset.synthetic === true;
  if (accessMode === 'public' && !configuredOrigin?.startsWith('https://')) throw new TypeError('Public mode requires one exact HTTPS APP_ORIGIN.');
  const access = accessService ?? createPublicAccess({ mode: accessMode, origin: configuredOrigin,
    ownerToken, judgeUsername, judgePassword, publicCustomAccess, guestDailyLimit, guestQlooDailyLimit,
    ...(accessLedgerPath ? { ledgerPath: accessLedgerPath } : {}) });
  if (qlooLive && accessMode === 'public' && !ownerToken) throw new TypeError('Public live Qloo access requires REELBALANCE_OWNER_TOKEN.');
  const credentials = request => ({ authorization: request.headers.authorization, cookieHeader: request.headers.cookie });
  const requireCustomAccess = request => {
    if (accessMode === 'local') requireLocalTasteAccess(request.socket.remoteAddress);
    return access.requireCustomAccess(credentials(request));
  };
  const requireGenuine = () => {
    if (synthetic) throw Object.assign(new Error('This is an invented setup example. Privately provision genuine Qloo evidence to enable the agent, artist retrieval and recordings.'), { status: 503, code: 'synthetic_mode' });
  };
  let agent = agentService;
  let judgeAgent = judgeAgentService;
  const judgePoolEnabled = Boolean(judgePassword || judgeAgentService || judgeAgentFactory);
  const sharedProviderState = { paused: null };
  const providerPausePath = new URL('../.cache/openai-usage.json', import.meta.url);
  const makeAgent = (programmeService, pool) => {
    const factory = pool === 'judge' ? judgeAgentFactory ?? agentFactory : agentFactory;
    if (factory) return factory(programmeService, { pool });
    return createAgentService({ programmeService, apiKey: openAiApiKey,
      dailyLimit: pool === 'judge' ? openAiJudgeDailyLimit : openAiDailyLimit,
      budgetPath: pool === 'judge' ? new URL('../.cache/openai-judge-usage.json', import.meta.url) : providerPausePath,
      providerPausePath, providerState: sharedProviderState,
      persistProviderPause: accessMode === 'public' });
  };
  const customAgents = new Map();
  const tastePromises = new Map();
  const requestPool = request => accessMode === 'public' && access.role(credentials(request)) === 'guest' ? 'public' : 'judge';
  const getTaste = request => {
    const pool = request ? requestPool(request) : 'judge';
    if (!tastePromises.has(pool)) tastePromises.set(pool, Promise.resolve(tasteService ??
      (tasteFactory ? tasteFactory({ pool }) : createTasteService({ baseDataset: service.bootstrap(), liveEnabled: qlooLive, pool }))));
    return tastePromises.get(pool);
  };
  const tasteGuard = async (packet, request) => {
    if (!packet?.guard || requestPool(request) !== 'public') return packet;
    const browser = await access.status(credentials(request));
    if (browser.publicCustomAccess !== true) return packet;
    return { ...packet, guard: { ...packet.guard,
      poolRemainingRequests: packet.guard.remainingRequests,
      guestMaxQlooRequestsPerDay: browser.guestMaxQlooRequestsPerDay,
      guestRemainingQlooRequests: browser.guestRemainingQlooRequests,
      remainingRequests: Number.isInteger(browser.guestRemainingQlooRequests)
        ? Math.min(packet.guard.remainingRequests, browser.guestRemainingQlooRequests) : 0 } };
  };
  const getService = async (evidenceId, request) => {
    if (!evidenceId) return service;
    const packet = await (await getTaste(request)).completed(evidenceId);
    if (packet.evidenceId !== evidenceId || packet.dataset?.dataset?.id !== evidenceId) throw new ProgrammeInputError('The taste evidence could not be verified.');
    return createProgrammeService(packet.dataset);
  };
  const getAgent = async (evidenceId, request) => {
    const pool = judgePoolEnabled && access.role(credentials(request)) !== 'guest' ? 'judge' : 'public';
    if (!evidenceId) return pool === 'judge' ? judgeAgent ??= makeAgent(service, pool) : agent ??= makeAgent(service, pool);
    // Always revalidate the server-held evidence, including when the bound agent is cached.
    const programmeService = await getService(evidenceId, request);
    const cacheKey = `${pool}:${evidenceId}:${createHash('sha256').update(JSON.stringify(programmeService.bootstrap())).digest('hex')}`;
    if (!customAgents.has(cacheKey)) {
      if (customAgents.size >= 24) customAgents.delete(customAgents.keys().next().value);
      customAgents.set(cacheKey, makeAgent(programmeService, pool));
    }
    return customAgents.get(cacheKey);
  };
  const tastePacket = async (packet, request) => {
    if (packet.status !== 'complete') return packet;
    const completed = await (await getTaste(request)).completed(packet.evidenceId);
    return { ...packet, dataset: createProgrammeService(completed.dataset).bootstrap(), provenance: completed.provenance, source: 'custom_taste' };
  };
  let demo;
  let recordedAvailable = false;
  try { if (synthetic) throw new DemoRecordingError(); demo = createDemoService({ programmeService: service, recording: recording ?? await loadRecordedDemo(recordingPath) }); }
  catch { demo = { scenarios: () => { throw new DemoRecordingError(); } }; }
  try { demo.scenarios(); recordedAvailable = true; } catch {}
  const publicPath = publicDirectory instanceof URL ? fileURLToPath(publicDirectory) : resolve(publicDirectory);
  const server = createHttpServer({ maxHeaderSize: 32 * 1024 }, async (request, response) => {
    try {
      // Exact path matching deliberately avoids normalization of traversal paths.
      const path = (request.url ?? '').split('?')[0];
      if (path === '/api/access/status') {
        if (request.method !== 'GET') return send(response, 405, { error: 'Use GET for access status.', code: 'method_not_allowed' }, undefined, { Allow: 'GET' });
        const packet = await access.status({ cookieHeader: request.headers.cookie, authorization: request.headers.authorization });
        let session = {};
        try { if (!synthetic && !packet.ownerAuthenticated && !packet.judgeAuthenticated) session = await access.guestSession({ cookieHeader: request.headers.cookie }); }
        catch (error) {
          if (!((error.status === 429 && error.code === 'access_session_rate_limit') ||
                (error.status === 503 && error.code === 'access_session_limit'))) throw error;
          return send(response, error.status, { ...packet, synthetic, recordedAvailable, error: error.message, code: error.code }, undefined,
            Number.isInteger(error.retryAfterSeconds) && error.retryAfterSeconds > 0 ? { 'Retry-After': String(error.retryAfterSeconds) } : {});
        }
        return send(response, 200, { ...packet,
          ...(session.setCookie ? { guestRemainingInteractions: session.guestRemainingInteractions,
            ...(session.publicCustomAccess ? { guestRemainingQlooRequests: session.guestRemainingQlooRequests } : {}) } : {}),
          synthetic, recordedAvailable }, undefined, session.setCookie ? { 'Set-Cookie': session.setCookie } : {});
      }
      if (path === '/api/bootstrap') {
        if (request.method !== 'GET') return send(response, 405, { error: 'Use GET for bootstrap.', code: 'method_not_allowed' }, undefined, { Allow: 'GET' });
        return send(response, 200, service.bootstrap());
      }
      if (path === '/api/demo-scenarios') {
        if (request.method !== 'GET') return send(response, 405, { error: 'Use GET for recorded scenarios.', code: 'method_not_allowed' }, undefined, { Allow: 'GET' });
        requireGenuine();
        return send(response, 200, demo.scenarios());
      }
      if (path === '/api/agent-status') {
        if (request.method !== 'GET') return send(response, 405, { error: 'Use GET for assistant status.', code: 'method_not_allowed' }, undefined, { Allow: 'GET' });
        const evidenceId = queryEvidenceId(request.url);
        if (synthetic) return send(response, 200, { model: 'gpt-6-luna', configured: false, providerStatus: 'synthetic_mode', synthetic: true, qlooRequests: 0 });
        if (evidenceId) requireCustomAccess(request);
        return send(response, 200, await (await getAgent(evidenceId, request)).status());
      }
      if (path === '/api/tastes/status' || path === '/api/tastes/progress') {
        if (request.method !== 'GET') return send(response, 405, { error: 'Use GET for taste status.', code: 'method_not_allowed' }, undefined, { Allow: 'GET' });
        requireGenuine();
        requireCustomAccess(request);
        const tastes = await getTaste(request);
        if (path === '/api/tastes/status') {
          if (request.url.includes('?')) throw new ProgrammeInputError('Taste status takes no parameters.');
          return send(response, 200, await tasteGuard(await tastes.status(), request));
        }
        const evidenceId = queryEvidenceId(request.url);
        if (!evidenceId) throw new ProgrammeInputError('Include a taste-evidence ID.');
        return send(response, 200, await tasteGuard(await tastePacket(await tastes.progress({ evidenceId }), request), request));
      }
      if (path === '/api/programme-sheet') {
        if (request.method !== 'GET') return send(response, 405, { error: 'Use GET for the programme sheet.', code: 'method_not_allowed' }, undefined, { Allow: 'GET' });
        return send(response, 200, await renderProgrammeSheet(evidenceId => {
          if (evidenceId) requireCustomAccess(request);
          return getService(evidenceId, request);
        }, request.url), 'text/html; charset=utf-8', {
          'Content-Disposition': 'attachment; filename="reelbalance-programme.html"',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        });
      }
      if (['/api/programme', '/api/repair-options', '/api/agent', '/api/tastes/search', '/api/tastes/select', '/api/tastes/rank', '/api/access/owner', '/api/access/judge', '/api/access/logout'].includes(path)) {
        if (request.method !== 'POST') return send(response, 405, { error: 'Use POST for planning tools.', code: 'method_not_allowed' }, undefined, { Allow: 'POST' });
        const origin = request.headers.origin;
        const allowedOrigins = accessMode === 'public' ? [configuredOrigin] : [`http://127.0.0.1:${request.socket.localPort}`, `http://localhost:${request.socket.localPort}`, ...(configuredOrigin ? [configuredOrigin] : [])];
        if (origin && !allowedOrigins.includes(origin)) return send(response, 403, { error: 'Only the configured app may use planning tools.', code: 'origin_not_allowed' });
        if (accessMode === 'public') access.requireOrigin(origin);
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
          return send(response, 415, { error: 'Use Content-Type: application/json.', code: 'unsupported_media_type' });
        }
        if (Number(request.headers['content-length']) > BODY_LIMIT) {
          request.resume();
          return send(response, 413, { error: 'JSON body exceeds 16 KiB.', code: 'body_too_large' });
        }
        const body = await readJson(request);
        if (path === '/api/access/owner') {
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'token') || typeof body.token !== 'string' || body.token.length > 256) throw new ProgrammeInputError('Enter only the owner access token.');
          const cookie = access.ownerCookie({ authorization: `Bearer ${body.token}`, originHeader: origin });
          return send(response, 200, { ownerAuthenticated: true }, undefined, { 'Set-Cookie': cookie });
        }
        if (path === '/api/access/judge') {
          if (!body || typeof body !== 'object' || Array.isArray(body) ||
              Object.keys(body).length !== 2 || !Object.hasOwn(body, 'username') || !Object.hasOwn(body, 'password') ||
              typeof body.username !== 'string' || body.username.length > 80 ||
              typeof body.password !== 'string' || body.password.length > 256) throw new ProgrammeInputError('Enter a judge username and password.');
          const cookie = access.judgeCookie({ username: body.username, password: body.password, originHeader: origin });
          return send(response, 200, { judgeAuthenticated: true, ownerAuthenticated: false }, undefined, { 'Set-Cookie': cookie });
        }
        if (path === '/api/access/logout') {
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new ProgrammeInputError('Logout takes an empty JSON object.');
          return send(response, 200, { ownerAuthenticated: false, judgeAuthenticated: false }, undefined, { 'Set-Cookie': [access.logoutOwnerCookie(), access.logoutJudgeCookie()] });
        }
        if (path.startsWith('/api/tastes/')) {
          requireGenuine();
          requireCustomAccess(request);
          const tastes = await getTaste(request);
          if (path === '/api/tastes/search' || path === '/api/tastes/rank') {
            const grant = await access.beginGuestInteraction({ cookieHeader: request.headers.cookie,
              authorization: request.headers.authorization, originHeader: origin, kind: 'qloo', count: false });
            let packet;
            const beforeLiveRequest = () => access.reserveGuestQlooRequest({ ...credentials(request), originHeader: origin });
            try { packet = path === '/api/tastes/search' ? await tastes.search(body, { beforeLiveRequest }) :
              await tastePacket(await tastes.rankNext(body, { beforeLiveRequest }), request); }
            finally { await grant.finish(); }
            return send(response, 200, await tasteGuard(packet, request));
          }
          return send(response, 200, await tasteGuard(await tastePacket(await tastes.select(body), request), request));
        }
        const selection = separateEvidence(body);
        if (selection.evidenceId) requireCustomAccess(request);
        if (path === '/api/agent') {
          requireGenuine();
          const activeAgent = await getAgent(selection.evidenceId, request);
          activeAgent.validate?.(selection.body);
          // Read local availability before spending a guest interaction. run() still
          // acquires its durable guards and reserves provider attempts after this check.
          requireAgentAvailable(await activeAgent.status());
          const grant = await access.beginGuestInteraction({ cookieHeader: request.headers.cookie,
            authorization: request.headers.authorization, originHeader: origin });
          let result;
          try { result = await activeAgent.run(selection.body); }
          finally { await grant.finish(); }
          return send(response, 200, result);
        }
        const programmeService = await getService(selection.evidenceId, request);
        return send(response, 200, path === '/api/programme' ? programmeService.programme(selection.body) : programmeService.repairOptions(selection.body));
      }
      const file = STATIC_FILES.get(path);
      if (!file) return send(response, 404, { error: 'Route not found.', code: 'not_found' });
      if (!['GET', 'HEAD'].includes(request.method)) return send(response, 405, { error: 'Use GET for app files.', code: 'method_not_allowed' }, undefined, { Allow: 'GET, HEAD' });
      let content;
      try { content = await readFile(resolve(publicPath, file[0])); }
      catch (error) {
        if (error.code === 'ENOENT') return send(response, 404, { error: 'App file not found.', code: 'not_found' });
        throw error;
      }
      return send(response, 200, request.method === 'HEAD' ? '' : content, file[1]);
    } catch (error) {
      const status = error instanceof ProgrammeInputError ? 400 : error.status ?? 500;
      return send(response, status, {
        error: status === 500 ? 'The local tool could not complete the request.' : error.message,
        code: status === 500 ? 'internal_error' : error.code ?? 'invalid_request',
      }, undefined, Number.isInteger(error.retryAfterSeconds) && error.retryAfterSeconds > 0
        ? { 'Retry-After': String(error.retryAfterSeconds) } : {});
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

export async function startServer({ environment = process.env,
  datasetPath = environment.REELBALANCE_DATASET_PATH || undefined,
  recordingPath = environment.REELBALANCE_RECORDING_PATH || undefined } = {}) {
  const port = Number(environment.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const host = validateServerHost(environment.HOST ?? '127.0.0.1');
  const accessMode = environment.REELBALANCE_ACCESS_MODE ?? (host === '0.0.0.0' ? 'public' : 'local');
  if (!['local', 'public'].includes(accessMode) || (host === '0.0.0.0' && accessMode !== 'public')) throw new Error('HOST=0.0.0.0 requires public access mode.');
  const qlooLive = environment.REELBALANCE_QLOO_LIVE === '1';
  if (environment.REELBALANCE_PUBLIC_CUSTOM !== undefined && !['0', '1'].includes(environment.REELBALANCE_PUBLIC_CUSTOM)) throw new TypeError('REELBALANCE_PUBLIC_CUSTOM must be 0 or 1.');
  const server = await createServer({ appOrigin: environment.APP_ORIGIN, qlooLive, accessMode, ownerToken: environment.REELBALANCE_OWNER_TOKEN,
    judgeUsername: environment.REELBALANCE_JUDGE_USERNAME, judgePassword: environment.REELBALANCE_JUDGE_PASSWORD,
    publicCustomAccess: environment.REELBALANCE_PUBLIC_CUSTOM === '1',
    guestDailyLimit: environment.REELBALANCE_GUEST_DAILY_LIMIT ?? 4,
    guestQlooDailyLimit: environment.REELBALANCE_GUEST_QLOO_DAILY_LIMIT ?? 12,
    openAiJudgeDailyLimit: environment.REELBALANCE_OPENAI_JUDGE_DAILY_LIMIT ?? 240,
    openAiApiKey: environment.OPENAI_API_KEY ?? '', openAiDailyLimit: environment.REELBALANCE_OPENAI_DAILY_LIMIT ?? OPENAI_DEFAULT_DAILY_LIMIT,
    datasetPath, recordingPath });
  await new Promise((ready, reject) => {
    const failed = error => reject(error);
    server.once('error', failed);
    server.listen(port, host, () => { server.off('error', failed); ready(); });
  });
  const shutdown = () => server.close(() => process.exit(0));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
  server.once('close', () => { for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, shutdown); });
  console.log(`ReelBalance is ready at http://${host}:${port} (${accessMode} access; live artist collection ${qlooLive ? environment.REELBALANCE_PUBLIC_CUSTOM === '1' ? 'enabled for explicit public and judge actions' : 'enabled for explicit authenticated actions' : 'disabled'}).`);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await startServer(); }
  catch { console.error('The local app could not start. Check Node.js, server settings and the runtime configuration.'); process.exitCode = 1; }
}
