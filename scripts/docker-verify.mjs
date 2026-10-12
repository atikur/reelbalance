import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, planningRequest, receiveProposal, approveProposal, changeConstraints, escapeHtml } from '../app/public/state.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APP_ORIGIN = 'https://reelbalance-verification.example';
const MEMORY = 256 * 1024 * 1024;
const USAGE_FILES = ['openai-usage.json', 'qloo-request-state.json', 'docker-verification-external-attempt.json'];
const PRIVATE_ROUTES = ['/.env', '/.env.local', '/.cache/private-runtime/runtime.json', '/.cache/private-runtime/dataset.json',
  '/.cache/private-runtime/recording.json', '/app/data/demo.json', '/app/data/recorded-demo.json', '/release/synthetic-data.json', '/public-manifest.json'];
const HELP = 'Usage: node scripts/docker-verify.mjs [--image reelbalance:verify] [--platform linux/amd64] [--dataset private-dataset.json [--recording private-recording.json]]';

class VerificationError extends Error {}
function check(value, message) { if (!value) throw new VerificationError(message); }

export function parseDockerVerifyArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const result = { image: 'reelbalance:verify', platform: 'linux/amd64' };
  const fields = { '--image': 'image', '--platform': 'platform', '--dataset': 'datasetPath', '--recording': 'recordingPath' };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    check(fields[name] && value && !value.startsWith('--') && !seen.has(name), HELP);
    seen.add(name); result[fields[name]] = value;
  }
  check(result.image.length <= 256 && /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(result.image), 'Use a valid Docker image tag.');
  check(/^linux\/[a-z0-9_]+(?:\/[a-z0-9_.-]+)?$/.test(result.platform), 'Use one Linux Docker platform, for example linux/amd64.');
  check(!result.recordingPath || result.datasetPath, '--recording requires --dataset.');
  return result;
}

async function stagePrivateFile(source, destination, maximum) {
  let handle;
  try {
    const info = await lstat(resolve(source));
    check(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= maximum, 'Use a regular, nonsymlink private JSON file within the provisioning size limit.');
    handle = await open(resolve(source), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    check(opened.isFile() && opened.size > 0 && opened.size <= maximum, 'The private input changed or exceeded its size limit.');
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    check(size > 0 && size <= maximum, 'The private input exceeded its size limit.');
    const bytes = buffer.subarray(0, size);
    try { JSON.parse(bytes.toString('utf8')); } catch { throw new VerificationError('The private input must be valid JSON.'); }
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o444 });
    await chmod(destination, 0o444);
  } catch (error) {
    if (error.code) throw new VerificationError('The supplied private input could not be safely staged. Check its type, permissions and size.');
    throw error;
  } finally { await handle?.close(); }
}

// This import is inherited by the app and any Node subprocess.
// Fetch permits only the container-local bootstrap URL; external provider fetch is blocked.
const FETCH_BLOCKER = `import { writeFileSync } from 'node:fs';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  let url;
  try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); } catch {}
  if (url?.origin === 'http://127.0.0.1:4173' && url.pathname === '/api/bootstrap' && !url.search && !url.hash && !url.username && !url.password) {
    return originalFetch(input, { ...options, redirect: 'error' });
  }
  writeFileSync('/app/.cache/docker-verification-external-attempt.json', '{"blocked":true}', { mode: 0o600 });
  throw Error('External fetch is disabled during Docker verification.');
};
`;

