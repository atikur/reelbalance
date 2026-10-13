import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as reducers from './public/state.js';
import * as persistence from './public/persistence.js';
import * as replacement from './public/replacement.js';
import { createProgrammeService } from './programme-service.mjs';

const [appSource, pageSource, fixtureText] = await Promise.all([
  readFile(new URL('./public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('./public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../release/synthetic-data.json', import.meta.url), 'utf8'),
]);
// Fictional fixtures exercise the live UI branch. Every server response below is
// injected; this harness cannot contact the application or an external provider.
const fixture = JSON.parse(fixtureText);
fixture.dataset.synthetic = false;
fixture.dataset.source = 'Injected fictional UI-test evidence';
const service = createProgrammeService(fixture);
const ready = { configured: true, model: 'mock', providerStatus: 'ready', paused: false,
  busy: false, operatorReviewRequired: false, remainingRequests: 36, maxRequestsPerDay: 36 };
const access = { mode: 'public', ownerAuthenticated: true, ownerSignInAvailable: true,
  guestMaxInteractionsPerDay: 4, guestRemainingInteractions: null, recordedAvailable: false };
const publicAccess = { ...access, ownerAuthenticated: false, judgeAuthenticated: false, judgeSignInAvailable: true,
  publicCustomAccess: true, guestMaxInteractionsPerDay: 24, guestRemainingInteractions: 24,
  guestMaxQlooRequestsPerDay: 12, guestRemainingQlooRequests: 12 };
const decode = value => value.replace(/&(?:amp|lt|gt|quot|#39);/g,
  entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]);

// A small DOM adapter, limited to selectors and control APIs used by app.js.
// It parses actual rendered markup, so disabled controls, dataset values, text
// escaping and focus assertions come from the production renderer and handlers.
class Element {
  constructor(tag, attributes = {}, document, parent = null) {
    this.tagName = tag.toUpperCase(); this.attributes = attributes;
    this.document = document; this.parentElement = parent; this.children = [];
    this.listeners = new Map(); this.value = attributes.value ?? '';
    this.selectionStart = null; this._text = ''; this._html = '';
  }
  get id() { return this.attributes.id ?? ''; }
  get type() { return this.attributes.type ?? ''; }
  get dataset() { return Object.fromEntries(Object.entries(this.attributes)
    .filter(([key]) => key.startsWith('data-'))
    .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])); }
  get disabled() { return Object.hasOwn(this.attributes, 'disabled'); }
  set disabled(value) { value ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }
  get classList() {
    const values = () => (this.attributes.class ?? '').split(/\s+/).filter(Boolean);
    return { contains: value => values().includes(value), toggle: (value, force) => {
      const current = new Set(values()); const enabled = force ?? !current.has(value);
      enabled ? current.add(value) : current.delete(value); this.attributes.class = [...current].join(' ');
    } };
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(value) { this._html = value; this._text = ''; this.children = []; parse(value, this); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector) {
    const attributes = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g, '');
    const tag = plain.match(/^[\w-]+/)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if ([...plain.matchAll(/#([\w-]+)/g)].some(([, id]) => this.id !== id)) return false;
    if ([...plain.matchAll(/\.([\w-]+)/g)].some(([, value]) => !this.classList.contains(value))) return false;
    return attributes.every(([, key, value]) => Object.hasOwn(this.attributes, key) &&
      (value === undefined || this.attributes[key] === value));
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(value => value.trim().split(/\s+/));
    const found = [];
    const matches = (node, parts) => {
      if (!node.matches(parts.at(-1))) return false;
      let parent = node.parentElement;
      for (let index = parts.length - 2; index >= 0; index--) {
        while (parent && !parent.matches(parts[index])) parent = parent.parentElement;
        if (!parent) return false; parent = parent.parentElement;
      }
      return true;
    };
    const visit = node => { for (const child of node.children) {
      if (selectors.some(parts => matches(child, parts))) found.push(child); visit(child);
    } };
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  addEventListener(kind, listener) { this.listeners.set(kind, [...this.listeners.get(kind) ?? [], listener]); }
  focus(options = {}) { this.document.activeElement = this; this.document.focusEvents.push({ node: this, options }); }
  setSelectionRange(start) { this.selectionStart = start; }
  scrollIntoView() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
}
function parse(html, parent) {
  const stack = [parent];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr']);
  for (const token of html.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (token.startsWith('<')) {
      const [, tag, rest] = token.match(/^<([\w-]+)([\s\S]*)>$/) ?? [];
      if (!tag) continue;
      const attributes = Object.fromEntries([...rest.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
        .map(([, key, double, single, bare]) => [key, decode(double ?? single ?? bare ?? '')]));
      const node = new Element(tag, attributes, parent.document, stack.at(-1));
      stack.at(-1).children.push(node);
      if (!voidTags.has(tag.toLowerCase()) && !token.endsWith('/>')) stack.push(node);
    } else { const node = stack.at(-1); node._text += decode(token); if (node.tagName === 'TEXTAREA') node.value += decode(token); }
  }
}
function makeDocument() {
  const document = { activeElement: null, focusEvents: [], listeners: new Map() };
  const root = new Element('document', {}, document); root.innerHTML = pageSource;
  document.querySelector = selector => root.querySelector(selector);
  document.querySelectorAll = selector => root.querySelectorAll(selector);
  document.getElementById = id => root.querySelector('#' + id);
  document.addEventListener = (kind, listener) => document.listeners.set(kind, [...document.listeners.get(kind) ?? [], listener]);
  return document;
}
async function harness({ status = ready, handlers = {}, storage = new Map() } = {}) {
  const document = makeDocument(); const requests = [];
  const fetch = async (path, options = {}) => {
    requests.push({ path, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });
    let packet;
    if (handlers[path]) packet = await handlers[path](requests.at(-1));
    else if (path === '/api/bootstrap') packet = fixture;
    else if (path === '/api/access/status') packet = access;
    else if (path === '/api/agent-status') packet = status;
    else throw Error('Unmocked request: ' + path);
    const { httpStatus = 200, ...body } = structuredClone(packet);
    return { ok: httpStatus >= 200 && httpStatus < 300, status: httpStatus, json: async () => body };
  };
  const imports = appSource.match(/^import\s*\{([\s\S]*?)\}\s*from\s*'\.\/state\.js';/);
  assert.ok(imports, 'app imports the real state reducers');
  const bindings = imports[1].replace(/\b(\w+)\s+as\s+(\w+)/g, '$1:$2');
  const code = appSource.replace(imports[0], `const {${bindings}}=__reducers;`)
    .replace(/import\s*\{([^}]+)\}\s*from\s*'\.\/persistence\.js';/, 'const {$1}=__persistence;')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'\.\/replacement\.js';/, 'const {$1}=__replacement;');
  const context = vm.createContext({ document, fetch, __reducers: reducers, structuredClone, AbortSignal,
    __persistence: persistence, __replacement: replacement,
    setTimeout: () => 1, clearTimeout: () => {}, window: { location: { reload() {} },
      localStorage: {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)} }, console });
  const bridge = await vm.runInContext(`(async()=>{${code}\nreturn {read:()=>structuredClone(state),flush:()=>saveWorkspace()};})()`, context);
  const dispatch = async (kind, target) => {
    assert.ok(target, 'action control exists');
    if (kind === 'click') { target.focus({ preventScroll: true }); if (target.disabled) return; }
    if (kind === 'input' && target.disabled) return;
    const event = { target, preventDefault() {} };
    for (const listener of document.listeners.get(kind) ?? []) await listener(event);
  };
  return { document, requests, storage, read: bridge.read, flush: bridge.flush,
    click: selector => dispatch('click', document.querySelector(selector)),
    input: async (selector, value) => { const node = document.querySelector(selector); assert.ok(node); node.value = value; await dispatch('input', node); },
  };
}

async function approvedCustomWorkspace(handlers = {}) {
  const evidenceId = 'rb-taste-' + '1'.repeat(32);
  const artists = fixture.profiles.map((profile, index) => ({ id: 'mock-artist-' + index, name: profile.reference, type: 'artist' }));
  const dataset = structuredClone(fixture); dataset.dataset.id = evidenceId;
  dataset.profiles.forEach((profile, index) => { profile.referenceEntityId = artists[index].id; });
  const packet = { schemaVersion: 1, evidenceId, status: 'complete', completedProfiles: 3,
    profileCount: 3, artists, source: 'custom_taste', dataset, qlooRequests: 0, guard: {} };
  const ui = await harness({ handlers: {
    '/api/tastes/status': () => ({ schemaVersion: 1, liveEnabled: false, guard: {},
      knownArtists: { searchId: 'mock-search', source: 'cached', options: artists } }),
    '/api/tastes/select': () => packet,
    ['/api/tastes/progress?evidenceId=' + evidenceId]: () => packet,
    ['/api/agent-status?evidenceId=' + evidenceId]: () => ready,
    '/api/programme': ({ body: { evidenceId: ignoredEvidenceId, ...request } }) => service.programme(request),
    ...handlers,
  } });
  await ui.click('[data-action="taste-open"]');
  for (let index = 0; index < 3; index++) await ui.click(`[data-action="taste-confirm"][data-index="${index}"][data-artist-id="${artists[index].id}"]`);
  await ui.click('[data-action="taste-select"]'); await ui.click('[data-action="taste-apply"]');
  await ui.click('[data-action="plan"]'); await ui.click('[data-action="approve"]');
  for (const id of ui.read().approved.selection.slice(0, 2)) await ui.click(`[data-action="lock"][data-id="${id}"]`);
  return ui;
}

function assertWorkspaceKept(ui, before) {
  assert.equal(ui.read().evidenceId, before.evidenceId);
  assert.deepEqual(ui.read().approved, before.approved);
  assert.deepEqual(ui.read().locked, before.locked);
  assert.deepEqual(ui.read().receipt, before.receipt);
}

test('reload restores approved order, locks, notes and unresolved cancellation without reviving a proposal or provider call',async()=>{
  const handlers={'/api/programme':({body})=>service.programme(body),'/api/repair-options':({body})=>service.repairOptions(body)};
  const ui=await harness({handlers});
  await ui.click('[data-action="plan"]');await ui.click('[data-action="approve"]');
  const approved=ui.read().approved;
  for(const id of approved.selection.slice(0,2))await ui.click(`[data-action="lock"][data-id="${id}"]`);
  await ui.input('#season-name','Saved fictional season');await ui.input('#organiser-note','Discuss the ending.');
  await ui.click(`[data-action="availability"][data-id="${approved.selection[2]}"]`);
  assert.ok(ui.read().proposal,'repair still pending');
  assert.ok(ui.document.querySelector('.replacement-reasons summary'),'replacement explanation is rendered');
  await ui.flush();
  const stored=ui.storage.get(persistence.STORAGE_KEY);
  const restored=await harness({storage:ui.storage,handlers});
  assert.deepEqual(restored.read().approved,approved);
  assert.deepEqual(restored.read().locked,approved.selection.slice(0,2));
  assert.deepEqual(restored.read().excluded,[approved.selection[2]]);
  assert.equal(restored.read().seasonName,'Saved fictional season');
  assert.equal(restored.read().organiserNote,'Discuss the ending.');
  assert.equal(restored.read().proposal,null);assert.equal(restored.read().busy,false);
  assert.equal(restored.document.querySelector('[data-action="export"]').disabled,true);
  assert.match(restored.document.querySelector('.programme-callout').textContent,/unavailable/);
  assert.equal(restored.requests.some(request=>request.method==='POST'),false);
  assert.equal(ui.storage.get(persistence.STORAGE_KEY),stored,'boot did not change the saved programme');
});

test('corrupt saved work is held until explicit reset and does not block manual planning',async()=>{
  const storage=new Map([[persistence.STORAGE_KEY,'{broken']]);
  const ui=await harness({storage,handlers:{'/api/programme':({body})=>service.programme(body)}});
  assert.ok(ui.document.querySelector('[data-action="workspace-discard"]'));
  await ui.click('[data-action="plan"]');await ui.click('[data-action="approve"]');await ui.flush();
  assert.ok(ui.read().approved);assert.equal(storage.get(persistence.STORAGE_KEY),'{broken');
  await ui.click('[data-action="workspace-discard"]');await ui.flush();
  assert.equal(ui.read().approved,null);assert.equal(ui.document.querySelector('[data-action="workspace-discard"]'),null);
  assert.equal(JSON.parse(storage.get(persistence.STORAGE_KEY)).programme.approved,null);
});

test('restored custom collection checks the current guard explicitly before a live ranking action',async()=>{
  const evidenceId='rb-taste-'+'2'.repeat(32);
  const artists=fixture.profiles.map((profile,index)=>({id:'pending-artist-'+index,name:profile.reference,type:'artist'}));
  const packet={schemaVersion:1,evidenceId,status:'pending',profileCount:3,completedProfiles:1,artists,nextProfile:{...artists[1],index:1},qlooRequests:0,guard:{}};
  const original=reducers.createState(fixture);
  original.taste={...original.taste,evidenceId,selected:artists.map(artist=>({artistId:artist.id,searchId:'search-'+artist.id,name:artist.name})),packet};
  const storage=new Map([[persistence.STORAGE_KEY,JSON.stringify(await persistence.createWorkspaceSnapshot(original))]]);
  const ui=await harness({storage,handlers:{
    ['/api/tastes/progress?evidenceId='+evidenceId]:()=>packet,
    '/api/tastes/status':()=>({schemaVersion:1,liveEnabled:true,guard:{busy:false,paused:false,remainingRequests:12,nextAllowedAt:null},knownArtists:{searchId:'known-search',options:artists}}),
  }});
  assert.equal(ui.read().taste.status,null);
  assert.equal(ui.document.querySelector('[data-action="taste-rank"]').disabled,true);
  assert.equal(ui.requests.some(request=>request.method==='POST'),false);
  await ui.click('[data-action="taste-status"]');
  assert.equal(ui.read().taste.status.liveEnabled,true);
  assert.equal(ui.document.querySelector('[data-action="taste-rank"]').disabled,false);
  assert.equal(ui.requests.some(request=>request.method==='POST'),false,'status recovery never retries ranking');
  assert.equal(ui.document.querySelector('#operation-status').getAttribute('aria-live'),'polite');
  assert.match(ui.document.querySelector('.taste-time').textContent,/five minutes of waiting/);
});

test('the season prompt follows two-night constraints and a live proposal stays unapproved and receives focus', async () => {
  const ui = await harness({ handlers: { '/api/agent': ({ body }) => ({ source: 'live', model: 'mock',
    answer: 'Injected proposal.', llmRequests: 1, qlooRequests: 0,
    proposal: { request: body.context, ...service.repairOptions(body.context) } }) } });
  await ui.click('[data-action="slots"][data-count="2"]');
  await ui.click('.agent-examples [data-action="agent-example"]');
  assert.match(ui.read().agentMessage, /(?:two|2) nights/i);
  await ui.click('[data-action="agent-send"]');
  const sent = ui.requests.find(request => request.path === '/api/agent');
  assert.ok(sent); assert.equal(sent.body.context.slots, 2);
  assert.match(sent.body.message, /(?:two|2) nights/i);
  assert.equal(ui.read().approved, null);
  assert.equal(ui.read().proposal.result.nightOrder.length, 2);
  assert.ok(ui.document.activeElement === ui.document.querySelector('.proposal-panel h2'), 'new proposal receives focus');
  assert.equal(ui.document.focusEvents.at(-1).options.preventScroll, false);
});

test('planning with an empty message sends the current brief once and requires approval', async () => {
  const ui = await harness({ handlers: { '/api/agent': ({ body }) => ({ source: 'live', model: 'mock',
    answer: 'Injected proposal.', llmRequests: 1, qlooRequests: 0,
    proposal: { request: body.context, ...service.repairOptions(body.context) } }) } });
  await ui.click('[data-action="slots"][data-count="2"]');
  assert.equal(ui.read().agentMessage, '');
  await ui.click('[data-action="agent-send"]');
  const sent = ui.requests.filter(request => request.path === '/api/agent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.context.slots, 2);
  assert.match(sent[0].body.message, /(?:two|2) nights/i);
  assert.equal(ui.read().agentMessage, sent[0].body.message);
  assert.equal(ui.read().approved, null);
  assert.equal(ui.read().proposal.result.nightOrder.length, 2);
});

test('applying completed artist profiles waits for evidence-bound assistant status without a manual refresh', async () => {
  const artists = fixture.profiles.map((profile, index) => ({ id: 'mock-artist-' + index, name: profile.reference, type: 'artist' }));
  const evidenceId = 'rb-taste-' + '0'.repeat(32);
  const dataset = structuredClone(fixture); dataset.dataset.id = evidenceId;
  dataset.profiles.forEach((profile, index) => { profile.referenceEntityId = artists[index].id; });
  let resolveStatus; let requestedStatus = false;
  const statusPromise = new Promise(resolve => { resolveStatus = resolve; });
  const ui = await harness({ handlers: {
    '/api/tastes/status': () => ({ schemaVersion: 1, liveEnabled: false, guard: {},
      knownArtists: { searchId: 'mock-search', source: 'cached', options: artists } }),
    '/api/tastes/select': () => ({ schemaVersion: 1, evidenceId, status: 'complete', completedProfiles: 3,
      profileCount: 3, artists, source: 'custom_taste', dataset, qlooRequests: 0, guard: {} }),
    ['/api/agent-status?evidenceId=' + evidenceId]: () => { requestedStatus = true; return statusPromise; },
  } });
  await ui.click('[data-action="taste-open"]');
  for (let index = 0; index < 3; index++) await ui.click(`[data-action="taste-confirm"][data-index="${index}"][data-artist-id="${artists[index].id}"]`);
  await ui.click('[data-action="taste-select"]');
  let finished = false;
  const applying = ui.click('[data-action="taste-apply"]').then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requestedStatus, true, 'new evidence automatically triggers its own status check');
  assert.equal(finished, false, 'apply action awaits assistant readiness');
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, true);
  assert.ok(ui.document.querySelector('.agent-status .status-dot').classList.contains('pending'), 'status is visibly being checked');
  resolveStatus(ready); await applying;
  assert.equal(ui.read().evidenceId, evidenceId);
  assert.equal(ui.read().agentStatus.configured, true);
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, false);
  assert.equal(ui.read().approved, null);
  assert.equal(ui.read().proposal, null);
  assert.equal(ui.requests.some(request => request.path === '/api/agent'), false);
});

