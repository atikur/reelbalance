import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProgrammeService } from '../app/programme-service.mjs';

const TOP_K = 5;
const CAPS = [90, 110, 120, 150, 240];
const ARMS = ['production', 'constraintOnly', 'rankAwareWithoutReplacementPreference'];
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const known = (profile, id) => Number.isInteger(profile.ranks[id]) && profile.ranks[id] > 0;
const compare = (a, b) => {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
};

function datasetFrom(input) {
  const candidate = Array.isArray(input?.films) ? input : input?.dataset;
  const data = createProgrammeService(candidate).bootstrap();
  if (data.films.length !== 20 || data.profiles.length !== 3) throw new Error('audit_input');
  for (const profile of data.profiles) {
    const ranks = Object.values(profile.ranks);
    if (new Set(ranks).size !== ranks.length || ranks.some(rank => rank > 20)) throw new Error('audit_input');
  }
  return data;
}

// This enumerator does not call the production solver or its filtering helpers.
function portfolios(data, brief) {
  const permitted = data.films.filter(film => film.eligible === true &&
    Number.isFinite(film.runtime) && film.runtime > 0 && film.runtime <= brief.maximumRuntime &&
    !brief.excluded.includes(film.id));
  const choices = [];
  const visit = (start, selected) => {
    if (selected.length === brief.slots) {
      if (brief.locked.every(id => selected.includes(id))) choices.push([...selected]);
      return;
    }
    for (let index = start; index <= permitted.length - (brief.slots - selected.length); index++) {
      visit(index + 1, [...selected, permitted[index].id]);
    }
  };
  visit(0, []);
  return { permitted, choices };
}

function metrics(data, brief, selection) {
  const best = data.profiles.map(profile => {
    const ranks = selection.filter(id => known(profile, id)).map(id => profile.ranks[id]);
    return ranks.length ? Math.min(...ranks) : null;
  });
  const support = best.filter(rank => rank !== null && rank <= TOP_K).length;
  const replacements = brief.current.filter(id => !selection.includes(id)).length;
  const unknownSelectedRanks = data.profiles.reduce((sum, profile) =>
    sum + selection.filter(id => !known(profile, id)).length, 0);
  return { support, replacements, unknownSelectedRanks,
    rankOrder: [-support, -best.filter(rank => rank !== null).length,
      ...best.filter(rank => rank !== null).sort((a, b) => b - a)] };
}

function ordered(selection, brief) {
  const remaining = selection.filter(id => !brief.current.includes(id));
  if (brief.current.length === brief.slots) {
    return brief.current.map(id => selection.includes(id) ? id : remaining.shift());
  }
  return [...brief.current.filter(id => selection.includes(id)), ...remaining];
}

function expectedStatus(data, brief, selection, permitted) {
  if (selection === null) return 'hard_conflict';
  if (metrics(data, brief, selection).support === data.profiles.length) return 'known_coverage_met';
  const missing = data.profiles.some(profile => permitted.some(film => !known(profile, film.id)));
  return missing ? 'coverage_not_certified' : 'coverage_shortfall';
}

function alternate(data, brief, enumerated, arm) {
  if (!enumerated.choices.length) return { status: 'hard_conflict', selection: null, nightOrder: null };
  const assessed = enumerated.choices.map(selection => ({ selection, ...metrics(data, brief, selection) }));
  assessed.sort((a, b) => compare(arm === 'constraintOnly' ? [a.replacements] : a.rankOrder,
    arm === 'constraintOnly' ? [b.replacements] : b.rankOrder) ||
    a.selection.join(',').localeCompare(b.selection.join(',')));
  const best = assessed[0];
  return { selection: best.selection, nightOrder: ordered(best.selection, brief), represented: best.support,
    status: expectedStatus(data, brief, best.selection, enumerated.permitted),
    changes: { removed: brief.current.filter(id => !best.selection.includes(id)),
      added: best.selection.filter(id => !brief.current.includes(id)) } };
}