export async function verifyDocker({ image = 'reelbalance:verify', platform = 'linux/amd64', datasetPath, recordingPath } = {}) {
  // Validate direct callers as well as the CLI without retaining their private paths in a report.
  parseDockerVerifyArgs(['--image', image, '--platform', platform, ...(datasetPath ? ['--dataset', datasetPath] : []), ...(recordingPath ? ['--recording', recordingPath] : [])]);
  const cache = resolve(ROOT, '.cache');
  await mkdir(cache, { recursive: true });
  const cacheInfo = await lstat(cache);
  check(cacheInfo.isDirectory() && !cacheInfo.isSymbolicLink(), 'Verification requires a regular ignored cache directory.');
  const temporary = await mkdtemp(resolve(cache, 'docker-verification-'));
  const blocker = resolve(temporary, 'no-provider-fetch.mjs');
  const containers = new Set(), volumes = new Set(), children = new Set();
  let interrupted = false;
  const interrupt = () => { interrupted = true; for (const child of children) child.kill('SIGTERM'); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), result: 'failed', image, platform,
    syntheticVerified: false, privateEvidenceProvisioned: false, genuineEvidenceVerified: false, liveProviderVerified: false, recordingVerified: false,
    newQlooRequests: 0, newOpenAiRequests: 0, publicDeploymentVerified: false, checks: [], scenarios: [] };
  let failure;

  async function docker(args, { inherit = false, allowFailure = false, cleanup = false, timeout = 120_000 } = {}) {
    check(cleanup || !interrupted, 'Docker verification was interrupted.');
    return new Promise((done, reject) => {
      const environment = { ...process.env };
      for (const key of ['OPENAI_API_KEY', 'QLOO_API_KEY', 'REELBALANCE_OWNER_TOKEN', 'NODE_OPTIONS']) delete environment[key];
      const child = spawn('docker', args, { cwd: ROOT, env: environment, shell: false, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
      children.add(child);
      let stdout = '', stderr = '', tooLarge = false, timedOut = false;
      const collect = field => bytes => {
        if (stdout.length + stderr.length + bytes.length > 1024 * 1024) { tooLarge = true; child.kill('SIGTERM'); return; }
        if (field === 'stdout') stdout += bytes.toString('utf8'); else stderr += bytes.toString('utf8');
      };
      child.stdout?.on('data', collect('stdout')); child.stderr?.on('data', collect('stderr'));
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
      child.once('error', () => { clearTimeout(timer); children.delete(child); reject(new VerificationError('Docker could not start. Install its CLI and start the Docker engine.')); });
      child.once('close', code => {
        clearTimeout(timer); children.delete(child);
        if (timedOut || tooLarge) reject(new VerificationError('A Docker operation timed out or exceeded its output limit.'));
        else if (interrupted && !cleanup) reject(new VerificationError('Docker verification was interrupted.'));
        else if (code !== 0 && !allowFailure) reject(new VerificationError('A Docker operation failed. Check the Docker engine and build output.'));
        else done({ code, stdout, stderr });
      });
    });
  }
  const inspect = async container => {
    const result = await docker(['inspect', container]);
    try { return JSON.parse(result.stdout)[0]; } catch { throw new VerificationError('Docker returned invalid container metadata.'); }
  };
  function running(metadata, message) {
    if (!metadata.State?.Running || metadata.State.OOMKilled) {
      report.failedContainerState = { status: metadata.State?.Status ?? null, exitCode: metadata.State?.ExitCode ?? null,
        oomKilled: metadata.State?.OOMKilled ?? null, health: metadata.State?.Health?.Status ?? null };
      throw new VerificationError(`${message} OOM-killed: ${report.failedContainerState.oomKilled}; exit code: ${report.failedContainerState.exitCode}.`);
    }
  }
  const mount = (source, target) => ['--mount', `type=bind,src=${source},dst=${target},readonly`];
  const common = volume => ['--platform', platform, '--user', '1000:1000', '--memory', '256m', '--memory-swap', '256m', '--cpus', '0.5',
    '--mount', `type=volume,src=${volume},dst=/app/.cache`, ...mount(blocker, '/verification/no-provider-fetch.mjs'),
    '--env', 'OPENAI_API_KEY=', '--env', 'QLOO_API_KEY=', '--env', 'REELBALANCE_OWNER_TOKEN=',
    '--env', 'REELBALANCE_QLOO_LIVE=0', '--env', 'CROSSCUE_QLOO_LIVE=0', '--env', 'NODE_OPTIONS=--import=/verification/no-provider-fetch.mjs'];
  async function cleanupContainer(name) {
    const result = await docker(['rm', '--force', name], { allowFailure: true, cleanup: true, timeout: 30_000 });
    if (result.code === 0 || /No such container/i.test(result.stderr)) containers.delete(name);
  }
  async function cleanupVolume(name) {
    const result = await docker(['volume', 'rm', name], { allowFailure: true, cleanup: true, timeout: 30_000 });
    if (result.code === 0 || /no such volume/i.test(result.stderr)) volumes.delete(name);
  }
  async function statistics(container) {
    const result = await docker(['stats', '--no-stream', '--format', '{{json .}}', container]);
    try {
      const raw = JSON.parse(result.stdout.trim());
      return Object.fromEntries(['CPUPerc', 'MemUsage', 'MemPerc', 'PIDs', 'NetIO', 'BlockIO'].map(key => [key, raw[key] ?? null]));
    } catch { throw new VerificationError('Docker returned invalid runtime statistics.'); }
  }
  async function verifyWorkflow(origin, synthetic) {
    const request = async (path, body) => fetch(origin + path, { ...(body === undefined ? {} : { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: APP_ORIGIN }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const json = async (path, body) => {
      const response = await request(path, body);
      check(response.status === 200, 'A manual verification route did not return HTTP 200.');
      try { return await response.json(); } catch { throw new VerificationError('A manual route returned invalid JSON.'); }
    };
    const data = await json('/api/bootstrap');
    check((data.dataset?.synthetic === true) === synthetic, 'The container opened the wrong evidence mode.');
    check(data.films?.length === 20 && data.profiles?.length === 3, 'The judged workflow requires a 20-film, three-profile catalogue.');
    check((await request('/')).status === 200, 'The workspace entry page did not open.');
    const agentStatus = await json('/api/agent-status');
    check(agentStatus.configured === false && agentStatus.qlooRequests === 0, 'Provider status was configured during a keyless verification.');
    check(agentStatus.providerStatus === (synthetic ? 'synthetic_mode' : 'not_configured'), 'Provider status did not identify the expected keyless mode.');
    if (!synthetic) check(agentStatus.requestsToday === 0, 'The isolated model request ledger was not empty.');
    let state = createState(data);
    let initial = await json('/api/repair-options', planningRequest(state));
    if (!synthetic && initial.result.status === 'hard_conflict') {
      const eligible = data.films.filter(film => film.eligible && film.runtime <= 240).sort((a, b) => a.runtime - b.runtime);
      check(eligible.length >= 4, 'Private evidence needs at least four eligible films to exercise cancellation repair.');
      state = changeConstraints(state, { maximumRuntime: Math.ceil(eligible[2].runtime) });
      initial = await json('/api/repair-options', planningRequest(state));
    }
    check(initial.result.status !== 'hard_conflict', 'The initial brief could not produce a three-night draft.');
    state = receiveProposal(state, initial, state.revision);
    check(state.approved === null, 'An initial proposal was applied without approval.');
    state = approveProposal(state);
    const original = [...state.approved.selection], locked = original.slice(0, 2), cancelled = original[2], currentLimit = state.maximumRuntime;
    state = changeConstraints(state, { locked, excluded: [cancelled] });
    const repair = await json('/api/repair-options', planningRequest(state));
    const preserves = result => result?.nightOrder?.slice(0, 2).every((id, index) => id === locked[index]) &&
      result.nightOrder.length === 3 && !result.nightOrder.includes(cancelled);
    if (repair.result.status !== 'hard_conflict') check(preserves(repair.result), 'The current-limit repair did not preserve the locked nights.');
    state = receiveProposal(state, repair, state.revision);
    check(state.maximumRuntime === currentLimit && JSON.stringify(state.approved.selection) === JSON.stringify(original), 'An unapproved repair changed the approved programme or limit.');
    if (synthetic) {
      check(repair.result.represented === 2 && repair.runtimeAlternative?.maximumRuntime === 117, 'The synthetic cancellation did not expose its expected runtime trade-off.');
      const currentApproved = approveProposal(state);
      check(currentApproved.maximumRuntime === 110 && preserves({ nightOrder: currentApproved.approved.selection }), 'The current-limit approval changed its limit or locked nights.');
    }
    const alternative = repair.runtimeAlternative;
    if (alternative) {
      check(alternative.maximumRuntime > currentLimit && preserves(alternative.result), 'The separate runtime alternative was invalid.');
      state = approveProposal(state, 'runtime');
      check(state.maximumRuntime === alternative.maximumRuntime, 'Explicit runtime approval did not apply its proposed limit.');
    } else {
      check(repair.result.status !== 'hard_conflict', 'Cancellation has no feasible repair in the private catalogue.');
      state = approveProposal(state);
      check(state.maximumRuntime === currentLimit, 'A current-limit approval changed the runtime.');
    }
    check(preserves({ nightOrder: state.approved.selection }), 'Approval lost a preserved night or restored the cancelled film.');
    check(JSON.stringify((await json('/api/bootstrap')).profiles) === JSON.stringify(data.profiles), 'Planning changed the original ranking evidence.');
    const payload = { ...planningRequest(state), seasonName: 'Docker verification programme', organiserNote: '', approvedAt: state.approved.approvedAt };
    const sheetResponse = await request('/api/programme-sheet?payload=' + encodeURIComponent(JSON.stringify(payload)));
    check(sheetResponse.status === 200 && sheetResponse.headers.get('content-type')?.startsWith('text/html'), 'Approved programme export failed.');
    const sheet = await sheetResponse.text();
    check(sheet.includes(`${state.maximumRuntime} minutes`), 'Export omitted the approved runtime limit.');
    for (const id of state.approved.selection) check(sheet.includes(escapeHtml(data.films.find(film => film.id === id).name)), 'Export omitted an approved film.');
    if (synthetic) check(/APPROVED SYNTHETIC SETUP|invented/i.test(sheet), 'Export failed to identify invented evidence.');
    else check(!sheet.includes('APPROVED SYNTHETIC SETUP'), 'Private evidence export was labelled synthetic.');
    for (const path of PRIVATE_ROUTES) check((await request(path)).status === 404, 'A private file route was exposed.');
    if (synthetic) {
      const stopped = await request('/api/agent', { message: 'Verify synthetic mode.', context: planningRequest(state) });
      check(stopped.status === 503 && (await stopped.json()).code === 'synthetic_mode', 'The synthetic assistant route was not disabled.');
      check((await request('/api/demo-scenarios')).status === 503, 'The synthetic recording route was not disabled.');
    } else if (recordingPath) {
      const recording = await json('/api/demo-scenarios');
      check(recording.mode === 'recorded' && recording.llmRequests === 0 && recording.qlooRequests === 0, 'The supplied recording was not served as a zero-request replay.');
      report.recordingVerified = true;
    }
    return { evidenceMode: synthetic ? 'synthetic' : 'operator_supplied_private', manualWorkflowVerified: true,
      cancellationVerified: true, lockedPositionsVerified: true, exportVerified: true, privateRoutesVerified: true,
      runtimeAlternativeAvailable: Boolean(alternative), runtimeAlternativeApprovalVerified: Boolean(alternative), providerConfigured: false };
  }
  async function scenario(synthetic) {
    const suffix = randomUUID(), volume = `reelbalance-verify-state-${suffix}`, container = `reelbalance-verify-app-${suffix}`,
      provisionContainer = `reelbalance-verify-provision-${suffix}`;
    volumes.add(volume); await docker(['volume', 'create', volume]);
    try {
      containers.add(provisionContainer);
      if (synthetic) {
        const rejected = await docker(['run', '--rm', '--name', provisionContainer, '--network', 'none', ...common(volume), image, 'node', 'scripts/public-provision.mjs',
          '--dataset', '/app/release/synthetic-data.json'], { allowFailure: true });
        check(rejected.code !== 0 && rejected.stderr.includes('private provisioning requires your own genuine evidence'), 'Private provisioning did not explicitly reject the synthetic fixture.');
        report.checks.push('Synthetic private provisioning rejected');
      } else {
        const provision = await docker(['run', '--rm', '--name', provisionContainer, '--network', 'none', ...common(volume),
          ...mount(resolve(temporary, 'private-dataset.json'), '/verification/private-dataset.json'),
          ...(recordingPath ? mount(resolve(temporary, 'private-recording.json'), '/verification/private-recording.json') : []),
          image, 'node', 'scripts/public-provision.mjs', '--dataset', '/verification/private-dataset.json',
          ...(recordingPath ? ['--recording', '/verification/private-recording.json'] : [])], { allowFailure: true });
        check(provision.code === 0, 'Private provisioning failed. Check the dataset and recording schema privately.');
        report.privateEvidenceProvisioned = true;
        report.checks.push('Operator-supplied private evidence structurally provisioned');
      }
      await cleanupContainer(provisionContainer);
      containers.add(container);
      await docker(['run', '--detach', '--name', container, '--pull', 'never', '--init', '--stop-timeout', '10', ...common(volume),
        '--publish', '127.0.0.1::4173', '--env', `APP_ORIGIN=${APP_ORIGIN}`, '--env', 'HOST=0.0.0.0', '--env', 'PORT=4173',
        '--env', 'REELBALANCE_ACCESS_MODE=public', ...(synthetic ? ['--env', 'REELBALANCE_DATASET_PATH=/app/release/synthetic-data.json'] : []), image]);
      let metadata = await inspect(container);
      const binding = metadata.NetworkSettings?.Ports?.['4173/tcp'];
      check(binding?.length === 1 && binding[0].HostIp === '127.0.0.1' && /^\d+$/.test(binding[0].HostPort), 'Verification was not published exclusively on an ephemeral loopback port.');
      check(metadata.HostConfig.Memory === MEMORY && metadata.HostConfig.MemorySwap === MEMORY && metadata.HostConfig.NanoCpus === 500_000_000, 'The runtime resource limits differ from the deployment caps.');
      const environment = metadata.Config.Env ?? [];
      check(!environment.some(entry => /^(OPENAI_API_KEY|QLOO_API_KEY|REELBALANCE_OWNER_TOKEN)=.+/.test(entry)), 'The verification container inherited a credential.');
      check(environment.includes('REELBALANCE_QLOO_LIVE=0'), 'Live Qloo collection was enabled.');
      const origin = `http://127.0.0.1:${binding[0].HostPort}`, started = Date.now();
      let ready = false;
      while (Date.now() - started < 30_000) {
        check(!interrupted, 'Docker verification was interrupted.');
        try { ready = (await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1500) })).status === 200; } catch {}
        if (ready) break;
        metadata = await inspect(container); running(metadata, 'The app exited before opening.');
        await new Promise(done => setTimeout(done, 1000));
      }
      check(ready, 'The Docker app did not become ready within 30 seconds.');
      const result = await verifyWorkflow(origin, synthetic);
      const scenarioReport = { ...result, dockerHealth: 'pending' };
      report.scenarios.push(scenarioReport);
      scenarioReport.startingStats = await statistics(container);
      const healthStarted = Date.now();
      while (Date.now() - healthStarted < 90_000) {
        check(!interrupted, 'Docker verification was interrupted.');
        metadata = await inspect(container);
        running(metadata, 'The verification container exited while checking health.');
        if (metadata.State.Health?.Status === 'healthy') break;
        check(metadata.State.Health?.Status === 'starting', 'Docker healthcheck became unhealthy or is missing.');
        await new Promise(done => setTimeout(done, 1000));
      }
      check(metadata.State.Health?.Status === 'healthy', 'Docker healthcheck did not become healthy.');
      const runtimeResult = await docker(['exec', container, 'node', '-e',
        `const fs=require('node:fs');const names=${JSON.stringify(USAGE_FILES)};const processes=[];
        for(const pid of fs.readdirSync('/proc').filter(pid=>/^\\d+$/.test(pid))){try{
          if(Number(pid)===process.pid)continue;
          if(fs.readFileSync('/proc/'+pid+'/comm','utf8').trim()!=='node')continue;
          const command=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');
          const role=command.includes('scripts/public-start.mjs')?'launcher':command.includes('app/server.mjs')?'app':null;
          if(role){const status=fs.readFileSync('/proc/'+pid+'/status','utf8');processes.push({role,rssKiB:Number(status.match(/^VmRSS:\\s+(\\d+)/m)?.[1]??0)});}
        }catch{}}
        if(!processes.some(item=>item.role==='app'))for(const item of processes)if(item.role==='launcher')item.role='server';
        process.stdout.write(JSON.stringify({uid:process.getuid(),providerAttemptFilesAbsent:!names.some(name=>fs.existsSync('/app/.cache/'+name)),processes}));`]);
      let runtime;
      try { runtime = JSON.parse(runtimeResult.stdout); } catch { throw new VerificationError('Docker returned invalid nonroot runtime diagnostics.'); }
      check(runtime.uid === 1000, 'The app did not run as the nonroot node user.');
      check(runtime.providerAttemptFilesAbsent === true, 'Verification created a provider-attempt ledger or blocked an external fetch.');
      const stats = await statistics(container);
      running(await inspect(container), 'The verification container exited after collecting statistics.');
      Object.assign(scenarioReport, { dockerHealth: 'healthy', uid: 1000, memoryLimitBytes: MEMORY, memorySwapLimitBytes: MEMORY,
        cpuLimit: 0.5, oomKilled: false, providerAttemptFilesAbsent: true, nodeProcesses: runtime.processes, stats });
      console.log(`${synthetic ? 'Synthetic' : 'Private evidence'} Docker workflow passed; health healthy, UID 1000, 256 MiB cap. Stats: ${JSON.stringify(stats)}`);
      if (synthetic) report.syntheticVerified = true; else report.genuineEvidenceVerified = true;
    } finally {
      if (containers.has(container)) await cleanupContainer(container);
      if (containers.has(provisionContainer)) await cleanupContainer(provisionContainer);
      await cleanupVolume(volume);
    }
  }
  try {
    await chmod(temporary, 0o700);
    check(!temporary.includes(','), 'The checkout path must not contain a comma for Docker file mounts.');
    await writeFile(blocker, FETCH_BLOCKER, { flag: 'wx', mode: 0o444 }); await chmod(blocker, 0o444);
    if (datasetPath) await stagePrivateFile(datasetPath, resolve(temporary, 'private-dataset.json'), 512 * 1024);
    if (recordingPath) await stagePrivateFile(recordingPath, resolve(temporary, 'private-recording.json'), 64 * 1024);
    console.log(`Building ${image} for ${platform}. Provider verification is disabled.`);
    await docker(['build', '--platform', platform, '--tag', image, '.'], { inherit: true, timeout: 15 * 60_000 });
    const imageResult = await docker(['image', 'inspect', '--format', '{"architecture":{{json .Architecture}},"os":{{json .Os}},"user":{{json .Config.User}}}', image]);
    let imageInfo;
    try { imageInfo = JSON.parse(imageResult.stdout); } catch { throw new VerificationError('Docker returned invalid image metadata.'); }
    check(imageInfo.os === 'linux' && imageInfo.architecture === platform.split('/')[1], 'The built image architecture does not match the requested platform.');
    check(imageInfo.user && !['root', '0'].includes(imageInfo.user.split(':')[0]), 'The Docker image defaults to a root user.');
    report.imageArchitecture = imageInfo.architecture; report.imageUser = imageInfo.user; report.dockerBuildVerified = true;
    await scenario(true);
    if (datasetPath) await scenario(false);
    report.checks.push('Manual approval, cancellation and export', 'Original ranks unchanged', 'Private routes return 404',
      'Nonroot runtime and deployment resource caps', 'Docker healthcheck healthy', 'No provider attempt files');
    report.result = 'passed';
  } catch (error) { failure = error; report.failure = 'Verification did not complete; see the sanitized CLI error.'; }
  finally {
    for (const name of [...containers]) await cleanupContainer(name).catch(() => {});
    for (const name of [...volumes]) await cleanupVolume(name).catch(() => {});
    await rm(temporary, { recursive: true, force: true }).catch(() => { report.temporaryCleanupFailed = true; });
    report.ephemeralResourcesRemoved = containers.size === 0 && volumes.size === 0 && !report.temporaryCleanupFailed;
    if (!report.ephemeralResourcesRemoved) { report.result = 'failed'; failure ??= new VerificationError('Verification cleanup failed. Remove the remaining verification Docker resources before continuing.'); }
    report.evidenceScope = !datasetPath ? 'Invented fixture only; genuine private evidence and live providers remain unverified.'
      : report.privateEvidenceProvisioned ? 'Operator-supplied private evidence was structurally provisioned; source authenticity was not independently verified.'
        : 'Private evidence was supplied but provisioning was not verified; live providers remain unverified.';
    const pendingReport = resolve(cache, `docker-verification-report-${randomUUID()}.tmp`);
    try {
      await writeFile(pendingReport, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(pendingReport, resolve(cache, 'docker-verification.json'));
    } finally { await rm(pendingReport, { force: true }); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
  }
  if (failure) throw failure;
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseDockerVerifyArgs(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else {
      const report = await verifyDocker(options);
      console.log(`Docker verification passed. Genuine evidence verified: ${report.genuineEvidenceVerified}; live providers verified: false. Report: .cache/docker-verification.json.`);
    }
  } catch (error) {
    console.error(error instanceof VerificationError ? error.message : 'Docker verification failed. Inspect the Docker engine, build output and private inputs locally.');
    process.exitCode = 1;
  }
}
