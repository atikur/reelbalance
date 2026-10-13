import test from 'node:test';
import assert from 'node:assert/strict';
import { explainReplacement, summarizeRepair } from './public/replacement.js';
import { createProgrammeService } from './programme-service.mjs';

// Invented film and artist identifiers; these ranks exercise the policy only.
const film = (id, runtime, eligible = true) => ({ id, name: `Film ${id}`, year: 2000, runtime, eligible });
function fixture() {
  return { schemaVersion: 1, dataset: { synthetic: true }, films: [film('locked-a', 80), film('locked-c', 90),
    film('long-first', 165), film('long-second', 126), film('long-third', 124), film('cancelled', 106), film('replacement', 96), film('outside-five', 100)],
  profiles: [
    { id: 'a', name: 'Profile A', reference: 'Artist A', ranks: { 'locked-a': 1, 'locked-c': 6, replacement: 8 } },
    { id: 'b', name: 'Profile B', reference: 'Artist B', ranks: { 'long-first': 1, 'long-second': 2, 'long-third': 3, cancelled: 4, replacement: 5, 'outside-five': 6 } },
    { id: 'c', name: 'Profile C', reference: 'Artist C', ranks: { 'locked-c': 1, replacement: 9 } },
  ] };
}
const request = () => ({ slots: 3, maximumRuntime: 110, current: ['locked-a', 'cancelled', 'locked-c'],
  locked: ['locked-a', 'locked-c'], excluded: ['cancelled'] });
const proposed = () => ({ status: 'known_coverage_met', selection: ['locked-a', 'locked-c', 'replacement'],
  nightOrder: ['locked-a', 'replacement', 'locked-c'] });

test('replacement explanation identifies restored support and every original top-five obstacle', () => {
  const data = fixture(), brief = request(), result = proposed();
  const before = structuredClone({ data, brief, result });
  const explanation = explainReplacement(data, brief, { result });
  assert.equal(explanation.recovered.length, 1);
  const row = explanation.recovered[0];
  assert.equal(row.reference, 'Artist B');
  assert.equal(row.previousBestRank, 4);
  assert.equal(row.retainedBestRank, null);
  assert.equal(row.proposedBestRank, 5);
  assert.deepEqual(row.candidates.map(item => [item.rank, item.runtime, item.status]),
    [[1, 165, 'over_runtime'], [2, 126, 'over_runtime'], [3, 124, 'over_runtime'], [4, 106, 'excluded'], [5, 96, 'selected']]);
  assert.equal(row.onlyAvailableSupport, true);
  assert.match(row.candidateSummary, /only available film with known original top-five support/);
  assert.match(row.candidates[0].reason, /165 min exceeds the 110-minute limit/);
  assert.equal(explanation.added[0].night, 2);
  assert.deepEqual(explanation.locks.map(item => [item.previousNight, item.night, item.sameNight]), [[1, 1, true], [3, 3, true]]);
  assert.match(explanation.policy, /not an enjoyment prediction/);
  assert.deepEqual({ data, brief, result }, before);
});

test('real deterministic service output produces the same explanation without trusting reported coverage', () => {
  const data = fixture(), brief = request();
  const response = createProgrammeService(data).repairOptions(brief);
  response.result.represented = 0;
  const explanation = explainReplacement(data, brief, response);
  assert.equal(explanation.supportedReferenceCount, 3);
  assert.deepEqual(explanation.added.map(item => item.id), ['replacement']);
  assert.equal(explanation.recovered[0].proposedBestRank, 5);
});

test('unknown selected ranks remain unknown and original rank six is never renumbered into support', () => {
  const data = fixture();
  delete data.profiles[1].ranks.replacement;
  data.profiles[1].ranks['outside-five'] = 6;
  const result = proposed(); result.selection = ['locked-a', 'locked-c', 'outside-five'];
  result.nightOrder = ['locked-a', 'outside-five', 'locked-c'];
  const explanation = explainReplacement(data, request(), result);
  assert.equal(explanation.recovered.length, 0);
  assert.equal(explanation.unresolved.find(item => item.id === 'b').proposedBestRank, 6);
  assert.equal(explanation.unresolved.find(item => item.id === 'b').hasUnknownEligibleFilms, true);
  assert.ok(explanation.unknown.some(item => item.profileId === 'a' && item.filmId === 'outside-five'));
  assert.match(explanation.unknown[0].reason, /unknown/);
});