test('busy and operator-review states disable Luna and use an unavailable indicator', async t => {
  for (const status of [{ ...ready, providerStatus: 'busy', busy: true }, { ...ready, operatorReviewRequired: true }]) {
    await t.test(status.operatorReviewRequired ? 'operator review' : 'busy', async () => {
      const ui = await harness({ status });
      assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, true);
      assert.ok(ui.document.querySelector('.agent-status .status-dot').classList.contains('unavailable'));
      await ui.input('#agent-message', 'Explain this brief.');
      await ui.click('[data-action="agent-send"]');
      assert.equal(ui.requests.some(request => request.path === '/api/agent'), false);
    });
  }
});

test('navigation focuses each new page heading without fetching evidence or providers', async () => {
  const ui = await harness(); const initial = ui.requests.length;
  for (const view of ['catalogue', 'evidence', 'programme']) {
    await ui.click(`[data-view="${view}"]`);
    assert.equal(ui.read().view, view);
    assert.ok(ui.document.activeElement === ui.document.querySelector('.page-heading h1'), 'new page heading receives focus');
    assert.equal(ui.document.focusEvents.at(-1).options.preventScroll, false);
  }
  assert.equal(ui.requests.length, initial);
});

test('a failed availability check disables previously ready Luna without discarding its unapproved proposal', async () => {
  let checks = 0;
  const ui = await harness({ handlers: {
    '/api/agent-status': () => ++checks === 1 ? ready : { httpStatus: 503, error: 'Injected status failure.' },
    '/api/agent': ({ body }) => ({ source: 'live', model: 'mock', answer: 'Injected proposal.',
      llmRequests: 1, qlooRequests: 0, proposal: { request: body.context, ...service.repairOptions(body.context) } }),
  } });
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, false);
  await ui.click('[data-action="agent-send"]');
  assert.equal(checks, 2);
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, true);
  assert.ok(ui.document.querySelector('.agent-status .status-dot').classList.contains('unavailable'));
  assert.ok(ui.document.querySelector('[role="alert"]'));
  assert.equal(ui.read().approved, null);
  assert.ok(ui.read().proposal);
  await ui.click('[data-action="agent-send"]');
  assert.equal(ui.requests.filter(request => request.path === '/api/agent').length, 1, 'failed readiness has no retry');
});

