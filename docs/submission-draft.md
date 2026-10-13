# ReelBalance submission template

Prepared on 13 October 2026. Copy the project story from **Inspiration** through **What's next** into Devpost; this status paragraph and maintainer notes are not submission text. Public source omits the hosted demo and unlisted video URLs, which belong in Devpost's project-link fields. The source improvements below are deployed and verified on 13 October: 199 local and offline Linux tests, a clean-copy rehearsal and hosted desktop/mobile, keyboard, reload, repair and export checks passed. Submission has not been confirmed.

## Project name

ReelBalance

## Tagline

Keep the agreed nights. Repair a film-club programme with Qloo taste evidence and approval before every change.

## Inspiration

One film falls through. Two nights are already agreed. What survives?

A small adult film club needs to fit several interests into a short programme while respecting runtime limits and decisions already made. ReelBalance focuses on the organiser's next decision: preserve the agreed nights, inspect the replacement and approve the change.

## What it does

ReelBalance builds and repairs two- or three-night programmes from a curated pool of 20 films. Three declared music interests provide the cultural references. Qloo ranks the same film pool independently for each reference; the organiser can inspect the original ranks behind a choice.

Set a per-film runtime limit, review a draft and approve it. If a film becomes unavailable, lock the surviving nights and ask Luna for a repair. The planner excludes the cancelled title, preserves locked night positions and checks the current limit. **Why this replacement?** connects the proposal to the lost support, retained choices and original ranks, showing when a higher-ranked candidate is unavailable or too long. If full support needs more runtime, that option remains separate until explicitly approved.

The approved order, brief, locks, exclusions and prepared artist-collection checkpoint can be saved in the browser. Reload revalidates the catalogue and cached evidence; it does not revive an unapproved proposal or replay an assistant request. The workspace puts the programme before its editing controls. Pending proposals show support before and after, kept locked nights and any runtime change separately from the previous approval. The downloadable sheet summarises the approved order and cap, with every reference’s original rank, unknown state, runtime discrepancies and source caveats.

Every feature is available publicly, including custom artists and live planning. Optional judge login adds reserved allowance. A ready example makes the main workflow accessible immediately; fresh custom collection explains its waiting time, retains completed work and announces meaningful operation states.

## How we built it

The application uses JavaScript and Node.js, Qloo Taste AI Insights through the official Qloo harness, and GPT-6 Luna through the OpenAI Responses API. The 20-film pool was curated from the original example references' Qloo suggestions and checked for film identity and runtime. Custom artists rerank this fixed pool rather than discover a new catalogue.

The organiser confirms canonical artist matches before explicitly collecting one movie ranking per artist. Original ranks survive filtering, omitted films stay unknown and affinity magnitudes are never compared across requests. A reference has support when at least one usable selected film is in its original top five. These are declared interests, not member votes or measured audience segments.

A deterministic solver enforces runtime, exclusions and locked positions. It first maximises known reference support, then minimises replacements. Luna uses a bounded tool loop to interpret requests, inspect evidence and explain proposals. Planning and export reuse completed Qloo evidence without new retrieval. All proposed changes require approval.

Provider actions are explicit, bounded and never retried automatically. Completed evidence stays in a private server cache. Browser saving retains a minimal programme checkpoint without credentials or model replies, and validates it against current evidence before restoration. The public MIT repository includes the application and clearly labelled synthetic setup fixtures; genuine responses and credentials remain private.

## Challenges we ran into

The difficult part was keeping the evidence, proposal and approved programme consistent. Removing a film must not renumber Qloo ranks, move locked nights or silently relax the runtime limit. The explanation, approval flow and export preserve those distinctions.

Recovery needs the same care: a reload can restore approved work, but an interrupted request must not become an approval or run again. Fresh custom references can require three searches and three rankings with one-minute gaps. The app explains that wait, preserves prepared collection progress and keeps the ready example available.

## Accomplishments we're proud of

The published live-call demonstration shows a complete repair: **3/3 references supported → 2/3 after cancellation → 3/3 after approval**.

The initial programme is Moonrise Kingdom, Whiplash and Frances Ha. Nights 1 and 3 are locked. Removing Whiplash leaves Anoushka Shankar's reference without a selected top-five film. Short Term 12 restores that support through its original rank five, keeps both agreed nights in place and fits the unchanged 110-minute per-film cap. The organiser reviews the replacement, approves it and exports the sheet.

That hosted session on 11 October used three fresh Qloo movie rankings and two live Luna interactions, with no saved Luna replay. Subsequent checks verified the full anonymous custom-artist workflow, planning, repair, approvals, locked positions and matching HTML export; optional judge calls used reserved capacity.

