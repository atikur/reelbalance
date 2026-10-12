import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The official Pi dependency publishes its own shrinkwrap. Apply only these
// reviewed patch releases after npm ci; do not re-resolve the wider Pi tree.
const args = process.argv.slice(2);
const updateAuditMetadata = args.at(-1) === '--update-audit-metadata';
if (updateAuditMetadata) args.pop();
if (args.length !== 2 || args.some(value => !value || value.startsWith('--'))) {
  throw Error('Usage: node patch-qloo-dependencies.mjs <app-root> <security-leaf-package> [--update-audit-metadata]');
}
const [rootArgument, stagingArgument] = args;
const root = resolve(rootArgument);
const staging = resolve(stagingArgument);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const tree = resolve(root, 'node_modules/@earendil-works/pi-coding-agent');
const rootLockPath = resolve(root, 'package-lock.json');
const rootLock = read(rootLockPath);
const stageLock = read(resolve(staging, 'package-lock.json'));
if (read(resolve(root, 'node_modules/@qloo/qloo-harness/package.json')).version !== '0.1.26' ||
    read(resolve(tree, 'package.json')).version !== '0.84.2') throw Error('Unexpected harness/Pi version; review before patching.');
if (read(resolve(tree, 'node_modules/balanced-match/package.json')).version !== '4.0.4') throw Error('Unexpected shared brace dependency; review before patching.');
const releases = [{ name: 'undici', before: '8.9.0', after: '8.10.2' },
  { name: 'brace-expansion', before: '5.0.9', after: '5.0.12' }];
// Validate both leaves before replacing either.
for (const item of releases) {
  const installed = read(resolve(tree, `node_modules/${item.name}/package.json`));
  const staged = read(resolve(staging, `node_modules/${item.name}/package.json`));
  const locked = stageLock.packages?.[`node_modules/${item.name}`];
  if (installed.name !== item.name || ![item.before, item.after].includes(installed.version) ||
      staged.name !== item.name || staged.version !== item.after || locked?.version !== item.after ||
      locked.resolved !== `https://registry.npmjs.org/${item.name}/-/${item.name}-${item.after}.tgz` ||
      !locked.integrity?.startsWith('sha512-')) throw Error(`Unexpected ${item.name} package; review before patching.`);
}
for (const item of releases) {
  const target = resolve(tree, `node_modules/${item.name}`);
  rmSync(target, { recursive: true, force: true });
  cpSync(resolve(staging, `node_modules/${item.name}`), target, { recursive: true, dereference: false });
  rootLock.packages[`node_modules/@earendil-works/pi-coding-agent/node_modules/${item.name}`] =
    { ...stageLock.packages[`node_modules/${item.name}`], dev: true };
}
// Keep the image's audit metadata consistent with its actual patched files.
// A subsequent npm ci must repeat this post-install patch because Pi shrinkwrap
// still specifies the older leaves. Pi and harness manifests remain unchanged.
// Source installations retain the checked-in root lock. Image builds opt in to
// recording their actual patched tree for audit; npm ci still needs this patch.
if (updateAuditMetadata) writeFileSync(rootLockPath, `${JSON.stringify(rootLock, null, 2)}\n`);
const hiddenLock = resolve(root, 'node_modules/.package-lock.json');
if (existsSync(hiddenLock)) {
  const value = read(hiddenLock);
  for (const item of releases) value.packages[`node_modules/@earendil-works/pi-coding-agent/node_modules/${item.name}`] =
    rootLock.packages[`node_modules/@earendil-works/pi-coding-agent/node_modules/${item.name}`];
  writeFileSync(hiddenLock, `${JSON.stringify(value, null, 2)}\n`);
}
console.log(JSON.stringify({ harness: '0.1.26', pi: '0.84.2', undici: '8.10.2', braceExpansion: '5.0.12', locallyPatched: true }));