test('multiple available support candidates and ineligible films prevent a uniqueness overclaim', () => {
  const data = fixture();
  data.films.find(item => item.id === 'long-third').runtime = 110;
  data.films.find(item => item.id === 'long-second').eligible = false;
  const row = explainReplacement(data, request(), proposed()).recovered[0];
  assert.equal(row.eligibleSupportCandidateCount, 2);
  assert.equal(row.onlyAvailableSupport, false);
  assert.equal(row.candidates.find(item => item.id === 'long-third').status, 'eligible');
  assert.deepEqual(row.candidates.find(item => item.id === 'long-second').reasons.map(item => item.code), ['ineligible', 'over_runtime']);
  assert.doesNotMatch(row.candidateSummary, /only/);
});

test('support newly added to a previously unsupported reference is labelled adds rather than restores', () => {
  const data = fixture(); delete data.profiles[1].ranks.cancelled;
  const row = explainReplacement(data, request(), proposed()).recovered[0];
  assert.equal(row.previouslySupported, false);
  assert.match(row.summary, /adds original top-five support/);
});

test('a separately proposed runtime relaxation uses its own limit and preserves original ranks', () => {
  const brief = { ...request(), maximumRuntime: 126 };
  const result = { ...proposed(), selection: ['locked-a', 'long-second', 'locked-c'], nightOrder: ['locked-a', 'long-second', 'locked-c'] };
  const explanation = explainReplacement(fixture(), brief, result);
  assert.equal(explanation.maximumRuntime, 126);
  assert.equal(explanation.recovered[0].proposedBestRank, 2);
  assert.equal(explanation.recovered[0].eligibleSupportCandidateCount, 3);
  assert.equal(explanation.recovered[0].onlyAvailableSupport, false);
});

test('missing nightOrder is derived from retained current positions without using solver selection order', () => {
  const result = proposed(); delete result.nightOrder;
  const explanation = explainReplacement(fixture(), request(), result);
  assert.equal(explanation.added[0].night, 2);
  assert.equal(explanation.removed[0].previousNight, 2);
  assert.deepEqual(explanation.locks.map(item => item.night), [1, 3]);
});

test('initial, unchanged, conflicting or invalid proposals do not receive a replacement explanation', () => {
  const data = fixture(), brief = request();
  assert.equal(explainReplacement(data, { ...brief, current: [], locked: [] }, proposed()), null);
  assert.equal(explainReplacement(data, { ...brief, excluded: [] }, { selection: [...brief.current] }), null);
  assert.equal(explainReplacement(data, brief, { status: 'hard_conflict', selection: null }), null);
  assert.equal(explainReplacement(data, brief, { selection: ['locked-a', 'locked-c', 'long-first'] }), null);
  assert.equal(explainReplacement(data, brief, { selection: ['locked-a', 'replacement', 'outside-five'] }), null);
  assert.equal(explainReplacement(data, brief, { ...proposed(), nightOrder: ['locked-a', 'replacement', 'replacement'] }), null);
});

test('reference and film names are returned as plain text for the caller to escape', () => {
  const data = fixture(); data.films.find(item => item.id === 'replacement').name = '<film & title>';
  data.profiles[1].reference = '<artist>';
  const explanation = explainReplacement(data, request(), proposed());
  assert.equal(explanation.added[0].name, '<film & title>');
  assert.match(explanation.summary, /<artist>/);
});

test('repair summary recomputes lost and proposed support while preserving actual locked positions', () => {
  const data = fixture(), current = request(), target = structuredClone(current), result = proposed();
  result.represented = 0;
  result.evidence = [{ known_top_k_support: false, best_cached_rank: 20 }];
  const before = structuredClone({ data, current, target, result });
  assert.deepEqual(summarizeRepair(data, current, target, result), {
    beforeSupport: 2, afterSupport: 3, referenceCount: 3, keptLockedNightCount: 2,
    currentLimit: 110, proposedLimit: 110, limitUnchanged: true, nextState: 'proposed',
  });
  assert.deepEqual({ data, current, target, result }, before);
});

test('separate 117-minute option compares each side under its own brief and remains proposed', () => {
  const data = fixture();
  data.films.find(item => item.id === 'long-second').runtime = 117;
  const current = request(), target = { ...request(), maximumRuntime: 117 };
  const result = { ...proposed(), selection: ['locked-a', 'locked-c', 'long-second'],
    nightOrder: ['locked-a', 'long-second', 'locked-c'] };
  assert.deepEqual(summarizeRepair(data, current, target, result), {
    beforeSupport: 2, afterSupport: 3, referenceCount: 3, keptLockedNightCount: 2,
    currentLimit: 110, proposedLimit: 117, limitUnchanged: false, nextState: 'proposed',
  });
});