test('a recorded walkthrough returns to the approved workspace with its locks and name intact', async () => {
  const initial = reducers.planningRequest(reducers.createState(fixture));
  const initialOptions = service.repairOptions(initial);
  const cancellation = { ...initial, current: initialOptions.result.selection,
    locked: initialOptions.result.selection.slice(0, 2), excluded: initialOptions.result.selection.slice(2) };
  const scenario = (id, context, options) => ({ id, context,
    response: { source: 'recorded', model: 'mock', answer: 'Injected fictional recorded answer.',
      llmRequests: 0, qlooRequests: 0, usage: { inputTokens: 0, outputTokens: 0 },
      proposal: { request: context, ...options } } });
  const recording = { schemaVersion: 1, mode: 'recorded', llmRequests: 0, qlooRequests: 0,
    scenarios: [scenario('initial', initial, initialOptions), scenario('cancellation', cancellation, service.repairOptions(cancellation))] };
  const ui = await harness({ handlers: {
    '/api/access/status': () => ({ ...access, recordedAvailable: true }),
    '/api/programme': ({ body }) => service.programme(body),
    '/api/demo-scenarios': () => recording,
  } });
  await ui.click('[data-action="plan"]'); await ui.click('[data-action="approve"]');
  for (const id of ui.read().approved.selection.slice(0, 2)) await ui.click(`[data-action="lock"][data-id="${id}"]`);
  await ui.input('#season-name', 'Fictional test programme');
  const before = ui.read();
  await ui.click('[data-action="demo-start"]');
  assert.equal(ui.read().mode, 'recorded');
  assert.equal(ui.read().approved, null);
  assert.equal(ui.read().agentResponse.source, 'recorded');
  await ui.click('[data-action="approve"]');
  assert.equal(ui.read().approved.source, 'recorded');
  await ui.click('[data-action="demo-exit"]');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.read().mode, 'live');
  assert.deepEqual(ui.read().approved, before.approved);
  assert.deepEqual(ui.read().locked, before.locked);
  assert.deepEqual(ui.read().receipt, before.receipt);
  assert.equal(ui.read().seasonName, before.seasonName);
  assert.equal(ui.requests.filter(request => request.path === '/api/demo-scenarios').length, 1);
  assert.equal(ui.requests.some(request => request.path === '/api/agent'), false);
  assert.equal(ui.requests.some(request => request.path.startsWith('/api/tastes/')), false);
});

