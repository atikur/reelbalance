import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgrammeService } from '../app/programme-service.mjs';
import { createTasteService } from '../app/taste-service.mjs';
import { createState, planningRequest, receiveProposal, approveProposal, changeConstraints, makeSheetHtml } from '../app/public/state.js';

const synthetic = JSON.parse(await readFile(new URL('../release/synthetic-data.json', import.meta.url), 'utf8'));

test('invented fixtures are explicitly labelled and contain no real film identities or taste data', () => {
  assert.equal(synthetic.dataset.synthetic, true);
  assert.equal(synthetic.films.length, 20);
  assert.equal(synthetic.profiles.length, 3);
  for (const film of synthetic.films) {
    assert.match(film.id, /^00000000-0000-4000-9000-\d{12}$/);
    assert.match(film.name, /^Synthetic /);
    assert.equal(film.sourceUrl, null);
  }
  assert.ok(synthetic.profiles.every(profile => profile.reference.startsWith('Fictional ')));
  assert.equal(createProgrammeService(synthetic).bootstrap().dataset.synthetic, true);
});

test('the synthetic manual workflow preserves locks and requires separate approval of a runtime change', () => {
  const service = createProgrammeService(synthetic);
  let state = createState(service.bootstrap());
  state = receiveProposal(state, service.repairOptions(planningRequest(state)), state.revision);
  assert.equal(state.approved, null);
  state = approveProposal(state);
  const preserved = state.approved.selection.slice(0, 2);
  const cancelled = state.approved.selection[2];
  state = changeConstraints(state, { locked: preserved, excluded: [cancelled] });
  const repair = service.repairOptions(planningRequest(state));
  assert.equal(repair.result.represented, 2);
  assert.equal(repair.runtimeAlternative.maximumRuntime, 117);
  state = receiveProposal(state, repair, state.revision);
  assert.equal(state.maximumRuntime, 110);
  assert.deepEqual(state.approved.selection.slice(0, 2), preserved);
  state = approveProposal(state, 'runtime');
  assert.equal(state.maximumRuntime, 117);
  assert.deepEqual(state.approved.selection.slice(0, 2), preserved);
  assert.ok(!state.approved.selection.includes(cancelled));
  assert.match(makeSheetHtml(state), /synthetic|invented/i);
});

test('synthetic rank generation remains original after unavailable films are filtered', () => {
  const service = createProgrammeService(synthetic);
  const initial = service.programme({ slots: 3, maximumRuntime: 110, excluded: [], locked: [], current: [] });
  const request = { slots: 3, maximumRuntime: 110, excluded: [initial.nightOrder[2]], locked: initial.nightOrder.slice(0, 2), current: initial.nightOrder };
  const repair = service.repairOptions(request);
  assert.equal(repair.result.evidence[2].best_cached_rank, 6);
  assert.equal(repair.result.evidence[2].known_top_k_support, false);
  assert.equal(repair.runtimeAlternative.result.evidence[2].best_cached_rank, 2);
  assert.ok(repair.result.checks.ranksUnchanged);
  assert.equal(repair.result.checks.networkRequests, 0);
});

test('judge taste cache retains earlier selections beyond the former storage limits', async t => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'reelbalance-taste-capacity-'));
  t.after(() => rm(cacheDirectory, { recursive: true, force: true }));
  // Every identity and response here is invented. No provider or private
  // evidence is used, and completed datasets retain their synthetic label.
  const fetchedAt = '2026-10-12T00:00:00.000Z';
  let requests = 0;
  const runtime = {
    status: async () => ({ paused: false }),
    pause: async () => assert.fail('Valid invented responses must not pause the runtime'),
    execute: async request => {
      requests++;
      if (request.operation === 'search') {
        const number = Number(request.query.match(/(\d+)$/)[1]);
        return { fetchedAt, qlooRequests: 1, entities: [{
          entity_id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
          name: request.query, subtype: 'urn:entity:artist',
        }] };
      }
      assert.equal(request.operation, 'rank');
      return { fetchedAt, qlooRequests: 1, entities: synthetic.films.map((film, index) => ({
        entity_id: film.id, name: film.name, subtype: 'urn:entity:movie', affinity: 1 - index / 20,
      })) };
    },
  };
  const serviceOptions = { baseDataset: synthetic, cacheDirectory, seedArtists: [], liveEnabled: true,
    now: () => Date.parse(fetchedAt), runtime };
  const service = createTasteService(serviceOptions);
  const selections = [];
  let earliest;
  // Distinct triplets exceed all three old caps: 24 searches, 12 selections,
  // and 60 rankings. Each must remain usable without evicting earlier work.
  for (let selection = 0; selection < 21; selection++) {
    const artists = [];
    for (let member = 0; member < 3; member++) {
      const match = await service.search({ query: `Fictional capacity artist ${selection * 3 + member + 1}`, live: true });
      artists.push({ searchId: match.searchId, artistId: match.options[0].id });
    }
    const selected = await service.select({ artists });
    selections.push(selected.evidenceId);
    for (let member = 0; member < 3; member++) await service.rankNext({ evidenceId: selected.evidenceId, live: true });
    const completed = await service.completed(selected.evidenceId);
    assert.equal(completed.dataset.dataset.synthetic, true);
    if (!earliest) earliest = completed;
  }
  const beforeReload = requests;
  const reopened = createTasteService({ ...serviceOptions, liveEnabled: false });
  assert.deepEqual(await reopened.completed(selections[0]), earliest);
  for (const evidenceId of selections) assert.equal((await reopened.progress({ evidenceId })).status, 'complete');
  assert.equal(requests, beforeReload, 'Reading retained evidence must not call the provider');
  assert.ok((await readFile(join(cacheDirectory, 'taste-cache.json'))).byteLength < 2 * 1024 * 1024);
});

test('invalid and oversized taste caches fail closed before provider execution', async t => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'reelbalance-taste-invalid-'));
  t.after(() => rm(cacheDirectory, { recursive: true, force: true }));
  const runtime = {
    status: async () => ({ paused: false }),
    execute: async () => assert.fail('An invalid cache must prevent provider execution'),
    pause: async () => assert.fail('Cache validation must not change the provider guard'),
  };
  const service = createTasteService({ baseDataset: synthetic, cacheDirectory, seedArtists: [], liveEnabled: true, runtime });
  const cachePath = join(cacheDirectory, 'taste-cache.json');
  for (const content of [JSON.stringify({ schemaVersion: 999 }), `${' '.repeat(2 * 1024 * 1024)}{}`]) {
    await writeFile(cachePath, content);
    await assert.rejects(service.search({ query: 'Fictional artist', live: true }), { code: 'taste_cache_unavailable' });
    assert.equal(await readFile(cachePath, 'utf8'), content, 'Rejected caches must remain untouched');
  }
});