test('two-night repair discloses a support shortfall instead of promoting original ranks', () => {
  const current = { ...request(), slots: 2, current: ['locked-a', 'cancelled'], locked: ['locked-a'] };
  const result = { status: 'coverage_shortfall', selection: ['locked-a', 'replacement'],
    nightOrder: ['locked-a', 'replacement'], represented: 3 };
  const summary = summarizeRepair(fixture(), current, structuredClone(current), result);
  assert.equal(summary.beforeSupport, 1);
  assert.equal(summary.afterSupport, 2);
  assert.equal(summary.referenceCount, 3);
  assert.equal(summary.keptLockedNightCount, 1);
  assert.equal(summary.nextState, 'proposed');
});

test('valid unchanged review compares support without claiming a replacement or approval', () => {
  const current = { ...request(), excluded: [] };
  const result = { status: 'known_coverage_met', selection: [...current.current], nightOrder: [...current.current] };
  const summary = summarizeRepair(fixture(), current, structuredClone(current), result);
  assert.equal(summary.beforeSupport, 3);
  assert.equal(summary.afterSupport, 3);
  assert.equal(summary.keptLockedNightCount, 2);
  assert.equal(summary.nextState, 'proposed');
  assert.equal(Object.hasOwn(summary, 'approvedAt'), false);
});

test('unknown ranks and original rank six cannot create top-five support in the repair summary', () => {
  const data = fixture();
  delete data.profiles[1].ranks.replacement;
  const result = { ...proposed(), selection: ['locked-a', 'locked-c', 'outside-five'],
    nightOrder: ['locked-a', 'outside-five', 'locked-c'], represented: 3 };
  const summary = summarizeRepair(data, request(), request(), result);
  assert.equal(summary.beforeSupport, 2);
  assert.equal(summary.afterSupport, 2);
  data.profiles[1].ranks = {};
  assert.equal(summarizeRepair(data, request(), request(), proposed()).afterSupport, 2);
});

test('before support excludes unavailable, ineligible and over-limit current films', () => {
  const data = fixture();
  const current = { ...request(), excluded: [], maximumRuntime: 95 };
  assert.equal(summarizeRepair(data, current, { ...request(), excluded: [] }, proposed()).beforeSupport, 2);
  data.films.find(item => item.id === 'cancelled').eligible = false;
  assert.equal(summarizeRepair(data, { ...current, maximumRuntime: 110 }, { ...request(), excluded: [] }, proposed()).beforeSupport, 2);
  data.films.find(item => item.id === 'replacement').eligible = false;
  assert.equal(summarizeRepair(data, request(), request(), proposed()), null);
});

test('locked membership is insufficient when night positions shift or a lock disappears from the proposed brief', () => {
  const result = proposed();
  result.nightOrder = ['locked-c', 'replacement', 'locked-a'];
  assert.equal(summarizeRepair(fixture(), request(), request(), result), null);
  assert.equal(summarizeRepair(fixture(), request(), { ...request(), locked: ['locked-a'] }, proposed()), null);
});

test('a change to two nights cannot claim to keep a third-night lock in a new position', () => {
  const target = { ...request(), slots: 2 };
  const result = { status: 'coverage_shortfall', selection: ['locked-a', 'locked-c'],
    nightOrder: ['locked-a', 'locked-c'] };
  assert.equal(summarizeRepair(fixture(), request(), target, result), null);
  const current = { ...request(), locked: ['locked-a'] };
  const summary = summarizeRepair(fixture(), current, { ...target, locked: ['locked-a'] }, result);
  assert.equal(summary.beforeSupport, 2);
  assert.equal(summary.afterSupport, 2);
  assert.equal(summary.keptLockedNightCount, 1);
});

test('initial, conflicting, unavailable, over-limit and malformed results have no repair summary', () => {
  const data = fixture(), current = request(), result = proposed();
  assert.equal(summarizeRepair(data, { ...current, current: [], locked: [] }, current, result), null);
  assert.equal(summarizeRepair(data, current, current, { status: 'hard_conflict', selection: null }), null);
  assert.equal(summarizeRepair(data, current, { ...current, maximumRuntime: 95 }, result), null);
  assert.equal(summarizeRepair(data, current, { ...current, excluded: ['cancelled', 'replacement'] }, result), null);
  assert.equal(summarizeRepair(data, current, current, { ...result, nightOrder: ['locked-a', 'replacement', 'replacement'] }), null);
  assert.equal(summarizeRepair(data, current, current, { ...result, nightOrder: undefined }), null);
  assert.equal(summarizeRepair(data, current, { ...current, current: [...current.current].reverse() }, result), null);
  assert.equal(summarizeRepair(data, current, { ...current, maximumRuntime: 241 }, result), null);
  const invalid = fixture(); invalid.profiles[1].ranks.replacement = -1;
  assert.equal(summarizeRepair(invalid, current, current, result), null);
  assert.equal(summarizeRepair({ ...data, films: [null] }, current, current, result), null);
  assert.equal(summarizeRepair({ ...data, profiles: [null] }, current, current, result), null);
});
