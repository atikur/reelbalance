import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../app/server.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export async function resolvePublicRuntime({ directory = ROOT, environment = process.env } = {}) {
  const root = resolve(directory);
  let configuration = null;
  if (!environment.REELBALANCE_DATASET_PATH) {
    try {
      const bytes = await readFile(resolve(root, '.cache/private-runtime/runtime.json'));
      if (bytes.length > 4096) throw new Error('Private runtime configuration is too large.');
      configuration = JSON.parse(bytes.toString('utf8'));
      if (configuration.schemaVersion !== 1 || configuration.datasetPath !== '.cache/private-runtime/dataset.json' ||
          ![null, '.cache/private-runtime/recording.json'].includes(configuration.recordingPath)) throw new Error('Private runtime configuration is invalid.');
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('The private runtime configuration could not be verified.'); }
  }
  return {
    datasetPath: environment.REELBALANCE_DATASET_PATH || resolve(root, configuration?.datasetPath ?? 'release/synthetic-data.json'),
    recordingPath: environment.REELBALANCE_RECORDING_PATH || (configuration?.recordingPath ? resolve(root, configuration.recordingPath) : resolve(root, '.cache/private-runtime/no-recording.json')),
    source: environment.REELBALANCE_DATASET_PATH ? 'explicit_private_dataset' : configuration ? 'provisioned_private_dataset' : 'synthetic',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const runtime = await resolvePublicRuntime();
    await startServer({ datasetPath: resolve(ROOT, runtime.datasetPath), recordingPath: resolve(ROOT, runtime.recordingPath) });
  } catch { console.error('The local app could not start. Check Node.js, server settings and the runtime configuration.'); process.exitCode = 1; }
}
