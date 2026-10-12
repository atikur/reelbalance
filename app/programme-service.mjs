import { readFile } from 'node:fs/promises';
import { solveProgramme } from '../scripts/reelbalance-solver.mjs';

const TOP_K = 5;
const MAX_RUNTIME = 240;
const INPUT_KEYS = new Set(['slots', 'maximumRuntime', 'excluded', 'locked', 'current']);

export class ProgrammeInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProgrammeInputError';
    this.code = 'invalid_request';
  }
}

export async function loadDemoDataset(path = new URL('./data/demo.json', import.meta.url)) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function sanitizeDataset(input) {
  if (!input || input.schemaVersion !== 1 || !input.dataset || !Array.isArray(input.films) ||
      !input.films.length || input.films.length > 40 || !Array.isArray(input.profiles) ||
      !input.profiles.length || input.profiles.length > 10) throw new Error('Invalid demo dataset');
  const films = input.films.map(film => {
    if (typeof film.id !== 'string' || typeof film.name !== 'string' || !film.name ||
        !Number.isInteger(film.year) || !Number.isFinite(film.runtime) || film.runtime <= 0 ||
        typeof film.eligible !== 'boolean') throw new Error('Invalid film in demo dataset');
    let sourceUrl = null;
    if (typeof film.sourceUrl === 'string') {
      const url = new URL(film.sourceUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid film source URL');
      sourceUrl = film.sourceUrl;
    }
    return {
      id: film.id, catalogue_id: String(film.catalogue_id ?? ''), name: film.name,
      year: film.year, runtime: film.runtime, eligible: film.eligible, sourceUrl,
      primaryRuntime: Number.isFinite(film.primaryRuntime) && film.primaryRuntime > 0 ? film.primaryRuntime : null,
      metadataNote: typeof film.metadataNote === 'string' ? film.metadataNote : '',
    };
  });
  const filmIds = new Set(films.map(film => film.id));
  if (filmIds.size !== films.length) throw new Error('Duplicate films in demo dataset');
  const profiles = input.profiles.map(profile => {
    if (typeof profile.id !== 'string' || typeof profile.name !== 'string' || !profile.ranks ||
        typeof profile.ranks !== 'object' || Array.isArray(profile.ranks)) throw new Error('Invalid profile in demo dataset');
    const ranks = {};
    for (const [id, rank] of Object.entries(profile.ranks)) {
      if (!filmIds.has(id) || !Number.isInteger(rank) || rank < 1) throw new Error('Invalid cached rank');
      ranks[id] = rank;
    }
    const metadata = {};
    if (profile.referenceEntityId !== undefined) {
      if (typeof profile.referenceEntityId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(profile.referenceEntityId) ||
          !['cached_example', 'cached', 'live'].includes(profile.rankSource) ||
          typeof profile.rankedAt !== 'string' || !Number.isFinite(Date.parse(profile.rankedAt))) throw new Error('Invalid custom ranking provenance');
      Object.assign(metadata, { referenceEntityId: profile.referenceEntityId, rankSource: profile.rankSource, rankedAt: profile.rankedAt });
    }
    return { id: profile.id, name: profile.name, reference: String(profile.reference ?? ''), ranks, ...metadata };
  });
  if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) throw new Error('Duplicate profiles');
  return {
    schemaVersion: 1,
    dataset: {
      ...Object.fromEntries(['id', 'source', 'checkedAt', 'disclosure', 'endpoint', 'eligibility', 'runtimePolicy']
        .map(key => [key, String(input.dataset[key] ?? '')])),
      requestedPerProfile: Number.isInteger(input.dataset.requestedPerProfile) ? input.dataset.requestedPerProfile : null,
      ...(input.dataset.synthetic === true ? { synthetic: true } : {}),
    },
    films, profiles,
    policy: {
      topK: TOP_K,
      support: 'A profile has known support when at least one selected film is in its original cached top five. This is a planning policy, not an enjoyment probability.',
      rankHandling: 'Original ordinal ranks stay unchanged after filtering. Missing ranks remain unknown. Affinity magnitudes are not compared between profiles.',
      transport: input.dataset.synthetic === true
        ? 'Invented synthetic fixture ranks and local planning tools; no Qloo or model evidence.'
        : 'Cached Qloo snapshot and deterministic local planning tools; no live Qloo requests.',
    },
  };
}

