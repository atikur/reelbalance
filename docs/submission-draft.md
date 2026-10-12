# ReelBalance submission template

Updated on 12 October 2026. This public template omits the hosted demo and unlisted video URLs; supply those project links in Devpost. It describes the final `reelbalance:public-access-ui-20261012` deployment and verified full public workflow, while preserving dated historical evidence. The entry copy is ready for review. Submission has not been confirmed. Maintainer notes at the end are separate from the project description.

## Project name

ReelBalance

## Tagline

Keep the agreed nights. Repair a film-club programme with Qloo taste evidence and approval before every change.

## Inspiration

One film falls through. Two nights are already agreed. What survives?

A small adult film club has several interests to accommodate, a runtime limit and decisions its organiser has already made. When a film becomes unavailable, finding a replacement means preserving those agreements while understanding whose tastes lose support.

ReelBalance focuses on that moment: help the organiser keep good decisions, inspect the trade-offs and approve a repair.

## What it does

ReelBalance builds and repairs two- or three-night programmes from a vetted pool of 20 films. Three declared music interests provide the taste references. Qloo ranks the same film pool independently for each reference, giving the organiser inspectable evidence for a choice.

The organiser sets a per-film runtime limit, reviews a draft and approves it. If a film becomes unavailable, they can lock the surviving nights and ask Luna for a repair. The planner preserves locked films in their approved positions, excludes the cancelled title and checks the current limit. When full taste support is unavailable, the interface shows the shortfall. A separate runtime option can be proposed where it helps; changing the limit requires explicit approval.

Every proposed replacement awaits approval. A change receipt and downloadable HTML programme sheet preserve the approved night order, original ranks, runtime notes and source caveats.

## How we built it

The application uses JavaScript and Node.js, with Qloo Taste AI Insights accessed through the official Qloo harness. The organiser confirms canonical artist matches before explicitly collecting one movie ranking per artist against the same fixed 20-film pool. Completed responses are cached privately on the server.

An explicit support policy asks whether each music reference has at least one selected film in its original Qloo top five. Original ranks survive filtering, missing ranks stay unknown, and affinity magnitudes are never compared across requests. This policy measures support in the ranking evidence; it does not predict audience enjoyment.

A deterministic solver enforces runtime, exclusions and locked night positions. Repairs first maximise known reference support, then minimise replacements, with deterministic tie-breaking. GPT-6 Luna uses a bounded OpenAI Responses tool loop to inspect the brief, invoke planning tools and explain proposals. Planning, repair and export reuse the completed Qloo evidence without further Qloo requests.

The app offers a genuine saved example, live Luna interactions and an explicitly labelled recorded walkthrough. Anonymous visitors can choose their own artists, explicitly collect Qloo rankings, plan, repair, approve and export through a signed browser session, without a login. Optional judge sign-in adds reserved provider capacity; its popup explains that all features are already public. Owner administration and provider credentials remain private. The full public workflow and reserved judge access passed live checks on 12 October. The public MIT repository includes the complete application and clearly labelled synthetic setup fixtures; genuine Qloo responses, saved model replies and credentials remain private.

## Challenges we ran into

The difficult part was keeping the evidence, proposal and approved programme consistent. Removing a film must preserve the original Qloo ranks and any locked night positions. A useful runtime alternative must remain pending until the organiser accepts it. The planner, approval flow and exported sheet all preserve those distinctions.

Provider availability also needs an honest product state. Explicit collection actions, bounded model calls and persistent request guards keep usage controlled. Failed live requests remain visible, while manual planning can continue with completed evidence.

## Accomplishments we're proud of

The hosted live-call session on 11 October 2026 completed three fresh Qloo movie rankings and two live Luna interactions, using four OpenAI requests. It used no saved Luna replay.

Luna first proposed Moonrise Kingdom, Whiplash and Frances Ha. After approval, Nights 1 and 3 were locked and Whiplash was marked unavailable for the demo scenario. The repair replaced it with Short Term 12, whose original rank for the Anoushka Shankar reference was five. Both locked nights stayed in place, the 110-minute per-film limit stayed unchanged, and all three references regained original top-five support. The organiser explicitly approved the repair and downloaded its programme sheet.

The 11 October interface revision passed 80 portable tests locally and in Linux under the then-deployed resource caps. Its clean-copy rehearsal verified the source allowlist, manifest and synthetic manual workflow without external API requests. The 12 October judge-access revision passed 102 tests locally and in offline Linux checks under the original 256 MiB cap and 0.5 CPU. Public example and authenticated judge sessions then passed live planning, approvals, preserved locks, repair and export checks. The judge check made one fresh Qloo artist lookup and two live Luna interactions using four OpenAI requests, reusing genuine 11 October rankings without consuming the public model pool. These historical checks are distinct from the final public verification below.

The full public backend subsequently passed 139 offline Linux tests and was deployed healthy, retaining existing private evidence and provider counts. A separate compatibility revision passed 54 tests for reading the updated browser ledger and expanded cache, and the final UI passed 25 offline Linux UI tests under 512 MiB and 0.5 CPU. Desktop and mobile checks verified the prominent judge button and its extra-capacity explanation.