// Checks are recomputed from the frozen input, not trusted from solver checks.
// Error codes and aggregate metrics never contain private identities or ranks.
export function verifyDecision(data, brief, result, enumerated = portfolios(data, brief)) {
  const errors = [];
  if (!result || typeof result !== 'object') return { valid: false, errors: ['missing_result'], status: null,
    support: null, replacements: null, unknownSelectedRanks: null, lockedNightPositionsPreserved: null };
  if (result.selection === null) {
    if (enumerated.choices.length) errors.push('false_hard_conflict');
    if (result.status !== 'hard_conflict') errors.push('conflict_status');
    if (result.nightOrder !== null) errors.push('conflict_night_order');
    return { valid: errors.length === 0, errors, status: result.status, support: null, replacements: null,
      unknownSelectedRanks: null, lockedNightPositionsPreserved: null };
  }
  const selection = Array.isArray(result.selection) ? result.selection : [];
  if (selection.length !== brief.slots || new Set(selection).size !== brief.slots) errors.push('slot_count');
  const byId = new Map(data.films.map(film => [film.id, film]));
  if (selection.some(id => !byId.has(id))) errors.push('unknown_film');
  if (selection.some(id => !byId.get(id)?.eligible)) errors.push('ineligible_film');
  if (selection.some(id => !Number.isFinite(byId.get(id)?.runtime) || byId.get(id).runtime > brief.maximumRuntime)) errors.push('runtime');
  if (selection.some(id => brief.excluded.includes(id))) errors.push('excluded_film');
  if (brief.locked.some(id => !selection.includes(id))) errors.push('missing_lock');
  const nightOrder = Array.isArray(result.nightOrder) ? result.nightOrder : [];
  if (nightOrder.length !== brief.slots || new Set(nightOrder).size !== brief.slots ||
      nightOrder.some(id => !selection.includes(id))) errors.push('night_order_membership');
  const lockedNightPositionsPreserved = brief.current.length !== brief.slots ||
    brief.locked.every(id => nightOrder[brief.current.indexOf(id)] === id);
  if (!lockedNightPositionsPreserved) errors.push('locked_night_position');
  const independent = metrics(data, brief, selection);
  if (result.represented !== independent.support) errors.push('support_count');
  if (result.status !== expectedStatus(data, brief, selection, enumerated.permitted)) errors.push('support_status');
  if (result.evidence !== undefined) {
    if (!Array.isArray(result.evidence) || result.evidence.length !== data.profiles.length ||
        new Set(result.evidence.map(item => item.group)).size !== data.profiles.length) errors.push('rank_evidence');
    else for (const profile of data.profiles) {
      const item = result.evidence.find(value => value.group === profile.id);
      const ranks = selection.filter(id => known(profile, id)).map(id => profile.ranks[id]);
      const best = ranks.length ? Math.min(...ranks) : null;
      const unknown = selection.filter(id => !known(profile, id));
      if (!item || item.best_cached_rank !== best || item.known_top_k_support !== (best !== null && best <= TOP_K) ||
          item.scored_eligible !== enumerated.permitted.filter(film => known(profile, film.id)).length ||
          item.eligible_count !== enumerated.permitted.length || !Array.isArray(item.unscored_selected) ||
          compare([...item.unscored_selected].sort(), [...unknown].sort())) errors.push('rank_evidence');
    }
  }
  const removed = brief.current.filter(id => !selection.includes(id));
  const added = selection.filter(id => !brief.current.includes(id));
  if (!Array.isArray(result.changes?.removed) || !Array.isArray(result.changes?.added) ||
      compare([...result.changes.removed].sort(), [...removed].sort()) ||
      compare([...result.changes.added].sort(), [...added].sort())) errors.push('change_receipt');
  return { valid: errors.length === 0, errors, status: result.status, support: independent.support,
    replacements: independent.replacements, unknownSelectedRanks: independent.unknownSelectedRanks,
    lockedNightPositionsPreserved };
}

function smallestFullSupportRuntime(data, brief) {
  const fullSupport = request => portfolios(data, request).choices.some(selection =>
    metrics(data, request, selection).support === data.profiles.length);
  if (fullSupport(brief)) return null;
  const thresholds = [...new Set(data.films.filter(film => film.eligible === true &&
    !brief.excluded.includes(film.id)).map(film => Math.ceil(film.runtime))
    .filter(cap => cap > brief.maximumRuntime && cap <= 240))].sort((a, b) => a - b);
  return thresholds.find(maximumRuntime => fullSupport({ ...brief, maximumRuntime })) ?? null;
}