The final release passed 199 local and offline Linux tests, plus hosted desktop/mobile, keyboard, saved-workspace recovery, repair and matching HTML download checks. It reused genuine completed evidence without new provider calls.

A controlled offline decision audit compares the production planner, a constraint-only policy and a rank-aware policy without replacement preference on the same frozen inputs. A separate enumerator checks feasible combinations, support, minimal replacements, locked positions and change receipts. Synthetic missing-rank faults are reported separately. The [audit protocol and results](https://github.com/atikur/reelbalance/blob/main/docs/decision-audit.md) document what this establishes and its limits.

## What we learned

Taste evidence becomes useful when an organiser can connect it to a decision. Original ranks explain the replacement, locks protect prior agreements and explicit approval separates a suggestion from a commitment. Useful recovery preserves those decisions without pretending an old proposal is current.

Top-five support is evidence under a stated planning policy. It does not establish that real members will enjoy a film or that the programme will improve attendance.

## What's next

Let organisers supply their own vetted film pools and extend planning beyond two or three nights. The current product addresses a bounded programme-repair task; it does not manage bookings, calendars, ticketing or member votes. Screening rights, actual copy availability and exact runtimes still need organiser confirmation. Adoption, organiser time savings, enjoyment and attendance have not been measured.

## Built with

JavaScript, Node.js, HTML, CSS, Qloo Taste AI Insights, the official Qloo harness, OpenAI Responses API, GPT-6 Luna, Docker and Caddy.

## Project links

- Functional demo: use the demo URL in Devpost.
- Public source: [atikur/reelbalance](https://github.com/atikur/reelbalance), licensed under MIT.
- Demo video: use the unchanged 1:33 unlisted video URL in Devpost; English AI-generated narration.
- Testing instructions: [Judge walkthrough](https://github.com/atikur/reelbalance/blob/main/docs/judge-demo.md).
- Setup: [Deployment guide](https://github.com/atikur/reelbalance/blob/main/docs/deployment.md).

The video uses real hosted-app footage from the 11 October live-call session. Waiting time is trimmed and the cancellation is staged. Some initial successful results appear in same-session pickups after a recorder interruption. No saved Luna replay or fabricated application output is used. The repair remains accurate; subsequent saving, explanation and recovery improvements do not require a new recording.

## Maintainer notes — do not paste into the project description

- On 13 October 2026, all 199 portable tests passed locally and in Node.js 22 Linux under 512 MiB combined memory/swap and 0.5 CPU. The clean-copy rehearsal verified 61 public source and fixture files with external requests blocked. The healthy `reelbalance:visual-polish-final-20261013` deployment retained patched dependencies, private evidence, provider counters, credentials and existing allowances. Hosted desktop, 390×844 mobile and keyboard checks verified saving, safe reload, prepared custom-evidence recovery, replacement explanations, explicit approval and the programme sheet. The actual HTML download matched the canonical renderer. These release checks reused genuine completed Qloo evidence and made no new provider calls.
- The 11 October demonstration made three fresh Qloo movie-ranking requests and two live Luna interactions using four OpenAI attempts. The 12 October public custom check made two public Qloo requests and two Luna interactions using six OpenAI attempts, preserved locked Nights 1 and 3, kept the 110-minute cap and produced a matching export. A separate judge explanation used two reserved OpenAI attempts without changing public or guest allowances. These are dated technical checks, not organiser research.
- Public allowance is 180 OpenAI attempts per UTC day and 24 Luna interactions per browser session. Public Qloo has a separate 120-attempt daily pool and 12-attempt browser cap. Optional judges and organisers share reserved pools of 240 OpenAI attempts and 60 Qloo attempts without guest caps. Judge credentials belong only in private testing instructions.
- Provider operations remain globally serialised. Qloo calls have a minimum 60-second gap; failures pause access and nothing retries automatically. Persistence must not restore authentication, quotas, provider locks, assistant output or unapproved proposals.
- Public source must retain synthetic labels and exclude private provider evidence, model replies, credentials, hosted demo and unlisted video URLs. Keep setup instructions and the manifest in sync with the final source.
- The earlier four-scenario comparison used different evidence and call budgets between arms; it does not isolate Qloo's effect. The controlled audit is a decision-policy check, not a generic-LLM benchmark or evidence of audience enjoyment.
- No submission or eligibility certification is recorded here. Review Devpost's fields and declarations before submitting, and preserve free access through judging. [Official rules](https://qloo.devpost.com/rules)
