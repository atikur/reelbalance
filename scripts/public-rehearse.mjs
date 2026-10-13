import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer as createPortReservation } from 'node:net';
import { buildPublicExport } from './public-export.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function names(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await names(resolve(directory, entry.name), path));
    else result.push(path);
  }
  return result.sort();
}

function receive(child) {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(Error('Clean-copy runtime check timed out.')); }, 10_000);
    const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); };
    const onMessage = value => { cleanup(); resolveMessage(value); };
    const onExit = () => { cleanup(); reject(Error('The clean-copy runtime exited before completing the check.')); };
    child.once('message', onMessage); child.once('exit', onExit);
  });
}

async function checkLauncher(output, temporary) {
  const reservation = createPortReservation();
  await new Promise((resolveReady, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolveReady); });
  const port = reservation.address().port;
  await new Promise(resolveClose => reservation.close(resolveClose));
  const marker = resolve(temporary, 'launcher-external-attempt.txt');
  const blocker = resolve(temporary, 'block-launcher-fetch.mjs');
  await writeFile(blocker, `import {writeFileSync} from 'node:fs';\nglobalThis.fetch=async()=>{writeFileSync(${JSON.stringify(marker)},'blocked');throw Error('External fetch blocked during setup rehearsal.');};\n`);
  const child = spawn(process.execPath, ['scripts/public-start.mjs'], {
    cwd: output, env: { PATH: process.env.PATH ?? '', PORT: String(port), NODE_OPTIONS: `--import=${pathToFileURL(blocker).href}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.resume();
  let outputText = '';
  try {
    await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(Error('The public launcher did not become ready.')), 10_000);
      const onData = bytes => {
        outputText += bytes.toString('utf8');
        if (outputText.includes('is ready')) { clearTimeout(timer); child.off('exit', onExit); resolveReady(); }
      };
      const onExit = () => { clearTimeout(timer); child.stdout.off('data', onData); reject(Error('The public launcher exited before becoming ready.')); };
      child.stdout.on('data', onData); child.once('exit', onExit);
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200); assert.equal((await response.json()).dataset.synthetic, true);
    try { await readFile(marker); throw Error('The public launcher attempted an external request.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolveExit => child.once('exit', resolveExit)); }
  }
}

export async function rehearsePublicPackage({ sourceDirectory = ROOT } = {}) {
  const temporary = await mkdtemp(resolve(tmpdir(), 'reelbalance-public-rehearsal-'));
  const output = resolve(temporary, 'source');
  let child;
  try {
    const built = await buildPublicExport({ sourceDirectory, outputDirectory: output });
    assert.deepEqual(await names(output), [...built.manifest.files.map(file => file.path), 'public-manifest.json'].sort());
    for (const file of built.manifest.files) {
      const bytes = await readFile(resolve(output, file.path));
      assert.equal(bytes.length, file.bytes); assert.equal(sha256(bytes), file.sha256);
    }
    await checkLauncher(output, temporary);
    const script = `
      let externalFetchAttempts = 0;
      globalThis.fetch = async () => { externalFetchAttempts++; throw Error('External API access is blocked during this synthetic check.'); };
      const { createServer } = await import('./app/server.mjs');
      const server = await createServer({datasetPath:'./release/synthetic-data.json',recordingPath:'./no-recording.json'});
      server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
      process.once('message',()=>server.close(()=>process.send({externalFetchAttempts},()=>process.exit(0))));
    `;
    child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: output, env: { PATH: process.env.PATH ?? '' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    child.stderr.resume(); // Never forward raw errors or environment material from a child.
    const ready = await receive(child);
    const origin = `http://127.0.0.1:${ready.port}`;
    const request = async (path, body) => {
      const response = await fetch(origin + path, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
      return response;
    };
    const json = async (path, body) => { const response = await request(path, body); assert.equal(response.status, 200); return response.json(); };
    const dataset = await json('/api/bootstrap');
    assert.equal(dataset.dataset.synthetic, true);
    assert.equal(dataset.dataset.source, 'Synthetic demonstration fixtures');
    assert.equal((await request('/')).status, 200);
    const status = await json('/api/agent-status');
    assert.equal(status.configured, false);
    const stateApi = await import(pathToFileURL(resolve(output, 'app/public/state.js')));
    let state = stateApi.createState(dataset);
    const first = await json('/api/repair-options', stateApi.planningRequest(state));
    assert.equal(first.result.represented, 3);
    state = stateApi.receiveProposal(state, first, state.revision);
    assert.equal(state.approved, null);
    state = stateApi.approveProposal(state);
    const surviving = state.approved.selection.slice(0, 2);
    const cancelled = state.approved.selection[2];
    state = stateApi.changeConstraints(state, { locked: surviving, excluded: [cancelled] });
    const repair = await json('/api/repair-options', stateApi.planningRequest(state));
    assert.equal(repair.result.represented, 2);
    assert.equal(repair.runtimeAlternative.maximumRuntime, 117);
    assert.deepEqual(repair.result.nightOrder.slice(0, 2), surviving);
    assert.deepEqual(repair.runtimeAlternative.result.nightOrder.slice(0, 2), surviving);
    state = stateApi.receiveProposal(state, repair, state.revision);
    assert.equal(state.maximumRuntime, 110);
    assert.ok(state.approved.selection.includes(cancelled));
    state = stateApi.approveProposal(state, 'runtime');
    assert.equal(state.maximumRuntime, 117);
    assert.deepEqual(state.approved.selection.slice(0, 2), surviving);
    assert.ok(!state.approved.selection.includes(cancelled));
    const payload = { ...stateApi.planningRequest(state), seasonName: 'Synthetic clean-copy check', organiserNote: '', approvedAt: state.approved.approvedAt };
    const sheetResponse = await request('/api/programme-sheet?payload=' + encodeURIComponent(JSON.stringify(payload)));
    assert.equal(sheetResponse.status, 200);
    const sheet = await sheetResponse.text();
    assert.match(sheet, /synthetic|invented/i); assert.match(sheet, /Up to 117 min per film/);
    for (const [path, body] of [['/api/agent', { message: 'Explain the synthetic programme.', context: stateApi.planningRequest(state) }],
      ['/api/tastes/search', { query: 'Fictional ensemble', live: true }]]) {
      const blocked = await request(path, body); assert.equal(blocked.status, 503); assert.equal((await blocked.json()).code, 'synthetic_mode');
    }
    assert.equal((await request('/api/demo-scenarios')).status, 503);
    for (const path of ['/.env.local', '/.cache/private-runtime/runtime.json', '/app/data/demo.json', '/release/synthetic-data.json', '/public-manifest.json']) {
      assert.equal((await request(path)).status, 404, 'Only explicit app routes are served.');
    }
    const finished = receive(child); child.send('finish');
    const transport = await finished;
    assert.equal(transport.externalFetchAttempts, 0);
    const finalFiles = await names(output);
    assert.ok(!finalFiles.some(path => /^\.cache\/(?:qloo-request-state|openai-usage)/.test(path)), 'The check creates no provider-request ledgers.');
    return { schemaVersion: 1, checkedAt: new Date().toISOString(), result: 'passed', runtime: process.version,
      scope: 'Fresh source-only copy using invented fixtures, without private evidence, dependencies, credentials or Git history.',
      publicFileCount: built.manifest.files.length, manifestVerified: true, launcherVerified: true, syntheticOnly: true,
      externalFetchAttempts: 0, newQlooRequests: 0, newOpenAiRequests: 0,
      checks: ['Explicit source allowlist and SHA-256 manifest', 'Exported public-start launcher without installed dependencies', 'Keyless synthetic startup', 'Unapplied initial proposal',
        'Cancellation preserves two locked nights', '110-minute limit retained before approval', 'Separate 117-minute approval',
        'Synthetic programme-sheet labels', 'Provider and recording routes disabled for synthetic evidence', 'Private files not served'],
      dockerBuild: 'Not checked', publicDeployment: 'Not checked' };
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await rehearsePublicPackage();
  await mkdir(resolve(ROOT, '.cache'), { recursive: true });
  await writeFile(resolve(ROOT, '.cache/public-source-check.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Clean-copy public source check passed (${report.publicFileCount} manifest files). Zero external API requests; report: .cache/public-source-check.json.`);
}