export function verifyRuntimeAlternative(data, brief, options) {
  const expectedCap = smallestFullSupportRuntime(data, brief);
  const alternative = options.runtimeAlternative;
  const errors = [];
  if (options.result?.checks?.maximumRuntime !== brief.maximumRuntime) errors.push('current_brief_changed');
  if (!alternative) {
    if (expectedCap !== null) errors.push('missing_runtime_option');
    return { offered: false, minimumFullSupportRuntime: expectedCap, valid: errors.length === 0,
      errors, support: null, replacements: null, lockedNightPositionsPreserved: null };
  }
  if (expectedCap === null) errors.push('unexpected_runtime_option');
  if (alternative.maximumRuntime !== expectedCap || !Number.isInteger(alternative.maximumRuntime) ||
      alternative.maximumRuntime <= brief.maximumRuntime || alternative.maximumRuntime > 240) errors.push('runtime_option_limit');
  const alternativeBrief = { ...brief, maximumRuntime: alternative.maximumRuntime };
  const verified = verifyDecision(data, alternativeBrief, alternative.result);
  errors.push(...verified.errors);
  if (verified.support !== data.profiles.length) errors.push('runtime_option_support');
  return { offered: true, minimumFullSupportRuntime: expectedCap, valid: errors.length === 0, errors,
    support: verified.support, replacements: verified.replacements,
    lockedNightPositionsPreserved: verified.lockedNightPositionsPreserved };
}

function casesFor(data) {
  const cases = [];
  const brief = (slots, maximumRuntime, current = [], excluded = [], locked = []) =>
    ({ slots, maximumRuntime, current: [...current], excluded: [...excluded], locked: [...locked] });
  const add = (id, request, family, fault = null) => cases.push({ id, brief: request, family, fault });
  const seed = (slots, cap, rankAware) => {
    const request = brief(slots, cap);
    return alternate(data, request, portfolios(data, request), rankAware ? 'rankAware' : 'constraintOnly').nightOrder;
  };
  for (const slots of [2, 3]) {
    for (const cap of CAPS) {
      add(`draft-${slots}-cap${cap}`, brief(slots, cap), 'draft');
      const current = seed(slots, cap, false);
      if (current) add(`review-${slots}-cap${cap}`, brief(slots, cap, current), 'constraint-first-review');
    }
    const current = seed(slots, 110, true);
    if (current) {
      for (let night = 0; night < slots; night++) {
        for (const keepLocks of [false, true]) {
          add(`repair-${slots}-cap110-cancel${night + 1}-${keepLocks ? 'locked' : 'unlocked'}`,
            brief(slots, 110, current, [current[night]], keepLocks ? current.filter((_, index) => index !== night) : []), 'cancellation');
        }
      }
      add(`conflict-${slots}-locked-excluded`, brief(slots, 110, current, [current[0]], [current[0]]), 'hard-conflict');
    }
    const wider = seed(slots, 150, true);
    if (wider) {
      for (const cap of [90, 110, 120]) {
        for (const keepLock of [false, true]) {
          add(`rebrief-${slots}-cap${cap}-${keepLock ? 'locked' : 'unlocked'}`,
            brief(slots, cap, wider, [], keepLock ? [wider[0]] : []), 'runtime-change');
        }
      }
    }
    add(`conflict-${slots}-too-few`, brief(slots, 1), 'hard-conflict');
    for (let profile = 0; profile < data.profiles.length; profile++) {
      const excluded = data.films.filter(film => known(data.profiles[profile], film.id) &&
        data.profiles[profile].ranks[film.id] <= TOP_K).map(film => film.id);
      add(`support-stress-${slots}-reference${profile + 1}`, brief(slots, 240, [], excluded), 'rank-derived-support-stress');
    }
  }
  const three = seed(3, 240, true);
  if (three) add('conflict-2-three-locks', brief(2, 240, three, [], three), 'hard-conflict');
  // Missing values below are deliberate faults, not new or genuine Qloo results.
  const faultBases = cases.filter(item => ['draft-2-cap110', 'draft-3-cap110', 'repair-3-cap110-cancel2-locked'].includes(item.id));
  for (const fault of ['sparse-rank-deletion', 'one-reference-unscored']) {
    for (const item of faultBases) add(`${item.id}-${fault}`, clone(item.brief), 'missing-rank-fault', fault);
  }
  return cases;
}