The final public live check collected one fresh Joni Mitchell ranking after a canonical artist search, reused genuine Radiohead and Bill Evans rankings, and completed two Luna interactions for planning and repair. It used two public Qloo requests and six OpenAI attempts, with no provider retries. Explicit approvals kept the 110-minute per-film limit, preserved Nights 1 and 3, replaced Night 2 and produced an HTML export matching the local renderer. Public calls left reserved judge capacity unchanged; a separate live judge explanation used only its reserved pool.

## What we learned

Taste evidence becomes useful when an organiser can see how it changes a decision. Original ranks make the replacement inspectable, preserved locks protect prior agreements, and explicit approval keeps a proposal separate from a commitment. Missing evidence and support shortfalls need to stay visible throughout that workflow.

## What's next

Collect feedback from film-club organisers and explore accepting their own vetted film pools. Screening rights, actual copy availability and exact film-copy runtimes still need organiser confirmation; enjoyment and attendance have not been measured.

## Built with

JavaScript, Node.js, HTML, CSS, Qloo Taste AI Insights, the official Qloo harness, OpenAI Responses API, GPT-6 Luna, Docker and Caddy.

## Project links

- Functional demo: use the demo URL in the Devpost submission.
- Public source: [atikur/reelbalance](https://github.com/atikur/reelbalance), licensed under MIT.
- Demo video: use the video URL in the Devpost submission; 1:33, unlisted, with English AI-generated narration.
- Testing instructions: [Judge walkthrough](https://github.com/atikur/reelbalance/blob/main/docs/judge-demo.md).
- Setup and private runtime provisioning: [Deployment guide](https://github.com/atikur/reelbalance/blob/main/docs/deployment.md).

The video uses real hosted-app footage from the 11 October live-call session. Waiting time is trimmed and the cancellation is staged. Some initial successful results are shown in same-session pickups after a recorder interruption. No saved Luna replay or fabricated application output is used.

## Maintainer notes — do not paste into the project description

- The published video is unchanged. `reelbalance:public-access-ui-20261012` is deployed and was healthy at verification, with `REELBALANCE_PUBLIC_CUSTOM=1`, 512 MiB memory and combined memory/swap, and 0.5 CPU. Final UI and full live public checks are complete. Preserve hosting and free access through judging; dated checks do not guarantee future provider or hosting availability.
- Public allowances are 180 OpenAI attempts per UTC day and 24 Luna interactions per browser session per UTC day. The guest interaction default remains four when `REELBALANCE_GUEST_DAILY_LIMIT` is unset. Public Qloo collection has a separate 120-attempt daily pool and a 12-attempt browser-session daily cap. Optional judge sign-in provides extra reserved pools of 240 OpenAI attempts and 60 Qloo attempts per day, without guest caps. Deliver optional judge credentials privately. Owner administration and provider keys remain private.
- Provider operations remain globally serialised; Qloo attempts require a minimum 60-second gap, failures pause access and nothing retries automatically. The cache retains completed evidence within limits of 8 MiB, 1,200 searches, 600 selections and 1,200 rankings. Public entry admission stops at 1,000 searches, 500 selections and 1,000 rankings, leaving entry capacity for judges and organisers.
- The guest manual and recorded workflows, HTTPS, export and a live Luna interaction passed external checks on 10 October. The 11 October live session verified three fresh rankings, live planning and repair, both approvals, preserved locks and export. On the earlier 12 October judge-access revision, a fresh public browser completed one live Luna interaction using three OpenAI requests, approval, cancellation with two locked nights, explicit approval of the separate 117-minute option and an actual HTML download. Judge sign-in retained the existing programme and locks; authenticated checks verified one fresh artist search, two live Luna interactions using four OpenAI requests, the 110-minute repair with Nights 1 and 3 preserved, support for all three references and export. No new movie rankings were collected during that check.
- The final 12 October public check made two public Qloo requests and six public OpenAI attempts across two Luna interactions. The guest had 22 Luna interactions and 10 Qloo attempts remaining immediately afterward. The separate judge explanation used two reserved OpenAI attempts without changing the public pool or guest quota. Two other public OpenAI attempts were accounted for separately from these verification calls. These are dated observations.
- The earlier four-scenario comparison used different evidence and call budgets between the baseline and ReelBalance arms. It does not isolate Qloo's effect or establish general recommendation superiority.
- The contest requires a functional external demo, public licensed source and a description of the project's features. Judges need free access through the end of judging. [Official rules](https://qloo.devpost.com/rules).
- The [kit submission guide](https://github.com/qloo/qloo-hackathon-kit/blob/main/docs/SUBMISSION.md) and [Qloo developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide) inform setup and provenance documentation. Keep genuine response data and credentials outside the public source package.
- Complete and review the remaining Devpost fields and entrant declarations before submitting. This document records no submission or eligibility certification.
