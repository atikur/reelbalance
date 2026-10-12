import { lstat, readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProgrammeService } from '../app/programme-service.mjs';
import { createDemoService } from '../app/demo-service.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

async function readInput(path, maximum) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw new Error('Provide a regular, bounded private JSON file.');
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function provisionPrivateRuntime({ directory = ROOT, datasetPath, recordingPath } = {}) {
  if (typeof datasetPath !== 'string' || !datasetPath) throw new Error('Include the path to your own private dataset.');
  const root = resolve(directory);
  const raw = await readInput(resolve(datasetPath), 512 * 1024);
  if (raw.dataset?.synthetic === true) throw new Error('Use the built-in synthetic example directly; private provisioning requires your own genuine evidence.');
  const service = createProgrammeService(raw);
  const dataset = service.bootstrap();
  if (dataset.films.length !== 20 || dataset.films.some(film => !UUID.test(film.id)) ||
      !dataset.dataset.source || !dataset.dataset.checkedAt || !Number.isFinite(Date.parse(dataset.dataset.checkedAt))) {
    throw new Error('Provide a validated 20-film dataset with canonical IDs and evidence-source metadata.');
  }
  let recording = null;
  if (recordingPath !== undefined) recording = createDemoService({ programmeService: service, recording: await readInput(resolve(recordingPath), 64 * 1024) }).scenarios();
  const destination = resolve(root, '.cache/private-runtime');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const info = await lstat(destination);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The private runtime directory must be a regular directory.');
  const configuration = { schemaVersion: 1, datasetPath: '.cache/private-runtime/dataset.json', recordingPath: recording ? '.cache/private-runtime/recording.json' : null };
  const inputs = [['dataset.json', dataset], ...(recording ? [['recording.json', recording]] : []), ['runtime.json', configuration]];
  for (const [name, value] of inputs) {
    const temporary = resolve(destination, `${name}-${randomUUID()}.tmp`);
    try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); await rename(temporary, resolve(destination, name)); }
    finally { await unlink(temporary).catch(() => {}); }
  }
  return { configuration, filmCount: dataset.films.length, profileCount: dataset.profiles.length, recordingIncluded: Boolean(recording) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!(args.length === 2 || args.length === 4) || args[0] !== '--dataset' || !args[1] || (args.length === 4 && (args[2] !== '--recording' || !args[3]))) {
    throw new Error('Use public-provision.mjs --dataset your-private-dataset.json [--recording your-private-recording.json].');
  }
  const result = await provisionPrivateRuntime({ datasetPath: args[1], ...(args.length === 4 ? { recordingPath: args[3] } : {}) });
  console.log(`Provisioned ${result.filmCount} private film records and ${result.profileCount} profiles. Recording ${result.recordingIncluded ? 'included' : 'not supplied'}. Files stay in ignored .cache/private-runtime; no APIs were called.`);
}