function faulted(data, fault) {
  if (!fault) return data;
  const changed = clone(data);
  if (fault === 'one-reference-unscored') changed.profiles[2].ranks = {};
  else {
    for (const [profile, item] of changed.profiles.entries()) {
      changed.films.forEach((film, index) => { if ((index + profile) % 4 === 0) delete item.ranks[film.id]; });
    }
  }
  return changed;
}

function summarize(rows) {
  const feasible = rows.filter(row => row.feasiblePortfolios > 0);
  const arms = Object.fromEntries(ARMS.map(arm => [arm, {
    verifiedCases: rows.filter(row => row.arms[arm].valid).length,
    fullSupportCases: feasible.filter(row => row.arms[arm].support === 3).length,
    maximumSupportCases: feasible.filter(row => row.arms[arm].support === row.oracle.maximumSupport).length,
    totalSupport: feasible.reduce((sum, row) => sum + row.arms[arm].support, 0),
    totalReplacements: feasible.reduce((sum, row) => sum + row.arms[arm].replacements, 0),
    unknownSelectedRanks: feasible.reduce((sum, row) => sum + row.arms[arm].unknownSelectedRanks, 0),
  }]));
  return { cases: rows.length, feasibleCases: feasible.length, hardConflictCases: rows.length - feasible.length,
    allChecksPassed: rows.every(row => ARMS.every(arm => row.arms[arm].valid) && row.runtimeAlternative.valid), arms,
    runtimeAlternatives: { offered: rows.filter(row => row.runtimeAlternative.offered).length,
      verifiedOffers: rows.filter(row => row.runtimeAlternative.offered && row.runtimeAlternative.valid).length,
      verifiedAbsences: rows.filter(row => !row.runtimeAlternative.offered && row.runtimeAlternative.valid).length },
    productionVersusConstraintOnly: {
      higherSupport: feasible.filter(row => row.arms.production.support > row.arms.constraintOnly.support).length,
      sameSupport: feasible.filter(row => row.arms.production.support === row.arms.constraintOnly.support).length,
      lowerSupport: feasible.filter(row => row.arms.production.support < row.arms.constraintOnly.support).length,
    },
    productionVersusRankAware: {
      fewerReplacements: feasible.filter(row => row.arms.production.replacements < row.arms.rankAwareWithoutReplacementPreference.replacements).length,
      sameReplacements: feasible.filter(row => row.arms.production.replacements === row.arms.rankAwareWithoutReplacementPreference.replacements).length,
      moreReplacements: feasible.filter(row => row.arms.production.replacements > row.arms.rankAwareWithoutReplacementPreference.replacements).length,
      sameSupport: feasible.filter(row => row.arms.production.support === row.arms.rankAwareWithoutReplacementPreference.support).length,
    } };
}

