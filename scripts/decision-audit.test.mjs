import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProgrammeService } from '../app/programme-service.mjs';
import { auditDecisions, verifyDecision, verifyRuntimeAlternative } from './decision-audit.mjs';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('./decision-audit.mjs', import.meta.url));
const sample = JSON.parse(await readFile(new URL('../release/synthetic-data.json', import.meta.url), 'utf8'));
const fixture = () => structuredClone(sample);

function preferenceFixture() {
  const data = fixture();
  data.films.forEach(film => { film.runtime = 80; });
  const ids = data.films.map(film => film.id);
  data.profiles.forEach((profile, index) => {
    const head = [ids[17 + index], ids[3], ids[4], ids[5], ids[index]];
    const order = [...head, ...ids.filter(id => !head.includes(id))];
    profile.ranks = Object.fromEntries(order.map((id, rank) => [id, rank + 1]));
  });
  return data;
}

test('the same invented fixture yields independently verified outcomes in all three policies', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const report = auditDecisions(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(report.input.kind, 'labelled-synthetic-fixture');
  assert.equal(report.input.completeRankings, 3);
  assert.equal(report.protocol.providersCalled, 0);
  assert.equal(report.protocol.maximumUnfilteredThreeFilmCombinations, 1140);
  assert.ok(report.summary.frozenInput.allChecksPassed);
  assert.ok(report.summary.syntheticFaults.allChecksPassed);
  assert.ok(report.summary.frozenInput.hardConflictCases >= 5);
  assert.equal(report.summary.frozenInput.productionVersusConstraintOnly.lowerSupport, 0);
  assert.equal(report.summary.frozenInput.productionVersusRankAware.moreReplacements, 0);
  assert.equal(report.summary.frozenInput.productionVersusRankAware.sameSupport,
    report.summary.frozenInput.feasibleCases);
});

test('exhaustive oracle counts all 20 choose 3 and 20 choose 2 portfolios when everything fits', () => {
  const report = auditDecisions(preferenceFixture());
  assert.equal(report.cases.find(row => row.case === 'draft-3-cap240').feasiblePortfolios, 1140);
  assert.equal(report.cases.find(row => row.case === 'draft-2-cap240').feasiblePortfolios, 190);
});

test('controlled fixture exposes ranking support and the separate effect of replacement preference', () => {
  const report = auditDecisions(preferenceFixture());
  const two = report.cases.find(row => row.case === 'review-2-cap110');
  assert.equal(two.arms.constraintOnly.support, 2);
  assert.equal(two.arms.production.support, 3);
  assert.equal(two.arms.production.replacements, 1);
  const three = report.cases.find(row => row.case === 'review-3-cap110');
  assert.equal(three.arms.production.support, 3);
  assert.equal(three.arms.production.replacements, 0);
  assert.equal(three.arms.rankAwareWithoutReplacementPreference.support, 3);
  assert.equal(three.arms.rankAwareWithoutReplacementPreference.replacements, 3);
});

test('independent verifier rejects shifted locked nights even if membership is unchanged', () => {
  const data = preferenceFixture();
  const current = data.films.slice(0, 3).map(film => film.id);
  const brief = { slots: 3, maximumRuntime: 110, current, locked: [current[0]], excluded: [] };
  const result = createProgrammeService(data).programme(brief);
  assert.ok(verifyDecision(data, brief, result).valid);
  const bad = structuredClone(result);
  [bad.nightOrder[0], bad.nightOrder[1]] = [bad.nightOrder[1], bad.nightOrder[0]];
  assert.ok(verifyDecision(data, brief, bad).errors.includes('locked_night_position'));
});

test('independent verifier catches infeasible proposals and false hard conflicts', () => {
  const data = preferenceFixture();
  const current = data.films.slice(0, 3).map(film => film.id);
  const brief = { slots: 3, maximumRuntime: 110, current, locked: [], excluded: [] };
  assert.ok(verifyDecision(data, brief, { status: 'hard_conflict', selection: null, nightOrder: null })
    .errors.includes('false_hard_conflict'));
  const result = createProgrammeService(data).programme(brief);
  assert.ok(verifyDecision(data, { ...brief, excluded: [result.selection[0]] }, result).errors.includes('excluded_film'));
  assert.ok(verifyDecision(data, { ...brief, maximumRuntime: 79 }, result).errors.includes('runtime'));
});

