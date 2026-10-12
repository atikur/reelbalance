import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MODULES = ['server.mjs', 'programme-service.mjs', 'agent-service.mjs', 'demo-service.mjs', 'taste-service.mjs', 'qloo-runtime.mjs', 'public-access.mjs'];
const ASSETS = ['index.html', 'app.js', 'state.js', 'styles.css', 'favicon.svg'];
const RUNTIME_SCRIPTS = ['reelbalance-solver.mjs', 'qloo-fetch-guard.mjs', 'setup-openai.mjs',
  'public-export.mjs', 'public-start.mjs', 'public-provision.mjs', 'public-rehearse.mjs',
  'provider-admin.mjs', 'check-assistant.mjs', 'docker-verify.mjs', 'patch-qloo-dependencies.mjs'];
const QLOO_SECURITY_METADATA = ['scripts/qloo-security/package.json', 'scripts/qloo-security/package-lock.json'];
const RELEASE_ASSETS = ['synthetic-data.json', 'README.md', 'package.json', '.env.example', '.gitignore', 'Dockerfile', '.dockerignore', 'public-smoke.test.mjs', '.github/workflows/check.yml'];
const OPTIONAL_TESTS = ['public-access.test.mjs', 'public-http.test.mjs', 'public-ui.test.mjs', 'qloo-runtime.test.mjs', 'taste-service.test.mjs'];
const OPTIONAL_SCRIPT_TESTS = ['provider-admin.test.mjs', 'check-assistant.test.mjs'];
const OPTIONAL_DOCS = ['submission-draft.md', 'judge-demo.md', 'deployment.md'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function validateSynthetic(value) {
  const fields = ['id', 'synthetic', 'source', 'checkedAt', 'endpoint', 'requestedPerProfile', 'disclosure', 'eligibility', 'runtimePolicy'];
  const filmFields = ['id', 'catalogue_id', 'name', 'year', 'runtime', 'eligible', 'sourceUrl', 'primaryRuntime', 'metadataNote'];
  const heads = [[1, 7, 8, 9, 10], [2, 11, 12, 14, 16], [3, 5, 13, 15, 17, 4]];
  const all = Array.from({ length: 20 }, (_, index) => index + 1);
  if (!exactKeys(value, ['schemaVersion', 'dataset', 'films', 'profiles']) || value.schemaVersion !== 1 || !exactKeys(value.dataset, fields) ||
      value.dataset.synthetic !== true || value.dataset.id !== 'reelbalance-synthetic-v1' || value.dataset.source !== 'Synthetic demonstration fixtures' ||
      value.dataset.checkedAt !== '' || value.dataset.endpoint !== '' || value.dataset.requestedPerProfile !== null ||
      !Array.isArray(value.films) || value.films.length !== 20 || !Array.isArray(value.profiles) || value.profiles.length !== 3) return false;
  for (const [index, film] of value.films.entries()) {
    if (!exactKeys(film, filmFields) || film.id !== `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}` ||
        film.catalogue_id !== `S${String(index + 1).padStart(2, '0')}` || film.name !== `Synthetic film ${String(index + 1).padStart(2, '0')}` ||
        !Number.isInteger(film.year) || !Number.isInteger(film.runtime) || film.runtime < 1 || film.runtime > 240 || film.eligible !== true ||
        film.sourceUrl !== null || film.primaryRuntime !== null || film.metadataNote !== 'Invented title, identity and runtime for code testing; no real film or Qloo response.') return false;
  }
  for (const [index, profile] of value.profiles.entries()) {
    const order = [...heads[index], ...all.filter(number => !heads[index].includes(number))];
    const expected = Object.fromEntries(order.map((number, rank) => [value.films[number - 1].id, rank + 1]));
    if (!exactKeys(profile, ['id', 'name', 'reference', 'ranks']) || profile.id !== `synthetic-${index + 1}` ||
        profile.name !== `Taste profile ${String(index + 1).padStart(2, '0')}` || profile.reference !== `Fictional ensemble ${String(index + 1).padStart(2, '0')}` ||
        !exactKeys(profile.ranks, Object.keys(expected)) || Object.entries(expected).some(([id, rank]) => profile.ranks[id] !== rank)) return false;
  }
  return true;
}

async function safeRead(path, maximum = 4 * 1024 * 1024) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw new Error('Public export requires regular, bounded source files.');
  return readFile(path);
}