export function auditDecisions(input, { inputSha256 = hash(JSON.stringify(input)) } = {}) {
  if (!/^[a-f0-9]{64}$/.test(inputSha256)) throw new Error('audit_hash');
  const data = datasetFrom(input);
  const before = JSON.stringify(data);
  const rows = casesFor(data).map(item => {
    const evidence = faulted(data, item.fault);
    const enumerated = portfolios(evidence, item.brief);
    const assessed = enumerated.choices.map(selection => metrics(evidence, item.brief, selection));
    const maximumSupport = assessed.length ? Math.max(...assessed.map(value => value.support)) : null;
    const minimumReplacements = assessed.length ? Math.min(...assessed.map(value => value.replacements)) : null;
    const minimumReplacementsAtMaximumSupport = assessed.length ? Math.min(...assessed.filter(value =>
      value.support === maximumSupport).map(value => value.replacements)) : null;
    const productionOptions = createProgrammeService(evidence).repairOptions(item.brief);
    const results = {
      production: productionOptions.result,
      constraintOnly: alternate(evidence, item.brief, enumerated, 'constraintOnly'),
      rankAwareWithoutReplacementPreference: alternate(evidence, item.brief, enumerated, 'rankAware'),
    };
    const arms = Object.fromEntries(ARMS.map(arm => {
      const verified = verifyDecision(evidence, item.brief, results[arm], enumerated);
      if (assessed.length && arm !== 'constraintOnly' && verified.support !== maximumSupport) {
        verified.valid = false; verified.errors.push('not_maximum_support');
      }
      if (assessed.length && arm === 'production' && verified.replacements !== minimumReplacementsAtMaximumSupport) {
        verified.valid = false; verified.errors.push('not_minimum_replacements_at_maximum_support');
      }
      if (assessed.length && arm === 'constraintOnly' && verified.replacements !== minimumReplacements) {
        verified.valid = false; verified.errors.push('not_minimum_replacements');
      }
      return [arm, verified];
    }));
    return { case: item.id, family: item.family, evidence: item.fault ? 'synthetic-rank-deletion' : 'frozen-input',
      slots: item.brief.slots, maximumRuntime: item.brief.maximumRuntime,
      currentCount: item.brief.current.length, excludedCount: item.brief.excluded.length, lockedCount: item.brief.locked.length,
      eligibleCount: enumerated.permitted.length, feasiblePortfolios: enumerated.choices.length,
      oracle: { maximumSupport, minimumReplacements, minimumReplacementsAtMaximumSupport }, arms,
      runtimeAlternative: verifyRuntimeAlternative(evidence, item.brief, productionOptions) };
  });
  if (before !== JSON.stringify(data)) throw new Error('audit_mutation');
  const snapshotDate = Number.isFinite(Date.parse(data.dataset.checkedAt)) ? new Date(data.dataset.checkedAt).toISOString() : null;
  return { schemaVersion: 1, auditVersion: 'controlled-decisions-v1',
    input: { sha256: inputSha256, datasetSha256: hash(before),
      kind: data.dataset.synthetic === true ? 'labelled-synthetic-fixture' : 'non-synthetic-input-provenance-not-independently-attested',
      snapshotDate, films: 20, references: 3, completeRankings: data.profiles.filter(profile => Object.keys(profile.ranks).length === 20).length },
    protocol: { topK: TOP_K, runtimeCaps: CAPS, maximumUnfilteredThreeFilmCombinations: 1140,
      sameInputAndConstraintsForEveryArm: true, providersCalled: 0, inputUnchanged: true,
      scenarioSelection: 'Source-defined deterministic scenario rules; rank-derived stress and synthetic deletions reported separately.',
      seedPolicy: 'Cancellation and rebrief seeds use rank-aware drafts shared by all arms; review seeds use a constraint-only draft.',
      replacementMetric: 'Number of current films absent from the proposed set; locked night positions independently checked.',
      runtimeAlternativeCheck: 'Independent exhaustive search for the smallest higher whole-minute cap at or below 240 with full support and unchanged slots, locks and exclusions; verify offered option or absence.',
      tieBreak: 'Rank-aware: support, known best ranks in descending order, then catalogue-order ID string. Production inserts replacements after support when current is nonempty. Constraint-only: replacements then the same ID string.',
      limitations: ['Controlled decision audit, not a user study, enjoyment prediction, accuracy benchmark or comparison with a generic LLM.',
        'Fixed 20-film catalogue, three references and original top-five support policy.',
        'Generated scenarios are not estimates of real event frequency; seeds and support-stress rules condition the findings.',
        'Synthetic deletions test missing-evidence handling and are not genuine missing provider responses.',
        'Hashes identify inputs, not independent proof of their provider provenance.'] },
    summary: { frozenInput: summarize(rows.filter(row => row.evidence === 'frozen-input')),
      syntheticFaults: summarize(rows.filter(row => row.evidence !== 'frozen-input')) }, cases: rows };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Use: node scripts/decision-audit.mjs --input dataset-or-completed-packet.json [--output new-aggregate-report.json]');
    return;
  }
  if (![2, 4].includes(args.length) || args[0] !== '--input' || !args[1] ||
      (args.length === 4 && (args[2] !== '--output' || !args[3]))) throw new Error('audit_arguments');
  const info = await lstat(args[1]);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) throw new Error('audit_input');
  const bytes = await readFile(args[1]);
  const report = auditDecisions(JSON.parse(bytes.toString('utf8')), { inputSha256: hash(bytes) });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args[3]) await writeFile(args[3], output, { flag: 'wx', mode: 0o600 });
  console.log(output.trimEnd());
  if (!report.summary.frozenInput.allChecksPassed || !report.summary.syntheticFaults.allChecksPassed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Do not echo file paths, input values, response bodies or parse-error excerpts.
    console.error('Decision audit failed. Check the input schema and choose a new output file.');
    process.exitCode = 1;
  });
}