test('original ranks stay unknown after deletion and cannot be promoted into top-five support', () => {
  const data = preferenceFixture();
  for (const [id, rank] of Object.entries(data.profiles[0].ranks)) if (rank <= 5) delete data.profiles[0].ranks[id];
  const brief = { slots: 3, maximumRuntime: 110, current: [], locked: [], excluded: [] };
  const result = createProgrammeService(data).programme(brief);
  assert.equal(result.represented, 2);
  assert.equal(result.status, 'coverage_not_certified');
  assert.ok(verifyDecision(data, brief, result).valid);
  const wrongSupport = { ...result, represented: 3, status: 'known_coverage_met' };
  const errors = verifyDecision(data, brief, wrongSupport).errors;
  assert.ok(errors.includes('support_count'));
  assert.ok(errors.includes('support_status'));
  const wrongRank = structuredClone(result);
  wrongRank.evidence[0].best_cached_rank = 1;
  assert.ok(verifyDecision(data, brief, wrongRank).errors.includes('rank_evidence'));
  const audit = auditDecisions(preferenceFixture());
  for (const row of audit.cases.filter(item => item.case.endsWith('one-reference-unscored') && item.feasiblePortfolios)) {
    assert.equal(row.evidence, 'synthetic-rank-deletion');
    assert.ok(row.arms.production.support <= 2);
    assert.ok(row.arms.production.unknownSelectedRanks >= row.slots);
    assert.ok(row.arms.production.valid);
  }
});

test('safe aggregate excludes input identities, names, URLs, paths and individual ranks', () => {
  const data = preferenceFixture();
  data.dataset.source = 'Private source marker https://private.invalid/example';
  data.dataset.id = 'PRIVATE-DATASET-MARKER';
  data.profiles[0].reference = 'PRIVATE-REFERENCE-MARKER';
  data.films[0].name = 'PRIVATE-TITLE-MARKER';
  const output = JSON.stringify(auditDecisions(data));
  for (const marker of [data.dataset.id, data.dataset.source, data.profiles[0].reference,
    data.films[0].name, ...data.films.map(film => film.id)]) assert.ok(!output.includes(marker));
  assert.ok(!output.includes('"ranks"'));
  assert.ok(!output.includes('"selection"'));
  assert.ok(!output.includes('"nightOrder"'));
});

test('runtime alternative oracle requires the smallest full-support cap and preserved locked nights', () => {
  const data = fixture();
  const service = createProgrammeService(data);
  const initial = service.programme({ slots: 3, maximumRuntime: 110, current: [], locked: [], excluded: [] });
  const current = initial.nightOrder;
  const brief = { slots: 3, maximumRuntime: 110, current, locked: current.slice(0, 2), excluded: [current[2]] };
  const options = service.repairOptions(brief);
  const verified = verifyRuntimeAlternative(data, brief, options);
  assert.equal(verified.minimumFullSupportRuntime, 117);
  assert.equal(verified.offered, true);
  assert.equal(verified.support, 3);
  assert.equal(verified.lockedNightPositionsPreserved, true);
  assert.equal(verified.valid, true);
  const nonminimal = structuredClone(options);
  nonminimal.runtimeAlternative.maximumRuntime = 118;
  assert.ok(verifyRuntimeAlternative(data, brief, nonminimal).errors.includes('runtime_option_limit'));
  const shifted = structuredClone(options);
  [shifted.runtimeAlternative.result.nightOrder[0], shifted.runtimeAlternative.result.nightOrder[1]] =
    [shifted.runtimeAlternative.result.nightOrder[1], shifted.runtimeAlternative.result.nightOrder[0]];
  assert.ok(verifyRuntimeAlternative(data, brief, shifted).errors.includes('locked_night_position'));
  const changedBrief = structuredClone(options);
  changedBrief.result.checks.maximumRuntime = 117;
  assert.ok(verifyRuntimeAlternative(data, brief, changedBrief).errors.includes('current_brief_changed'));
  assert.ok(verifyRuntimeAlternative(data, brief, { ...options, runtimeAlternative: null }).errors.includes('missing_runtime_option'));
});

