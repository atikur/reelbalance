import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTasteService } from './taste-service.mjs';
import { createProgrammeService } from './programme-service.mjs';

// Invented fixture identities, rankings and provider responses only.
const synthetic = JSON.parse(await readFile(new URL('../release/synthetic-data.json', import.meta.url), 'utf8'));
const base = createProgrammeService(synthetic).bootstrap();
const WHEN = '2030-01-01T12:00:00.000Z';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const catalogueSha256 = hash({ id: base.dataset.id, films: base.films });
const artistId = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const artistName = number => `Fictional cache artist ${number}`;
const option = number => ({ id: artistId(number), name: artistName(number), type: 'artist' });
const seedArtists = base.profiles.map((profile, index) => ({ id: artistId(2001 + index), name: profile.reference,
  profileId: profile.id, checkedAt: WHEN }));
const ranking = number => ({ key: hash({ catalogueSha256, artistId: artistId(number) }), artistId: artistId(number),
  artistName: artistName(number), fetchedAt: WHEN, ranking: [] });
const search = (number, extra = []) => {
  const record = { query: artistName(number), fetchedAt: WHEN, options: [option(number), ...extra.map(option)] };
  return { searchId: `search-${hash(record).slice(0, 32)}`, ...record };
};
const evidence = numbers => {
  const artists = numbers.map(number => ({ id: artistId(number), name: artistName(number) }));
  return { evidenceId: `rb-taste-${hash({ catalogueSha256, artists: artists.map(item => item.id) }).slice(0, 32)}`,
    createdAt: WHEN, artists };
};
const store = ({ searches = [], evidence: evidenceRecords = [], rankings = [] } = {}) =>
  ({ schemaVersion: 1, catalogueSha256, searches, evidence: evidenceRecords, rankings });
const selection = (store, numbers) => ({ artists: numbers.map(number => ({
  searchId: store.searches.find(record => record.options.some(item => item.id === artistId(number))).searchId,
  artistId: artistId(number),
})) });

async function setup(t) {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'reelbalance-taste-pools-'));
  t.after(() => rm(cacheDirectory, { recursive: true, force: true }));
  const cachePath = join(cacheDirectory, 'taste-cache.json');
  const calls = { executions: 0, pauses: 0 };
  const runtime = {
    status: async () => ({ paused: false }),
    pause: async () => { calls.pauses++; },
    execute: async (request, { beforeRequest } = {}) => {
      // Model the Qloo runtime's ordering: quota rejection occurs before CLI
      // execution and provider reservation, and cached reads never reach here.
      if (beforeRequest) await beforeRequest();
      calls.executions++;
      const entities = request.operation === 'search'
        ? [{ entity_id: artistId(Number(request.query.match(/(\d+)$/)?.[1] ?? 1999)),
          name: request.query, subtype: 'urn:entity:artist' }]
        : base.films.map((film, index) => ({ entity_id: film.id, name: film.name,
          subtype: 'urn:entity:movie', affinity: 1 - index / base.films.length }));
      return { entities, fetchedAt: WHEN, qlooRequests: 1 };
    },
  };
  const make = pool => createTasteService({ baseDataset: synthetic, cacheDirectory, seedArtists,
    pool, liveEnabled: true, now: () => Date.parse(WHEN), runtime });
  const save = value => writeFile(cachePath, JSON.stringify(value));
  const read = async () => JSON.parse(await readFile(cachePath, 'utf8'));
  return { cachePath, calls, make, save, read, runtime };
}

test('fresh taste retrieval reserves guest quota once; cached searches and seed rankings reserve none', async t => {
  const { calls, make } = await setup(t);
  const publicService = make('public');
  let reservations = 0;
  const beforeLiveRequest = () => { reservations++; };
  const fresh = await publicService.search({ query: artistName(1), live: true }, { beforeLiveRequest });
  assert.equal(fresh.qlooRequests, 1);
  assert.equal(reservations, 1);
  const cached = await publicService.search({ query: artistName(1), live: true },
    { beforeLiveRequest: () => assert.fail('Cached search reserved quota') });
  assert.equal(cached.qlooRequests, 0);
  const seed = await publicService.search({ query: seedArtists[0].name, live: true },
    { beforeLiveRequest: () => assert.fail('Seed search reserved quota') });
  assert.equal(seed.source, 'cached_example');
  const selected = await publicService.select({ artists: seedArtists.map(artist =>
    ({ searchId: 'known-artists-v1', artistId: artist.id })) });
  const completed = await publicService.rankNext({ evidenceId: selected.evidenceId, live: true },
    { beforeLiveRequest: () => assert.fail('Seed rankings reserved quota') });
  assert.equal(completed.status, 'complete');
  assert.equal(completed.qlooRequests, 0);
  assert.equal(calls.executions, 1);
  assert.equal(calls.pauses, 0);
});