test('expired organiser access during a custom manual review offers sign-in and keeps approved locks without retrying', async () => {
  const ui = await approvedCustomWorkspace({
    '/api/repair-options': () => ({ httpStatus: 403, code: 'owner_required', error: 'Injected expired organiser session.' }),
  });
  const before = ui.read();
  await ui.click('[data-action="plan"]');
  assert.equal(ui.read().ownerAccessExpired, true);
  assertWorkspaceKept(ui, before);
  assert.ok(ui.document.querySelector('[data-action="owner-open"]'), 'organiser sign-in is offered');
  assert.equal(ui.document.querySelector('#owner-logout').hidden, true);
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, true);
  assert.equal(ui.requests.filter(request => request.path === '/api/repair-options').length, 1);
  const review = ui.requests.find(request => request.path === '/api/repair-options');
  assert.equal(review.body.evidenceId, before.evidenceId);
  assert.deepEqual(review.body.locked, before.locked);
  assert.equal(ui.requests.some(request => request.path === '/api/agent'), false);
  assert.equal(ui.requests.some(request => ['/api/tastes/search', '/api/tastes/rank'].includes(request.path)), false);
});

test('expired access during artist search keeps the workspace and sign-in checks artist status without retrying search', async () => {
  const ui = await approvedCustomWorkspace({
    '/api/tastes/search': () => ({ httpStatus: 403, code: 'owner_required', error: 'Injected expired organiser session.' }),
    '/api/access/owner': () => ({ ownerAuthenticated: true }),
  });
  const before = ui.read();
  await ui.click('[data-action="taste-open"]');
  await ui.input('#artist-query-0', 'Fictional new artist');
  await ui.click('[data-action="taste-search"][data-index="0"]');
  assert.equal(ui.read().ownerAccessExpired, true);
  assertWorkspaceKept(ui, before);
  assert.ok(ui.document.querySelector('[data-action="owner-open"]'), 'organiser sign-in is offered');
  assert.equal(ui.document.querySelector('#owner-logout').hidden, true);
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, true);
  assert.equal(ui.requests.filter(request => request.path === '/api/tastes/search').length, 1);
  assert.equal(ui.requests.find(request => request.path === '/api/tastes/search').body.live, false);
  await ui.click('[data-action="owner-open"]');
  await ui.input('#owner-token', 'Injected fictional organiser token');
  await ui.click('[data-action="owner-signin"]');
  assert.equal(ui.read().ownerAccessExpired, false);
  assertWorkspaceKept(ui, before);
  assert.equal(ui.read().taste.needsStatusCheck, false);
  assert.ok(ui.document.querySelector('.taste-picker'));
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, false);
  assert.equal(ui.requests.filter(request => request.path === '/api/tastes/status').length, 2, 'sign-in refreshes artist status after a changed search');
  assert.equal(ui.requests.filter(request => request.path === '/api/tastes/search').length, 1, 'sign-in never retries the artist search');
  assert.equal(ui.requests.some(request => request.path === '/api/agent' || request.path === '/api/tastes/rank'), false);
});