test('runtime oracle correctly checks absence, locked exclusions and a previously infeasible cap', () => {
  const data = preferenceFixture();
  const service = createProgrammeService(data);
  const current = data.films.slice(0, 3).map(film => film.id);
  const ordinary = { slots: 3, maximumRuntime: 110, current, locked: [], excluded: [] };
  const noOption = service.repairOptions(ordinary);
  assert.equal(verifyRuntimeAlternative(data, ordinary, noOption).offered, false);
  assert.ok(verifyRuntimeAlternative(data, ordinary, { ...noOption,
    runtimeAlternative: { maximumRuntime: 111, result: noOption.result } }).errors.includes('unexpected_runtime_option'));
  const conflict = { ...ordinary, locked: [current[0]], excluded: [current[0]] };
  const absent = verifyRuntimeAlternative(data, conflict, service.repairOptions(conflict));
  assert.equal(absent.minimumFullSupportRuntime, null);
  assert.equal(absent.valid, true);
  const tight = { ...ordinary, maximumRuntime: 79, locked: [current[0]] };
  const raised = verifyRuntimeAlternative(data, tight, service.repairOptions(tight));
  assert.equal(raised.minimumFullSupportRuntime, 80);
  assert.equal(raised.valid, true);
  assert.equal(raised.lockedNightPositionsPreserved, true);
});

test('completed packet and plain dataset use the same normalized evidence and case results', () => {
  const data = preferenceFixture();
  const plain = auditDecisions(data);
  const packet = auditDecisions({ schemaVersion: 1, dataset: data, ignoredPrivateMarker: 'DO-NOT-EXPORT' });
  assert.equal(plain.input.datasetSha256, packet.input.datasetSha256);
  assert.deepEqual(plain.cases, packet.cases);
  assert.ok(!JSON.stringify(packet).includes('DO-NOT-EXPORT'));
});

test('audit rejects duplicate ordinal ranks, oversized pools and invalid hash metadata', () => {
  const duplicate = preferenceFixture();
  const [first, second] = duplicate.films;
  duplicate.profiles[0].ranks[first.id] = duplicate.profiles[0].ranks[second.id];
  assert.throws(() => auditDecisions(duplicate));
  const oversized = preferenceFixture();
  oversized.films.push({ ...oversized.films[0], id: 'invented-extra' });
  assert.throws(() => auditDecisions(oversized));
  assert.throws(() => auditDecisions(preferenceFixture(), { inputSha256: 'private-path' }));
});

test('CLI writes a private aggregate without overwriting or exposing invalid input', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'decision-audit-private-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'PRIVATE-PATH-MARKER.json');
  const output = join(directory, 'aggregate.json');
  await writeFile(input, JSON.stringify(preferenceFixture()));
  const completed = await exec(process.execPath, [script, '--input', input, '--output', output]);
  assert.ok(!completed.stdout.includes(input));
  assert.equal(JSON.parse(completed.stdout).protocol.providersCalled, 0);
  assert.equal(completed.stdout, await readFile(output, 'utf8'));
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  await assert.rejects(exec(process.execPath, [script, '--input', input, '--output', output]), error => {
    assert.ok(!error.stderr.includes(input));
    assert.match(error.stderr, /Decision audit failed/);
    return true;
  });
  await writeFile(input, 'PRIVATE-INVALID-CONTENT-MARKER');
  await assert.rejects(exec(process.execPath, [script, '--input', input]), error => {
    assert.ok(!error.stderr.includes(input));
    assert.ok(!error.stderr.includes('PRIVATE-INVALID-CONTENT-MARKER'));
    assert.equal(error.stdout, '');
    return true;
  });
});
