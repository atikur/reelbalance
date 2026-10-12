import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProgrammeService } from './programme-service.mjs';
import { createQlooRuntime } from './qloo-runtime.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SEARCH_ID = /^search-[a-f0-9]{32}$/;
const EVIDENCE_ID = /^rb-taste-[a-f0-9]{32}$/;
// Keep earlier evidence available throughout judging; the byte cap still bounds
// storage even when artist names or search results approach their schema limits.
const LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, searches: 1200, evidence: 600, rankings: 1200 });
const PUBLIC_LIMITS = Object.freeze({ searches: 1000, evidence: 500, rankings: 1000 });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);
const keys = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value) &&
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
const canonicalId = value => typeof value === 'string' && UUID.test(value) ? value.toUpperCase() : null;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const safeName = (value, maximum = 160) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum && !/[\p{Cc}\p{Cf}]/u.test(value);

export class TasteError extends Error {
  constructor(message, { status = 503, code = 'taste_unavailable' } = {}) {
    super(message); this.name = 'TasteError'; this.status = status; this.code = code;
  }
}
const invalid = message => new TasteError(message, { status: 400, code: 'invalid_taste_request' });
const unavailable = () => new TasteError('Stored taste evidence is unavailable or does not match this catalogue. No automatic request will be made.', { code: 'taste_cache_unavailable' });
const full = () => new TasteError('The local taste-evidence storage limit has been reached. Review the cache before collecting more evidence.', { code: 'taste_storage_full' });

async function readJsonFile(path, maximum) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw unavailable();
  return JSON.parse(await readFile(path, 'utf8'));
}

