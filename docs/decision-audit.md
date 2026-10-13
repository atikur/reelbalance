# Controlled offline decision audit

Run on 13 October 2026 with two frozen, maintainer-supplied Qloo evidence snapshots. The audit compares decision policies on the same catalogue, original ranks and constraints. It checks feasibility, original top-five support, replacement counts, locked night positions and the smallest offered runtime relaxation. It makes no Qloo or OpenAI requests.

Both snapshots passed every check: 342 arm/case verifications and 114 runtime-option or absence checks. These are controlled software checks, not audience outcomes, recommendation accuracy, time savings or evidence that ReelBalance outperforms a generic LLM.

## Inputs and provenance

Each input contains the same 20-film catalogue and three complete ordinal rankings. Snapshot A is the saved base example; Snapshot B is the completed custom evidence from the final public live verification. Their declared snapshot dates are 6 October and 12 October 2026 respectively. A snapshot date identifies the stored dataset metadata, not a new provider call by this audit. Some rankings in the custom snapshot were reused from earlier genuine cache.

The original evidence and full local aggregate reports remain private. This public report contains only aggregate counts and hashes, with no film or artist identities, individual ranks, source response bodies, credentials or local paths. The CLI labels non-synthetic provenance as unverified: a hash establishes correspondence to an input, not independent proof that a provider produced it. The maintainer identifies these two inputs as genuine historical Qloo evidence. Public reproduction uses explicitly invented fixtures.

| Hash | Snapshot A | Snapshot B |
|---|---|---|
| Exact input bytes, SHA-256 | `09de77bd745aedc70508b8f8770edcecf9786e3b963023e4ff9073d371fa309b` | `f486e8bd3bdb355a0a20740f4b66043ad619c962ac5807917177edb7d7561f10` |
| Validated normalized dataset, SHA-256 | `83e881a8d816c308ecb38cde75ec336734daf753c59979bd9cbc61ae80002202` | `8a302370fe3dde25b633d6ad3f074015bfdf4910063a30edf33abd6c0ae66db8` |
| Complete aggregate report bytes, SHA-256 | `8941200503fbdd08ccbe603d3c3d51fcdfa4cea804629d0223226a48f8f7f1a9` | `153ea86b3fef06dc783a9f25f1ece8332473900cfd9297a823ded528ab4b7303` |

Normalization uses the production programme service's validated dataset representation. The input hash covers the supplied JSON file, which can be a plain dataset or a completed evidence packet containing one.

## Compared policies

All arms receive identical films, ranks, runtime caps, exclusions, current selections and locks for each case. No arm receives more provider calls or a different catalogue.

| Policy | Decision order |
|---|---|
| Production | The actual `createProgrammeService().repairOptions()` path: maximise known reference support, then minimise replacements when a current programme exists, then compare known best ranks and use the production deterministic tie-break. |
| Constraint-only | Meet the hard constraints and minimise replacements; choose remaining ties by the same catalogue-order ID string. Ranking evidence is used only to evaluate the resulting selection, not to choose it. |
| Rank-aware without replacement preference | Maximise known reference support, then compare known best ranks and apply the same deterministic tie-break. It has no preference for preserving existing films. |

Support means at least one selected film in a reference's original top five **within this fixed 20-film ranking**. Filtering does not renumber ranks. Missing entries remain unknown. The rank-aware tie-break first prefers more known best ranks, then compares those best ranks in descending order, followed by the catalogue-order ID string. Replacement count is the number of current films absent from the proposal; it is not a count of user actions or elapsed time.

The constraint-only policy is deliberately rank-blind and its ID tie-break is arbitrary with respect to taste. It is not a simulated human programmer or an LLM baseline. Better support under an objective that explicitly maximises support is expected; the audit checks that the implementation achieves its stated policy and exposes its trade-offs.

## Scenario rules and independent checks

The source defines deterministic scenario rules; they are not preregistered or held-out examples. The same rules were used for both snapshots:

- Two- and three-night drafts at per-film caps of 90, 110, 120, 150 and 240 minutes.
- Review of a constraint-only draft under the same brief, when that draft is feasible.
- Cancel each night of a shared rank-aware 110-minute draft, once with no locks and once with all surviving nights locked.
- Rebrief a shared rank-aware 150-minute draft at 90, 110 and 120 minutes, with no lock or its first night locked.
- Deliberately conflicting briefs: a one-minute cap, a locked-and-excluded film, and three locked films for two nights.
- Rank-derived stress cases excluding each reference's original top-five films in turn.

Each snapshot produced 51 cases using the unchanged frozen evidence: 10 drafts, 8 constraint-first reviews, 10 cancellations, 12 rebriefs, 5 deliberate conflict cases and 6 rank-derived support stress cases. Reviews without a feasible seed are omitted by the stated rule. Cancellation/rebrief seeds are rank-aware, while review seeds are constraint-only; these choices condition the results and are shared across arms. The cases do not estimate the frequency of real programming problems.