test('an assistant failure cannot alter approved locks or render server error text as HTML', async () => {
  const attack = '<img src="mock-attack" onerror="unsafe()">';
  const ui = await harness({ handlers: {
    '/api/programme': ({ body }) => service.programme(body),
    '/api/agent': () => ({ httpStatus: 503, code: 'mock_failure', error: attack }),
  } });
  await ui.click('[data-action="plan"]'); await ui.click('[data-action="approve"]');
  const approved = ui.read().approved.selection;
  for (const id of approved.slice(0, 2)) await ui.click(`[data-action="lock"][data-id="${id}"]`);
  const locks = ui.read().locked;
  await ui.input('#agent-message', 'Repair this programme.'); await ui.click('[data-action="agent-send"]');
  assert.deepEqual(ui.read().approved.selection, approved);
  assert.deepEqual(ui.read().locked, locks);
  assert.equal(ui.read().proposal, null);
  assert.ok(ui.read().agentError);
  assert.ok(ui.read().agentErrorDetails.includes(attack));
  assert.equal(ui.document.querySelector('img[src="mock-attack"]'), null);
  assert.ok(ui.document.querySelector('[role="alert"]'));
  assert.equal(ui.requests.filter(request => request.path === '/api/agent').length, 1, 'no automatic retry');
});