test('rejected guest Qloo reservations reach neither provider execution nor pause for search and rank', async t => {
  const { calls, make, save } = await setup(t);
  const fixtureStore = store({ searches: [1, 2, 3].map(number => search(number)), evidence: [evidence([1, 2, 3])] });
  await save(fixtureStore);
  const service = make('public');
  for (const code of ['guest_qloo_limit_reached', 'access_unavailable']) {
    const beforeLiveRequest = () => { throw Object.assign(Error('Invented quota rejection'), { code }); };
    await assert.rejects(service.search({ query: artistName(4), live: true }, { beforeLiveRequest }), { code });
    await assert.rejects(service.rankNext({ evidenceId: fixtureStore.evidence[0].evidenceId, live: true }, { beforeLiveRequest }), { code });
  }
  assert.equal(calls.executions, 0);
  assert.equal(calls.pauses, 0);
});

test('fresh ranking calls the quota hook once while completed cached rankings never call it', async t => {
  const { calls, make, save, read } = await setup(t);
  const fixtureStore = store({ searches: [1, 2, 3].map(number => search(number)), evidence: [evidence([1, 2, 3])] });
  await save(fixtureStore);
  const service = make('public');
  let reservations = 0;
  const next = await service.rankNext({ evidenceId: fixtureStore.evidence[0].evidenceId, live: true },
    { beforeLiveRequest: () => { reservations++; } });
  assert.equal(next.qlooRequests, 1);
  assert.equal(reservations, 1);
  const retained = await read();
  retained.rankings.push(ranking(2), ranking(3));
  await save(retained);
  const completed = await service.rankNext({ evidenceId: fixtureStore.evidence[0].evidenceId, live: true },
    { beforeLiveRequest: () => assert.fail('Completed ranking reserved quota') });
  assert.equal(completed.status, 'complete');
  assert.equal(completed.qlooRequests, 0);
  assert.equal(calls.executions, 1);
  assert.equal(calls.pauses, 0);
});

test('public search admission stops at 1000 while judges retain capacity through 1200', async t => {
  const { calls, make, save, read } = await setup(t);
  await save(store({ searches: Array.from({ length: 1000 }, (_, index) => search(index + 1)) }));
  const publicService = make('public');
  const judges = make('judge');
  await assert.rejects(publicService.search({ query: artistName(1201), live: true }), { code: 'taste_storage_full' });
  assert.equal(calls.executions, 0);
  await judges.search({ query: artistName(1201), live: true });
  assert.equal((await read()).searches.length, 1001);
  await save(store({ searches: Array.from({ length: 1200 }, (_, index) => search(index + 1)) }));
  await assert.rejects(judges.search({ query: artistName(1201), live: true }), { code: 'taste_storage_full' });
  assert.equal((await publicService.search({ query: artistName(1), live: true })).qlooRequests, 0);
  assert.equal(calls.executions, 1);
  assert.equal(calls.pauses, 0);
});

test('public evidence admission stops at 500 while judges retain capacity through 600', async t => {
  const { calls, make, save, read } = await setup(t);
  const fixtureStore = store({ searches: Array.from({ length: 700 }, (_, index) => search(index + 1)),
    evidence: Array.from({ length: 500 }, (_, index) => evidence([index + 1, 601, 602])) });
  await save(fixtureStore);
  const publicService = make('public');
  const judges = make('judge');
  const additional = selection(fixtureStore, [501, 601, 602]);
  await assert.rejects(publicService.select(additional), { code: 'taste_storage_full' });
  await judges.select(additional);
  assert.equal((await read()).evidence.length, 501);
  fixtureStore.evidence = Array.from({ length: 600 }, (_, index) => evidence([index + 1, 601, 602]));
  await save(fixtureStore);
  await assert.rejects(judges.select(selection(fixtureStore, [603, 601, 602])), { code: 'taste_storage_full' });
  assert.equal((await publicService.select(selection(fixtureStore, [1, 601, 602]))).qlooRequests, 0);
  assert.equal(calls.executions, 0);
  assert.equal(calls.pauses, 0);
});