A separate enumerator visits every eligible unordered two- or three-film combination: at most 190 or 1,140 combinations before filtering. It independently checks selected membership, eligibility, runtime, exclusions, locks, night-order membership, locked positions in an existing complete programme, original-rank evidence, reported support/status and change receipts. It also verifies the maximum possible support and the minimum replacement count at that support. A returned hard conflict is accepted only when no feasible portfolio exists.

For the production runtime option, a second exhaustive search finds the smallest higher whole-minute cap at or below 240 that permits full support with the same slots, locks and exclusions. It verifies the offered cap and selection, preserved night positions, unchanged current brief, or correct absence of an option. A pending option does not approve or change the organiser's brief.

## Results on the unchanged frozen inputs

| Metric | Snapshot A | Snapshot B |
|---|---:|---:|
| Cases / feasible / hard conflict | 51 / 38 / 13 | 51 / 40 / 11 |
| All three arms passed independent checks | 51 / 51 | 51 / 51 |
| Production achieved the feasible maximum support | 38 / 38 | 40 / 40 |
| Full-support cases: production / constraint-only / rank-aware | 14 / 4 / 14 | 34 / 18 / 34 |
| Production had higher / equal / lower support than constraint-only | 23 / 15 / 0 | 22 / 18 / 0 |
| Production had fewer / equal / more replacements than rank-aware | 8 / 30 / 0 | 8 / 32 / 0 |
| Production and rank-aware had equal support | 38 / 38 | 40 / 40 |
| Total replacements: production / constraint-only / rank-aware | 24 / 18 / 32 | 22 / 14 / 34 |
| Runtime options offered / independently verified | 8 / 8 | 8 / 8 |
| Correct absence of a runtime option | 43 / 43 | 43 / 43 |

Production sometimes replaces more films than constraint-only to gain support. Compared with rank-aware planning at equal support, it avoids some replacements. For example, the source-defined three-night review at 110 minutes in Snapshot B gave production support for three references with one replacement, constraint-only support for two with zero replacements, and rank-aware support for three with three replacements. This is an inspectable policy trade-off, not a finding that one audience would prefer the result.

Runtime checks also confirmed shortfalls and impossibility. Snapshot A's two-night draft at 110 minutes cannot support all three references under the policy; the oracle agrees. Some three-night cancellations require a separately proposed 117- or 119-minute cap to restore full support. The audit does not silently relax the original cap.

## Separately labelled missing-rank faults

Each snapshot also received six deliberate fault cases: sparse deletion of every fourth catalogue entry, offset by reference, and complete deletion of the third reference's ranks. Each mask was applied to two drafts and one locked cancellation. The remaining original ranks were kept unchanged. These are synthetic deletions, not genuine missing Qloo responses.

All 36 arm/case checks across the 12 fault cases passed. Production achieved the maximum certifiable support in all 12. No case with an entirely unscored reference claimed full support. One runtime option was offered in Snapshot B's sparse-deletion cases and independently verified; the other 11 fault cases correctly offered none. Original-rank evidence and unknown selected entries were independently checked.

Across frozen and fault cases together, all 17 offered runtime options and all 97 absences were verified. The validated input datasets remained unchanged.

## Reproduce with invented fixtures

The audit requires Node.js 22.19 or newer and no provider credentials:

```sh
node --test scripts/decision-audit.test.mjs
node scripts/decision-audit.mjs --input release/synthetic-data.json
node scripts/decision-audit.mjs --input release/synthetic-data.json --output new-aggregate-report.json
```

The CLI reads a bounded regular JSON file and writes only aggregate JSON. An output file is created with owner-only permissions and must not already exist. It does not echo the input path, identities, raw ranks or parse-error excerpts. The public fixture run is a test of invented data; it does not reproduce genuine Taste AI results.

The 12 audit regression tests passed locally and in Node.js 22 Linux at 512 MiB combined memory/swap and 0.5 CPU on 13 October. The frozen-input audit itself ran locally; the Linux regression checks used invented fixtures. They cover exhaustive counts, policy trade-offs, invalid night positions, false conflicts, original-rank nonpromotion, runtime-option minimality/absence, unchanged briefs, output privacy and nonoverwriting files.

## What this does not establish

There are no held-out human preference labels or organiser evaluations. The fixed shortlist was originally assembled from the example references' Qloo discoveries and is reused for custom references. The top-five threshold remains the product's explicit policy; this audit does not validate that threshold, music-to-film suitability, fairness, enjoyment, attendance or demand. Qloo ranks are input evidence, not a ground-truth label of what any person likes. Screening rights, actual copy availability and exact copy runtimes remain organiser checks.

This controlled audit replaces neither a recommendation-quality study nor a fair LLM comparison. Its useful conclusion is narrower: on these disclosed frozen inputs and source-defined briefs, the production policy obeyed its hard constraints, achieved its ordinal-support objective, preserved locked night positions and offered only independently verified minimal runtime alternatives.