export function createProgrammeService(input) {
  const dataset = sanitizeDataset(input);
  const filmIds = new Set(dataset.films.map(film => film.id));
  const byId = new Map(dataset.films.map(film => [film.id, film]));
  const groups = dataset.profiles.map(profile => ({ id: profile.id, ranks: profile.ranks }));

  function validate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProgrammeInputError('Send a JSON object.');
    const unknownKeys = Object.keys(body).filter(key => !INPUT_KEYS.has(key));
    if (unknownKeys.length) throw new ProgrammeInputError('Request contains unsupported fields.');
    if (![2, 3].includes(body.slots)) throw new ProgrammeInputError('Programme slots must be 2 or 3.');
    if (!Number.isInteger(body.maximumRuntime) || body.maximumRuntime < 1 || body.maximumRuntime > MAX_RUNTIME) {
      throw new ProgrammeInputError('Maximum runtime must be a whole number from 1 to 240 minutes.');
    }
    const normalized = { slots: body.slots, maximumRuntime: body.maximumRuntime };
    for (const key of ['excluded', 'locked', 'current']) {
      const ids = body[key] === undefined ? [] : body[key];
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
        throw new ProgrammeInputError(`${key} must contain unique film IDs.`);
      }
      if (ids.some(id => !filmIds.has(id))) throw new ProgrammeInputError(`${key} contains an unknown film ID.`);
      if (ids.length > (key === 'excluded' ? dataset.films.length : 3)) {
        throw new ProgrammeInputError(`${key} contains too many films.`);
      }
      normalized[key] = [...ids];
    }
    return normalized;
  }

  function solve(constraints) {
    return solveProgramme({ films: dataset.films, groups, topK: TOP_K, ...constraints });
  }

  function trace(constraints, operation = 'solve_programme', extra = {}) {
    return [
      { tool: 'load_cached_rankings', status: 'complete', datasetId: dataset.dataset.id, networkRequests: 0 },
      { tool: operation, status: 'complete', constraints: structuredClone(constraints), networkRequests: 0, ...extra },
    ];
  }

  function decorate(result, constraints) {
    const unsupported = dataset.profiles.filter(profile => !result.evidence?.find(item => item.group === profile.id)?.known_top_k_support);
    let explanation;
    if (result.status === 'hard_conflict') {
      const reasons = [];
      if (constraints.locked.length > constraints.slots) reasons.push(`${constraints.locked.length} films are locked for ${constraints.slots} nights`);
      for (const id of result.invalid_locks ?? []) {
        const film = byId.get(id);
        if (constraints.excluded.includes(id)) reasons.push(`${film.name} is both locked and excluded`);
        else if (!film.eligible) reasons.push(`${film.name} is not eligible`);
        else reasons.push(`${film.name} runs ${film.runtime} minutes, over the ${constraints.maximumRuntime}-minute limit`);
      }
      explanation = `The constraints conflict: ${reasons.length ? reasons.join('; ') : 'too few eligible films remain'}. No programme is proposed and no locks or limits have been changed.`;
    } else if (result.status === 'known_coverage_met') {
      explanation = `The proposal supports all ${dataset.profiles.length} profiles under the original cached top-five policy. ${constraints.current.length ? `${result.changes.removed.length} existing selection${result.changes.removed.length === 1 ? '' : 's'} would be replaced. ` : ''}It requires organiser approval; screening rights and audience enjoyment are unverified.`;
    } else {
      explanation = `The best available proposal supports ${result.represented} of ${dataset.profiles.length} profiles under the cached top-five policy. ${unsupported.map(profile => profile.name).join(', ')} ${unsupported.length === 1 ? 'has' : 'have'} ${result.status === 'coverage_not_certified' ? 'support that cannot be certified from the available ranks' : 'no selected top-five film'}. The limit and locks remain unchanged.`;
    }
    return {
      ...result,
      nightOrder: result.selection ? (() => {
        const added = result.selection.filter(id => !constraints.current.includes(id));
        if (constraints.current.length === constraints.slots) {
          return constraints.current.map(id => result.selection.includes(id) ? id : added.shift());
        }
        return [...constraints.current.filter(id => result.selection.includes(id)), ...added];
      })() : null,
      evidence: result.evidence?.map(item => ({ ...item, profileName: dataset.profiles.find(profile => profile.id === item.group).name })),
      checks: {
        slots: constraints.slots, maximumRuntime: constraints.maximumRuntime,
        locked: [...constraints.locked], excluded: [...constraints.excluded],
        profileCount: dataset.profiles.length, supportedProfileCount: result.represented ?? 0,
        unsupportedProfiles: result.status === 'hard_conflict' ? [] : unsupported.map(profile => profile.id),
        requiresApproval: true, networkRequests: 0, ranksUnchanged: true,
      },
      explanation,
      toolTrace: trace(constraints),
    };
  }

  function programme(body) {
    const constraints = validate(body);
    return decorate(solve(constraints), constraints);
  }

  function repairOptions(body) {
    const constraints = validate(body);
    const result = decorate(solve(constraints), constraints);
    let runtimeAlternative = null;
    const testedLimits = [];
    if (result.status !== 'known_coverage_met') {
      const limits = [...new Set(dataset.films
        .filter(film => film.eligible && !constraints.excluded.includes(film.id))
        .map(film => Math.ceil(film.runtime))
        .filter(limit => limit > constraints.maximumRuntime && limit <= MAX_RUNTIME))].sort((a, b) => a - b);
      for (const maximumRuntime of limits) {
        testedLimits.push(maximumRuntime);
        const candidateConstraints = { ...constraints, maximumRuntime };
        const candidate = solve(candidateConstraints);
        if (candidate.status === 'known_coverage_met') {
          runtimeAlternative = { maximumRuntime, result: decorate(candidate, candidateConstraints) };
          break;
        }
      }
    }
    let explanation = result.explanation;
    if (runtimeAlternative) {
      explanation += ` A separate option restores all-profile support at ${runtimeAlternative.maximumRuntime} minutes, the smallest whole-minute runtime relaxation for these locks and exclusions. You must explicitly approve that change.`;
    } else if (result.status !== 'known_coverage_met') {
      const ceilingConstraints = { ...constraints, maximumRuntime: MAX_RUNTIME };
      const ceilingResult = solve(ceilingConstraints);
      const available = dataset.films.filter(film => film.eligible && film.runtime <= MAX_RUNTIME && !constraints.excluded.includes(film.id));
      const separateSupport = available.every(film => groups.filter(group => Number.isInteger(group.ranks[film.id]) && group.ranks[film.id] <= TOP_K).length <= 1);
      if (constraints.slots === 2 && dataset.profiles.length > 2 && ceilingResult.status !== 'hard_conflict' && separateSupport) {
        explanation += ` This is a structural two-night trade-off: each available film supports at most one profile under the top-five policy, so two films cannot support all ${dataset.profiles.length} profiles. Raising runtime alone cannot resolve it.`;
      } else {
        explanation += ' No runtime-only change up to 240 minutes restores full support with the same locks and exclusions.';
      }
    }
    return {
      result, runtimeAlternative, explanation,
      toolTrace: trace(constraints, 'find_repair_options', { testedRuntimeLimits: testedLimits, maximumSearchRuntime: MAX_RUNTIME }),
    };
  }

  return { bootstrap: () => structuredClone(dataset), programme, repairOptions };
}