test('public ranking admission stops at 1000 while judges retain capacity through 1200', async t => {
  const { calls, make, save, read } = await setup(t);
  const fixtureStore = store({ searches: Array.from({ length: 1200 }, (_, index) => search(index + 1)),
    rankings: Array.from({ length: 1000 }, (_, index) => ranking(index + 1)), evidence: [evidence([1001, 1002, 1003])] });
  await save(fixtureStore);
  const publicService = make('public');
  const judges = make('judge');
  await assert.rejects(publicService.rankNext({ evidenceId: fixtureStore.evidence[0].evidenceId, live: true }), { code: 'taste_storage_full' });
  assert.equal(calls.executions, 0);
  await judges.rankNext({ evidenceId: fixtureStore.evidence[0].evidenceId, live: true });
  assert.equal((await read()).rankings.length, 1001);
  fixtureStore.searches[0] = search(1, [1201, 1202, 1203]);
  fixtureStore.rankings = Array.from({ length: 1200 }, (_, index) => ranking(index + 1));
  fixtureStore.evidence = [evidence([1201, 1202, 1203]), evidence([1, 2, 3])];
  await save(fixtureStore);
  await assert.rejects(judges.rankNext({ evidenceId: fixtureStore.evidence[0].evidenceId, live: true }), { code: 'taste_storage_full' });
  assert.equal((await publicService.rankNext({ evidenceId: fixtureStore.evidence[1].evidenceId, live: true })).qlooRequests, 0);
  assert.equal(calls.executions, 1);
  assert.equal(calls.pauses, 0);
});

test('public and judge TasteService instances reload shared searches, evidence and rankings before mutation', async t => {
  const { make, read, calls } = await setup(t);
  const publicService = make('public');
  const judges = make('judge');
  const first = await publicService.search({ query: artistName(1), live: true });
  const second = await judges.search({ query: artistName(2), live: true });
  const third = await publicService.search({ query: artistName(3), live: true });
  assert.equal((await judges.search({ query: artistName(1), live: true })).qlooRequests, 0);
  const selected = await judges.select({ artists: [first, second, third].map(packet =>
    ({ searchId: packet.searchId, artistId: packet.options[0].id })) });
  assert.equal((await publicService.progress({ evidenceId: selected.evidenceId })).completedProfiles, 0);
  assert.equal((await publicService.rankNext({ evidenceId: selected.evidenceId, live: true })).completedProfiles, 1);
  assert.equal((await judges.rankNext({ evidenceId: selected.evidenceId, live: true })).completedProfiles, 2);
  assert.equal((await publicService.rankNext({ evidenceId: selected.evidenceId, live: true })).completedProfiles, 3);
  const cache = await read();
  assert.equal(cache.searches.length, 3);
  assert.equal(cache.evidence.length, 1);
  assert.equal(cache.rankings.length, 3);
  assert.deepEqual(await judges.completed(selected.evidenceId), await publicService.completed(selected.evidenceId));
  assert.equal(calls.executions, 6);
  assert.equal(calls.pauses, 0);
});

test('the shared taste-operation lock prevents concurrent public and judge cache writes', async t => {
  const { make, runtime, read, calls } = await setup(t);
  const execute = runtime.execute;
  let notify;
  let release;
  const started = new Promise(resolve => { notify = resolve; });
  runtime.execute = async (...args) => {
    const result = await execute(...args);
    notify();
    await new Promise(resolve => { release = resolve; });
    return result;
  };
  const publicService = make('public');
  const judges = make('judge');
  const pending = publicService.search({ query: artistName(1), live: true });
  await started;
  try {
    await assert.rejects(judges.search({ query: artistName(2), live: true }), { code: 'taste_busy' });
  } finally { release(); }
  await pending;
  assert.equal((await read()).searches.length, 1);
  assert.equal(calls.executions, 1);
  assert.equal(calls.pauses, 0);
});

test('a cache larger than eight MiB fails before retrieval and is preserved unchanged', async t => {
  const { cachePath, make, calls } = await setup(t);
  const content = `${' '.repeat(8 * 1024 * 1024)}{}`;
  await writeFile(cachePath, content);
  for (const pool of ['public', 'judge']) {
    await assert.rejects(make(pool).search({ query: artistName(1), live: true }), { code: 'taste_cache_unavailable' });
  }
  assert.equal((await stat(cachePath)).size, Buffer.byteLength(content));
  assert.equal(hash(await readFile(cachePath, 'utf8')), hash(content));
  assert.equal(calls.executions, 0);
  assert.equal(calls.pauses, 0);
});