export function createTasteService({ baseDataset, cacheDirectory = resolve(ROOT, '.cache/tastes'), guardDirectory = resolve(ROOT, '.cache'),
  seedArtists, seedArtistsPath = resolve(guardDirectory, 'artist-seeds.json'), liveEnabled = false, now = Date.now,
  pool = 'judge', runtime = createQlooRuntime({ guardDirectory, now, pool }) } = {}) {
  const base = createProgrammeService(baseDataset).bootstrap();
  if (base.films.length !== 20 || base.films.some(film => !canonicalId(film.id)) || typeof liveEnabled !== 'boolean' ||
      !runtime?.status || !runtime?.execute || !runtime?.pause || !['public', 'judge'].includes(pool)) throw new TypeError('Taste service requires the vetted 20-film catalogue and guarded Qloo runtime.');
  const admission = pool === 'public' ? PUBLIC_LIMITS : LIMITS;
  const directory = resolve(cacheDirectory);
  const cachePath = resolve(directory, 'taste-cache.json');
  const lockPath = resolve(directory, 'taste-operation.lock');
  const filmIds = base.films.map(film => film.id);
  const poolIds = new Set(filmIds.map(id => id.toUpperCase()));
  const filmPool = new Map(base.films.map(film => [film.id.toUpperCase(), film.id]));
  const catalogueSha256 = hash({ id: base.dataset.id, films: base.films });
  let seedPromise;

  async function seeds() {
    if (!seedPromise) seedPromise = (async () => {
      let artists;
      if (seedArtists !== undefined) artists = seedArtists;
      else {
        try {
          const packet = await readJsonFile(seedArtistsPath, 16 * 1024);
          if (!keys(packet, ['schemaVersion', 'artists']) || packet.schemaVersion !== 1) throw unavailable();
          artists = packet.artists;
        } catch (error) { if (error.code === 'ENOENT') artists = []; else throw unavailable(); }
      }
      if (!Array.isArray(artists) || artists.length > 10 || new Set(artists.map(item => canonicalId(item?.id))).size !== artists.length ||
          new Set(artists.map(item => item?.profileId)).size !== artists.length) throw unavailable();
      return artists.map(artist => {
        if (!keys(artist, ['id', 'name', 'profileId', 'checkedAt']) || !canonicalId(artist.id) || !safeName(artist.name) || !validTime(artist.checkedAt)) throw unavailable();
        const profile = base.profiles.find(item => item.id === artist.profileId);
        if (!profile || profile.reference !== artist.name) throw unavailable();
        return { id: canonicalId(artist.id), name: artist.name, profileId: artist.profileId, checkedAt: artist.checkedAt };
      });
    })();
    return seedPromise;
  }

  const empty = () => ({ schemaVersion: 1, catalogueSha256, searches: [], evidence: [], rankings: [] });
  const rankingKey = artistId => hash({ catalogueSha256, artistId });
  const evidenceKey = artists => `rb-taste-${hash({ catalogueSha256, artists: artists.map(item => item.id) }).slice(0, 32)}`;

  function validOptions(options) {
    return Array.isArray(options) && options.length <= 5 && new Set(options.map(item => item?.id)).size === options.length &&
      options.every(option => keys(option, ['id', 'name', 'type']) && option.id === canonicalId(option.id) && safeName(option.name) && option.type === 'artist');
  }

  function validRanking(record) {
    return keys(record, ['key', 'artistId', 'artistName', 'fetchedAt', 'ranking']) && record.artistId === canonicalId(record.artistId) &&
      record.key === rankingKey(record.artistId) && safeName(record.artistName) && validTime(record.fetchedAt) &&
      Array.isArray(record.ranking) && record.ranking.length <= filmIds.length &&
      new Set(record.ranking.map(item => item?.filmId)).size === record.ranking.length &&
      record.ranking.every((item, index) => keys(item, ['filmId', 'rank']) && poolIds.has(item.filmId) && item.rank === index + 1);
  }

  async function loadStore() {
    let store;
    try { store = await readJsonFile(cachePath, LIMITS.bytes); }
    catch (error) { if (error.code === 'ENOENT') return empty(); throw unavailable(); }
    if (!keys(store, ['schemaVersion', 'catalogueSha256', 'searches', 'evidence', 'rankings']) || store.schemaVersion !== 1 ||
        store.catalogueSha256 !== catalogueSha256 || !Array.isArray(store.searches) || store.searches.length > LIMITS.searches ||
        !Array.isArray(store.evidence) || store.evidence.length > LIMITS.evidence || !Array.isArray(store.rankings) || store.rankings.length > LIMITS.rankings ||
        new Set(store.searches.map(item => item?.searchId)).size !== store.searches.length ||
        new Set(store.evidence.map(item => item?.evidenceId)).size !== store.evidence.length ||
        new Set(store.rankings.map(item => item?.key)).size !== store.rankings.length) throw unavailable();
    for (const search of store.searches) {
      if (!keys(search, ['searchId', 'query', 'fetchedAt', 'options']) || !SEARCH_ID.test(search.searchId) || !safeName(search.query, 80) ||
          !validTime(search.fetchedAt) || !validOptions(search.options) ||
          search.searchId !== `search-${hash({ query: search.query, fetchedAt: search.fetchedAt, options: search.options }).slice(0, 32)}`) throw unavailable();
    }
    for (const record of store.rankings) if (!validRanking(record)) throw unavailable();
    for (const evidence of store.evidence) {
      if (!keys(evidence, ['evidenceId', 'createdAt', 'artists']) || !EVIDENCE_ID.test(evidence.evidenceId) || !validTime(evidence.createdAt) ||
          !Array.isArray(evidence.artists) || evidence.artists.length !== 3 || new Set(evidence.artists.map(item => item?.id)).size !== 3 ||
          evidence.artists.some(item => !keys(item, ['id', 'name']) || item.id !== canonicalId(item.id) || !safeName(item.name)) ||
          evidence.evidenceId !== evidenceKey(evidence.artists)) throw unavailable();
      for (const artist of evidence.artists) {
        const found = store.searches.some(search => search.options.some(option => option.id === artist.id && option.name === artist.name)) ||
          (await seeds()).some(seed => seed.id === artist.id && seed.name === artist.name);
        if (!found) throw unavailable();
      }
    }
    return store;
  }

  async function saveStore(store) {
    const text = `${JSON.stringify(store)}\n`;
    if (Buffer.byteLength(text, 'utf8') > LIMITS.bytes) throw full();
    const temporary = resolve(directory, `taste-cache-${randomUUID()}.tmp`);
    try { await writeFile(temporary, text, { flag: 'wx', mode: 0o600 }); await rename(temporary, cachePath); }
    finally { await unlink(temporary).catch(() => {}); }
  }

  async function mutate(action) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw unavailable();
    try { await writeFile(lockPath, '', { flag: 'wx', mode: 0o600 }); }
    catch { throw new TasteError('Another taste-evidence operation is active or unfinished. No request was sent.', { status: 409, code: 'taste_busy' }); }
    try { const store = await loadStore(); return await action(store); }
    finally { await unlink(lockPath).catch(() => {}); }
  }

  async function knownArtists() {
    const artists = await seeds();
    return { searchId: 'known-artists-v1', source: 'cached_example', fetchedAt: base.dataset.checkedAt,
      options: artists.map(({ id, name }) => ({ id, name, type: 'artist' })) };
  }

  async function status() {
    return { schemaVersion: 1, liveEnabled, guard: await runtime.status(), knownArtists: await knownArtists(),
      catalogue: { datasetId: base.dataset.id, filmCount: base.films.length } };
  }

  function requireLive(body) {
    if (!liveEnabled) throw new TasteError('Live Qloo collection is disabled. Cached evidence remains available.', { code: 'qloo_live_disabled' });
    if (body.live !== true) throw invalid('Confirm this single Qloo request with live: true.');
  }

  async function search(body, { beforeLiveRequest } = {}) {
    if (!keys(body, ['query'], ['live']) || !safeName(body.query, 80) ||
        (body.live !== undefined && typeof body.live !== 'boolean') || /\S+@\S+\.\S+/.test(body.query) || /\bsk-[a-z0-9_-]{16,}\b/i.test(body.query)) {
      throw invalid('Search using a public artist name of up to 80 characters.');
    }
    const query = body.query.trim().replace(/\s+/g, ' ');
    const known = await knownArtists();
    const match = known.options.filter(option => option.name.toLocaleLowerCase() === query.toLocaleLowerCase());
    if (match.length) return { schemaVersion: 1, ...known, query, options: match, qlooRequests: 0, guard: await runtime.status() };
    return mutate(async store => {
      const cached = store.searches.find(item => item.query.toLocaleLowerCase() === query.toLocaleLowerCase());
      if (cached) return { schemaVersion: 1, ...clone(cached), query, source: 'cached', qlooRequests: 0, guard: await runtime.status() };
      if (store.searches.length >= admission.searches) throw full();
      requireLive(body);
      let response;
      try {
        response = await runtime.execute({ operation: 'search', query }, { beforeRequest: beforeLiveRequest });
        if (!Array.isArray(response.entities) || response.entities.length > 5 || response.qlooRequests !== 1 || !validTime(response.fetchedAt)) throw unavailable();
        const options = response.entities.map(entity => {
          const type = entity.subtype ?? (Array.isArray(entity.types) ? entity.types.find(item => ['urn:entity:artist', 'urn:entity:music_artist'].includes(item)) : null);
          if (!canonicalId(entity.entity_id) || !safeName(entity.name) || !['urn:entity:artist', 'urn:entity:music_artist'].includes(type)) throw unavailable();
          return { id: canonicalId(entity.entity_id), name: entity.name.trim(), type: 'artist' };
        });
        if (!validOptions(options)) throw unavailable();
        const cachedSearch = { searchId: `search-${hash({ query, fetchedAt: response.fetchedAt, options }).slice(0, 32)}`, query, fetchedAt: response.fetchedAt, options };
        store.searches.push(cachedSearch);
        await saveStore(store);
        return { schemaVersion: 1, ...clone(cachedSearch), source: 'live', qlooRequests: 1, guard: await runtime.status() };
      } catch (error) {
        if (['access_session_required', 'guest_session_required', 'guest_qloo_limit_reached', 'access_unavailable', 'access_busy'].includes(error?.code)) throw error;
        if (response || !error?.code?.startsWith('qloo_')) await runtime.pause();
        if (error?.code?.startsWith('qloo_')) throw error;
        throw new TasteError('Qloo artist data could not be verified. Access is paused; no automatic retry will be made.', { code: 'qloo_invalid_artist_data' });
      }
    });
  }

  async function rankRecord(store, artist) {
    const cached = store.rankings.find(item => item.key === rankingKey(artist.id));
    if (cached) {
      if (cached.artistName !== artist.name) throw unavailable();
      return { ...clone(cached), source: 'cached' };
    }
    const seed = (await seeds()).find(item => item.id === artist.id && item.name === artist.name);
    if (!seed) return null;
    const ranks = base.profiles.find(profile => profile.id === seed.profileId).ranks;
    return { artistId: artist.id, artistName: artist.name, fetchedAt: base.dataset.checkedAt, source: 'cached_example',
      ranking: Object.entries(ranks).map(([filmId, rank]) => ({ filmId, rank })).sort((a, b) => a.rank - b.rank) };
  }

  async function progressPacket(store, evidence, requests = 0, freshlyFetchedArtist = null) {
    const records = await Promise.all(evidence.artists.map(artist => rankRecord(store, artist)));
    const guard = await runtime.status();
    const completedProfiles = records.filter(Boolean).length;
    const next = records.findIndex(record => !record);
    return { schemaVersion: 1, evidenceId: evidence.evidenceId,
      status: completedProfiles === 3 ? 'complete' : guard.paused ? 'paused' : 'pending',
      artists: evidence.artists.map((artist, index) => ({ ...clone(artist), rankSource: records[index] ? artist.id === freshlyFetchedArtist ? 'live' : records[index].source : null,
        returnedCount: records[index]?.ranking.length ?? null, unknownFilmCount: records[index] ? filmIds.length - records[index].ranking.length : null,
        rankedAt: records[index]?.fetchedAt ?? null })), completedProfiles, profileCount: 3,
      nextProfile: next < 0 ? null : { ...clone(evidence.artists[next]), index: next }, qlooRequests: requests, guard };
  }

  async function select(body) {
    if (!keys(body, ['artists']) || !Array.isArray(body.artists) || body.artists.length !== 3 ||
        body.artists.some(item => !keys(item, ['searchId', 'artistId']) || typeof item.searchId !== 'string' || !canonicalId(item.artistId))) {
      throw invalid('Confirm exactly three artists from returned canonical matches.');
    }
    if (new Set(body.artists.map(item => canonicalId(item.artistId))).size !== 3) throw invalid('Choose three distinct canonical artists.');
    return mutate(async store => {
      const known = await knownArtists();
      const artists = body.artists.map(item => {
        const options = item.searchId === known.searchId ? known.options : store.searches.find(search => search.searchId === item.searchId)?.options;
        const option = options?.find(match => match.id === canonicalId(item.artistId));
        if (!option) throw invalid('An artist was not present in the server-verified search results. Search and confirm the match again.');
        return { id: option.id, name: option.name };
      });
      const evidenceId = evidenceKey(artists);
      let evidence = store.evidence.find(item => item.evidenceId === evidenceId);
      if (!evidence) {
        if (store.evidence.length >= admission.evidence) throw full();
        evidence = { evidenceId, createdAt: new Date(now()).toISOString(), artists };
        store.evidence.push(evidence); await saveStore(store);
      }
      return progressPacket(store, evidence);
    });
  }

  function validateEvidenceId(value) {
    if (typeof value !== 'string' || !EVIDENCE_ID.test(value)) throw invalid('Use a server-issued taste evidence ID.');
  }

  function findEvidence(store, evidenceId) {
    const evidence = store.evidence.find(item => item.evidenceId === evidenceId);
    if (!evidence) throw new TasteError('This taste-evidence selection was not found.', { status: 404, code: 'taste_evidence_not_found' });
    return evidence;
  }

  async function progress(body) {
    if (!keys(body, ['evidenceId'])) throw invalid('Include only the taste evidence ID.');
    validateEvidenceId(body.evidenceId);
    const store = await loadStore();
    return progressPacket(store, findEvidence(store, body.evidenceId));
  }

  async function rankNext(body, { beforeLiveRequest } = {}) {
    if (!keys(body, ['evidenceId'], ['live']) || (body.live !== undefined && typeof body.live !== 'boolean')) throw invalid('Include a taste evidence ID and explicit single-request confirmation.');
    validateEvidenceId(body.evidenceId);
    return mutate(async store => {
      const evidence = findEvidence(store, body.evidenceId);
      let artist;
      for (const item of evidence.artists) if (!await rankRecord(store, item)) { artist = item; break; }
      if (!artist) return progressPacket(store, evidence);
      if (store.rankings.length >= admission.rankings) throw full();
      requireLive(body);
      let response;
      try {
        response = await runtime.execute({ operation: 'rank', artistId: artist.id, filmIds: [...filmIds] }, { beforeRequest: beforeLiveRequest });
        if (!Array.isArray(response.entities) || response.entities.length > filmIds.length || response.qlooRequests !== 1 || !validTime(response.fetchedAt)) throw unavailable();
        const ranking = response.entities.map((entity, index) => {
          const id = canonicalId(entity.entity_id);
          const type = entity.subtype ?? (Array.isArray(entity.types) ? entity.types.find(item => item === 'urn:entity:movie') : null);
          const affinity = entity.affinity ?? entity.query?.affinity;
          if (!id || !poolIds.has(id) || !safeName(entity.name, 220) || type !== 'urn:entity:movie' || !Number.isFinite(affinity) || affinity < 0 || affinity > 1) throw unavailable();
          return { filmId: filmPool.get(id), rank: index + 1 };
        });
        const record = { key: rankingKey(artist.id), artistId: artist.id, artistName: artist.name, fetchedAt: response.fetchedAt, ranking };
        if (!validRanking(record)) throw unavailable();
        store.rankings.push(record); await saveStore(store);
        return progressPacket(store, evidence, 1, artist.id);
      } catch (error) {
        if (['access_session_required', 'guest_session_required', 'guest_qloo_limit_reached', 'access_unavailable', 'access_busy'].includes(error?.code)) throw error;
        if (response || !error?.code?.startsWith('qloo_')) await runtime.pause();
        if (error?.code?.startsWith('qloo_')) throw error;
        throw new TasteError('Qloo movie ranks could not be verified against the fixed catalogue. Access is paused; no automatic retry will be made.', { code: 'qloo_invalid_rank_data' });
      }
    });
  }

  async function completed(evidenceId) {
    validateEvidenceId(evidenceId);
    const store = await loadStore();
    const evidence = findEvidence(store, evidenceId);
    const records = await Promise.all(evidence.artists.map(artist => rankRecord(store, artist)));
    if (records.some(record => !record)) throw new TasteError('Complete each artist’s evidence step before using this selection.', { status: 409, code: 'taste_evidence_incomplete' });
    const latest = records.map(record => record.fetchedAt).sort().at(-1);
    const dataset = { ...clone(base), dataset: { ...clone(base.dataset), id: evidenceId, source: 'Cached Qloo fixed-pool custom-artist evidence', checkedAt: latest,
      disclosure: 'This fixed 20-film pool was assembled from the original example references’ Qloo discoveries, not from these custom artists. Returned ordinal ranks are preserved; omitted films remain unknown. Cached ranking support is a planning policy, not evidence of enjoyment, attendance or independent recommendation quality.' },
      profiles: evidence.artists.map((artist, index) => ({ id: `artist-${artist.id.toLowerCase()}`, name: `Taste profile ${String(index + 1).padStart(2, '0')}`,
        reference: artist.name, referenceEntityId: artist.id, rankSource: records[index].source, rankedAt: records[index].fetchedAt,
        ranks: Object.fromEntries(records[index].ranking.map(item => [item.filmId, item.rank])) })) };
    createProgrammeService(dataset); // Reject malformed server cache before any planning tool can consume it.
    return { schemaVersion: 1, evidenceId, source: 'custom_taste', dataset,
      provenance: { catalogueId: base.dataset.id, artists: evidence.artists.map((artist, index) => ({ ...clone(artist), source: records[index].source,
        rankedAt: records[index].fetchedAt, returnedCount: records[index].ranking.length, unknownFilmCount: filmIds.length - records[index].ranking.length })) }, qlooRequests: 0 };
  }

  return { status, search, select, progress, rankNext, completed };
}