function assertResponseFree(path, bytes) {
  const text = bytes.toString('utf8');
  if (/\bsk-(?:proj-)?[a-z0-9_-]{24,}\b/i.test(text) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
      /\/Users\/[^\s"']+/.test(text) || /\/home\/(?!node\/)[^\s"']+/.test(text)) throw new Error(`The export source ${path} contains a credential or machine-specific path pattern.`);
  if (path.endsWith('.json') && !['package.json', 'package-lock.json', 'release/package.json', 'release/synthetic-data.json', ...QLOO_SECURITY_METADATA].includes(path)) {
    throw new Error('Only package metadata and the explicitly synthetic data fixture may be exported as JSON.');
  }
}

export async function buildPublicExport({ sourceDirectory = ROOT, outputDirectory = resolve(sourceDirectory, '.cache/public-source-export'), now = Date.now } = {}) {
  const source = resolve(sourceDirectory);
  const output = resolve(outputDirectory);
  const relation = relative(output, source);
  if (output === source || (relation && !relation.startsWith('..') && !relation.startsWith('/'))) throw new Error('The export destination cannot contain the source workspace.');
  try { await lstat(output); throw new Error('The public export destination already exists. Choose a new empty destination; files will not be overwritten.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const paths = [
    ...MODULES.map(name => [`app/${name}`, `app/${name}`]),
    ...ASSETS.map(name => [`app/public/${name}`, `app/public/${name}`]),
    ...RUNTIME_SCRIPTS.map(name => [`scripts/${name}`, `scripts/${name}`]),
    ...QLOO_SECURITY_METADATA.map(path => [path, path]),
    ...RELEASE_ASSETS.map(name => [`release/${name}`, `release/${name}`]),
    ['LICENSE', 'LICENSE'], ['release/README.md', 'README.md'], ['release/.env.example', '.env.example'],
    ['release/.gitignore', '.gitignore'], ['release/Dockerfile', 'Dockerfile'], ['release/.dockerignore', '.dockerignore'],
    ['release/public-smoke.test.mjs', 'scripts/public-smoke.test.mjs'],
    ['release/.github/workflows/check.yml', '.github/workflows/check.yml'],
  ];
  const includedTests = [];
  for (const name of OPTIONAL_TESTS) {
    try {
      const bytes = await safeRead(resolve(source, 'app', name));
      if (/loadDemoDataset\(|(?:app\/)?data\/demo\.json|reports\/|results\//.test(bytes.toString('utf8'))) {
        throw new Error(`The optional public test ${name} depends on private evidence.`);
      }
      paths.push([`app/${name}`, `app/${name}`]); includedTests.push(`app/${name}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const name of OPTIONAL_DOCS) {
    try { await safeRead(resolve(source, 'docs', name)); paths.push([`docs/${name}`, `docs/${name}`]); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  for (const name of OPTIONAL_SCRIPT_TESTS) {
    try {
      await safeRead(resolve(source, 'scripts', name));
      paths.push([`scripts/${name}`, `scripts/${name}`]); includedTests.push(`scripts/${name}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  // Read and validate only the explicit allowlist. Private datasets, provider
  // responses, credentials, caches and repository history are never opened.
  const files = new Map();
  for (const [from, to] of paths) {
    const bytes = await safeRead(resolve(source, from));
    assertResponseFree(to, bytes); files.set(to, bytes);
  }
  const synthetic = JSON.parse(files.get('release/synthetic-data.json').toString('utf8'));
  if (!validateSynthetic(synthetic)) throw new Error('The public sample must contain only the designated fictional synthetic fixtures.');

  const packageTemplate = JSON.parse(files.get('release/package.json').toString('utf8'));
  packageTemplate.scripts.test = ['node --test scripts/public-smoke.test.mjs', ...includedTests].join(' ');
  const packageBytes = Buffer.from(`${JSON.stringify(packageTemplate, null, 2)}\n`);
  const lock = JSON.parse((await safeRead(resolve(source, 'package-lock.json'))).toString('utf8'));
  if (lock.packages?.['']?.devDependencies?.['@qloo/qloo-harness'] !== packageTemplate.devDependencies['@qloo/qloo-harness']) throw new Error('The pinned public harness dependency and lockfile differ.');
  lock.name = packageTemplate.name; lock.version = packageTemplate.version;
  Object.assign(lock.packages[''], { name: packageTemplate.name, version: packageTemplate.version, engines: packageTemplate.engines, license: packageTemplate.license });
  const lockBytes = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`);
  assertResponseFree('package.json', packageBytes); assertResponseFree('package-lock.json', lockBytes);
  files.set('package.json', packageBytes); files.set('package-lock.json', lockBytes);

  const manifest = { schemaVersion: 1, name: 'ReelBalance public source package', kind: 'source_and_synthetic_fixtures', generatedAt: new Date(now()).toISOString(),
    data: { syntheticOnly: true, containsApiResponses: false, containsRecordedModelResponses: false },
    excluded: ['.git', '.env', '.env.local', '.cache', 'app/data', 'eval', 'results', 'reports', 'node_modules'],
    files: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) })) };
  await mkdir(output, { recursive: true });
  for (const [path, bytes] of files) {
    const target = resolve(output, path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx', mode: 0o644 });
  }
  await writeFile(resolve(output, 'public-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  return { outputDirectory: output, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--output' && args[1])) throw new Error('Use public-export.mjs [--output new-directory].');
  const result = await buildPublicExport({ ...(args.length ? { outputDirectory: args[1] } : {}) });
  console.log(`Prepared ${result.manifest.files.length} source and synthetic-fixture files at ${result.outputDirectory}. No APIs were called; nothing was published.`);
}