test('judge sign-in keeps approved choices and unlocks reserved Luna capacity after the guest quota is used', async () => {
  let signedIn = false;
  const ui = await harness({ handlers: {
    '/api/access/status': () => ({ ...access, ownerAuthenticated: false, ownerSignInAvailable: true,
      judgeAuthenticated: signedIn, judgeSignInAvailable: true, publicCustomAccess: true, guestRemainingInteractions: 0 }),
    '/api/agent-status': () => ({ ...ready, maxRequestsPerDay: signedIn ? 240 : 36 }),
    '/api/programme': ({ body }) => service.programme(body),
    '/api/access/judge': ({ body }) => {
      assert.equal(body.username, 'judge'); assert.equal(body.password, 'Fictional judge password');
      signedIn = true; return { judgeAuthenticated: true, ownerAuthenticated: false };
    },
  } });
  await ui.click('[data-action="plan"]'); await ui.click('[data-action="approve"]');
  const selection = ui.read().approved.selection;
  await ui.click(`[data-action="lock"][data-id="${selection[0]}"]`);
  const before = ui.read();
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, true);
  await ui.click('#judge-login-button');
  assert.equal(ui.document.querySelector('#judge-dialog').open, true);
  assert.equal(ui.document.querySelector('#judge-login-button').getAttribute('aria-controls'), 'judge-dialog');
  assert.equal(ui.document.querySelector('#judge-dialog').getAttribute('aria-describedby'), 'judge-access-reason');
  assert.match(ui.document.querySelector('#judge-access-reason').textContent, /All features are available without signing in/);
  assert.match(ui.document.querySelector('#judge-access-reason').textContent, /reserved Luna and Qloo allowance/);
  assert.match(ui.document.querySelector('#judge-access-reason').textContent, /public daily allowance is used/);
  await ui.input('#judge-username', 'judge'); await ui.input('#judge-password', 'Fictional judge password');
  await ui.click('[data-action="judge-signin"]');
  assert.equal(ui.document.querySelector('#judge-password').value, '');
  assert.equal(ui.document.querySelector('#judge-dialog').open, false);
  assert.deepEqual(ui.read().approved, before.approved); assert.deepEqual(ui.read().locked, before.locked);
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, false);
  assert.equal(ui.document.querySelector('#owner-logout').textContent, 'Sign out judge');
  assert.ok(ui.document.querySelector('[data-action="taste-open"]'));
  assert.match(ui.document.querySelector('.response-details').textContent, /240/);
  assert.equal(ui.document.querySelector('.agent-footer').textContent.includes('browser today'), false);
  assert.equal(ui.requests.some(request => request.path === '/api/agent' || request.path.startsWith('/api/tastes/')), false);
});

test('anonymous visitors can apply custom artist evidence and plan while their Luna browser quota stays enforced', async () => {
  const ui = await approvedCustomWorkspace({
    '/api/access/status': () => ({ ...publicAccess, guestRemainingInteractions: 0 }),
  });
  assert.equal(ui.read().evidenceId.startsWith('rb-taste-'), true);
  assert.ok(ui.read().approved);
  assert.equal(ui.read().locked.length, 2);
  assert.equal(ui.document.querySelector('#owner-logout').hidden, true, 'public custom access does not imply authentication');
  assert.equal(ui.document.querySelector('#judge-login-button').hidden, false, 'extra judge allowance remains available');
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, true);
  assert.match(ui.document.querySelector('.agent-footer').textContent, /0 Luna messages left in this browser today/);
  assert.ok(ui.document.querySelector('[data-action="taste-open"]'), 'custom artists stay available independently of Luna quota');
  await ui.click('[data-action="agent-send"]');
  assert.equal(ui.requests.some(request => request.path === '/api/agent'), false);
});

test('anonymous live artist search uses the public Qloo allowance without consuming a Luna message', async () => {
  const ui = await harness({ handlers: {
    '/api/access/status': () => publicAccess,
    '/api/tastes/status': () => ({ schemaVersion: 1, liveEnabled: true,
      guard: { remainingRequests: 12, dailyAttemptLimit: 120 },
      knownArtists: { searchId: 'mock-search', options: [] } }),
    '/api/tastes/search': ({ body }) => {
      assert.equal(body.live, true);
      return { schemaVersion: 1, query: body.query, searchId: 'public-search', source: 'live', qlooRequests: 1,
        guard: { remainingRequests: 0, dailyAttemptLimit: 120 },
        options: [{ id: 'public-artist', name: 'Fictional public artist', type: 'artist' }] };
    },
  } });
  await ui.click('[data-action="taste-open"]');
  await ui.input('#artist-query-0', 'Fictional public artist');
  await ui.click('[data-action="taste-search"][data-index="0"]');
  assert.match(ui.document.querySelector('.taste-readiness').textContent, /allowance is used/);
  assert.match(ui.document.querySelector('[data-action="taste-search"][data-index="0"]').textContent, /Search saved/);
  assert.match(ui.document.querySelector('.agent-footer').textContent, /24 Luna messages left/);
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, false);
  assert.equal(ui.requests.filter(request => request.path === '/api/tastes/search').length, 1);
  assert.equal(ui.requests.some(request => request.path === '/api/agent'), false);
});

test('signing out of judge reserve preserves the custom programme and switches back to public quota', async () => {
  let signedIn = true;
  const ui = await approvedCustomWorkspace({
    '/api/access/status': () => ({ ...publicAccess, judgeAuthenticated: signedIn,
      guestRemainingInteractions: signedIn ? null : 0 }),
    '/api/agent-status': () => ({ ...ready, maxRequestsPerDay: signedIn ? 240 : 180 }),
    '/api/access/logout': () => { signedIn = false; return { ok: true }; },
  });
  const before = ui.read();
  await ui.click('[data-action="owner-logout"]');
  assertWorkspaceKept(ui, before);
  assert.equal(ui.document.querySelector('#owner-logout').hidden, true);
  assert.equal(ui.document.querySelector('#judge-login-button').hidden, false);
  assert.ok(ui.document.querySelector('[data-action="taste-open"]'));
  assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, true);
  assert.equal(ui.requests.some(request => ['/api/agent', '/api/tastes/rank', '/api/tastes/search'].includes(request.path)), false);
});

test('an expired public browser session preserves custom evidence and recovers only through an explicit status check', async () => {
  const ui = await approvedCustomWorkspace({
    '/api/access/status': () => publicAccess,
    '/api/tastes/search': () => ({ httpStatus: 401, code: 'access_session_required', error: 'Injected expired browser session.' }),
  });
  const before = ui.read();
  await ui.click('[data-action="taste-open"]');
  await ui.input('#artist-query-0', 'Fictional new artist');
  await ui.click('[data-action="taste-search"][data-index="0"]');
  assert.equal(ui.read().sessionAccessExpired, true);
  assert.equal(ui.read().ownerAccessExpired, false);
  assertWorkspaceKept(ui, before);
  assert.match(ui.document.querySelector('.taste-readiness').textContent, /browser session expired/);
  const checksBefore = ui.requests.filter(request => request.path === '/api/access/status').length;
  await ui.click('[data-action="taste-status"]');
  assert.equal(ui.read().sessionAccessExpired, false);
  assertWorkspaceKept(ui, before);
  assert.equal(ui.requests.filter(request => request.path === '/api/access/status').length, checksBefore + 1);
  assert.equal(ui.requests.filter(request => request.path === '/api/tastes/search').length, 1, 'checking status never retries artist search');
});

test('session issuance errors accept configurable quotas but reject invalid public-access metadata', async t => {
  const limited = { ...publicAccess, synthetic: false, guestRemainingInteractions: null,
    guestRemainingQlooRequests: null, httpStatus: 429, code: 'access_session_rate_limit', error: 'Injected session issuance limit.' };
  await t.test('valid configured limits retain public artists and private judge sign-in', async () => {
    const ui = await harness({ handlers: { '/api/access/status': () => limited } });
    assert.equal(ui.document.querySelector('#judge-login-button').hidden, false);
    assert.ok(ui.document.querySelector('[data-action="taste-open"]'));
    assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, true);
  });
  for (const [label, change] of [
    ['oversized Luna quota', { guestMaxInteractionsPerDay: 61 }],
    ['invalid Qloo quota', { guestMaxQlooRequestsPerDay: 0 }],
    ['out-of-range Qloo remaining', { guestRemainingQlooRequests: 13 }],
    ['non-boolean public access', { publicCustomAccess: 'true' }],
    ['forged judge identity', { judgeAuthenticated: true }],
  ]) await t.test(label, async () => {
    const ui = await harness({ handlers: { '/api/access/status': () => ({ ...limited, ...change }) } });
    assert.equal(ui.document.querySelector('[data-action="taste-open"]'), null, 'unverified metadata cannot unlock custom controls');
    assert.equal(ui.document.querySelector('#judge-login-button').hidden, true);
    assert.equal(ui.document.querySelector('[data-action="agent-send"]').disabled, true);
  });
});

test('judge sign-in never sends blank credentials or repeats a pending request', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const ui = await harness({ handlers: {
    '/api/access/status': () => ({ ...access, ownerAuthenticated: false, judgeAuthenticated: false,
      judgeSignInAvailable: true, guestRemainingInteractions: 4 }),
    '/api/access/judge': async () => { await held; return { httpStatus: 401, error: '<b>Invalid supplied credentials</b>' }; },
  } });
  await ui.click('#judge-login-button'); await ui.click('[data-action="judge-signin"]');
  assert.equal(ui.requests.some(request => request.path === '/api/access/judge'), false);
  await ui.input('#judge-password', 'Fictional incorrect password');
  const pending = ui.click('[data-action="judge-signin"]');
  assert.equal(ui.document.querySelector('[data-action="judge-signin"]').disabled, true);
  await ui.click('[data-action="judge-signin"]');
  release(); await pending;
  assert.equal(ui.requests.filter(request => request.path === '/api/access/judge').length, 1);
  assert.equal(ui.document.querySelector('[data-action="judge-signin"]').disabled, false);
  assert.equal(ui.document.querySelector('#judge-password').value, '');
  assert.equal(ui.document.querySelector('#judge-error').textContent, '<b>Invalid supplied credentials</b>');
  assert.equal(ui.document.querySelector('#judge-error b'), null);
});

test('retrying saved evidence blocks edits and actions until its read-only progress check finishes', async t => {
  let original = reducers.createState(fixture);
  original = reducers.approveProposal(reducers.receiveProposal(original,
    { result: service.programme(reducers.planningRequest(original)) }, original.revision));
  original.seasonName = 'Saved fictional programme';
  original.organiserNote = 'Saved discussion note.';
  const evidenceId = 'rb-taste-' + '2'.repeat(32);
  const artists = fixture.profiles.map((profile, index) => ({ id: 'retry-fictional-artist-' + index,
    name: profile.reference }));
  original.taste.evidenceId = evidenceId;
  original.taste.selected = artists.map(artist => ({ artistId: artist.id, searchId: 'retry-fictional-search', name: artist.name }));
  const serialized = JSON.stringify(await persistence.createWorkspaceSnapshot(original));
  const storage = new Map([[persistence.STORAGE_KEY, serialized]]);
  let progressCalls = 0, release, markStarted;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { markStarted = resolve; });
  t.after(() => release());
  const ui = await harness({ storage, handlers: {
    ['/api/tastes/progress?evidenceId=' + evidenceId]: async () => {
      if (++progressCalls === 1) return { httpStatus: 503, error: 'Injected saved-evidence outage.' };
      markStarted(); await held;
      return { schemaVersion: 1, evidenceId, status: 'pending', profileCount: 3,
        completedProfiles: 0, artists, qlooRequests: 0 };
    },
  } });
  assert.ok(ui.document.querySelector('[data-action="workspace-retry"]'));
  const before = ui.read();
  const retry = ui.click('[data-action="workspace-retry"]');
  await started;
  assert.equal(ui.read().busy, true);
  assert.equal(ui.document.querySelector('#season-name').disabled, true);
  assert.equal(ui.document.querySelector('#organiser-note').disabled, true);
  assert.equal(ui.document.querySelector('[data-action="plan"]').disabled, true);
  await ui.input('#season-name', 'Attempted new name while restoring');
  await ui.input('#organiser-note', 'Attempted new note while restoring');
  await ui.click('[data-action="plan"]');
  await ui.click('[data-action="agent-send"]');
  await ui.click('#reset-button');
  await ui.click('[data-action="workspace-retry"]');
  assert.equal(ui.read().seasonName, before.seasonName);
  assert.equal(ui.read().organiserNote, before.organiserNote);
  assert.deepEqual(ui.read().approved, before.approved);
  assert.equal(storage.get(persistence.STORAGE_KEY), serialized);
  assert.equal(ui.requests.some(request => request.method === 'POST'), false);
  release(); await retry;
  assert.equal(ui.read().busy, false);
  assert.equal(ui.read().seasonName, original.seasonName);
  assert.equal(ui.read().organiserNote, original.organiserNote);
  assert.deepEqual(ui.read().approved, original.approved);
  assert.equal(ui.read().taste.evidenceId, evidenceId);
  assert.equal(ui.read().taste.needsStatusCheck, true);
  assert.equal(progressCalls, 2);
  assert.equal(ui.requests.some(request => request.method === 'POST'), false, 'restore never retries or makes a paid request');
});

test('retry aborts a stale restore when another tab changes storage during its progress check', async t => {
  let original = reducers.createState(fixture);
  original = reducers.approveProposal(reducers.receiveProposal(original,
    { result: service.programme(reducers.planningRequest(original)) }, original.revision));
  original.seasonName = 'Original saved fictional programme';
  const evidenceId = 'rb-taste-' + '3'.repeat(32);
  const artists = fixture.profiles.map((profile, index) => ({ id: 'conflict-fictional-artist-' + index,
    name: profile.reference }));
  original.taste.evidenceId = evidenceId;
  original.taste.selected = artists.map(artist => ({ artistId: artist.id, searchId: 'conflict-fictional-search', name: artist.name }));
  const storage = new Map([[persistence.STORAGE_KEY, JSON.stringify(await persistence.createWorkspaceSnapshot(original))]]);
  let progressCalls = 0, release, markStarted;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { markStarted = resolve; });
  t.after(() => release());
  const ui = await harness({ storage, handlers: {
    ['/api/tastes/progress?evidenceId=' + evidenceId]: async () => {
      if (++progressCalls === 1) return { httpStatus: 503, error: 'Injected saved-evidence outage.' };
      markStarted(); await held;
      return { schemaVersion: 1, evidenceId, status: 'pending', profileCount: 3,
        completedProfiles: 0, artists, qlooRequests: 0 };
    },
  } });
  const before = ui.read();
  const retry = ui.click('[data-action="workspace-retry"]');
  await started;
  const otherTab = structuredClone(original);
  otherTab.seasonName = 'Newer fictional programme from another tab';
  const newerSerialized = JSON.stringify(await persistence.createWorkspaceSnapshot(otherTab));
  storage.set(persistence.STORAGE_KEY, newerSerialized);
  release(); await retry;
  assert.equal(ui.read().busy, false);
  assert.equal(ui.read().seasonName, before.seasonName, 'stale restoration does not replace the visible workspace');
  assert.deepEqual(ui.read().approved, before.approved);
  assert.equal(ui.read().taste.evidenceId, before.taste.evidenceId, 'stale collection checkpoint is not applied');
  assert.equal(storage.get(persistence.STORAGE_KEY), newerSerialized, 'the newer tab snapshot is retained');
  assert.match(ui.document.querySelector('.workspace-save').textContent, /Another tab changed the saved programme/);
  assert.ok(ui.document.querySelector('[data-action="workspace-retry"]'));
  assert.equal(progressCalls, 2);
  assert.equal(ui.requests.some(request => request.method === 'POST'), false);
});
