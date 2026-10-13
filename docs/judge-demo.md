# ReelBalance judge walkthrough

Use the demo and unchanged 1:33 video linked in the Devpost submission. The public source is [atikur/reelbalance](https://github.com/atikur/reelbalance), licensed under MIT. Every feature is public; optional judge sign-in adds reserved allowance.

Updated on 13 October 2026. The healthy `reelbalance:programme-review-ux-20261013` release passed 179 local and offline Linux tests at 512 MiB and 0.5 CPU, a 61-file clean-copy rehearsal, and hosted desktop, mobile, keyboard, cached custom-evidence restoration, repair and export checks. The actual HTML download matched the canonical renderer. These checks used genuine existing evidence without new provider calls. The full anonymous live workflow and judge reserve also passed live checks on 12 October. Submission has not been confirmed.

## The published repair

The video uses Radiohead, Bill Evans and Anoushka Shankar as declared music references. Qloo ranked a fixed 20-film pool for each. Moonrise Kingdom, Whiplash and Frances Ha initially give all three references an original top-five film.

Nights 1 and 3 are locked; Whiplash is marked unavailable for the demonstration. Support drops from 3/3 to 2/3. Luna proposes Short Term 12, whose original Anoushka Shankar rank is five. It keeps both locked night positions and the 110-minute per-film limit. The organiser reviews and explicitly approves the repair, restoring 3/3 support, then downloads the programme sheet.

This is real hosted-app footage from 11 October: three fresh Qloo movie rankings and two live Luna interactions using four OpenAI attempts, with no saved Luna replay. The cancellation is staged, waiting is trimmed and some successful initial results appear in same-session pickups after a recorder interruption. Narration is AI-generated. The video remains accurate; the newer saving and explanation features supplement its workflow.

## Try the ready example

1. Open the demo from Devpost in a fresh browser. Start with the supplied music references, three nights and the displayed per-film cap. The example's completed Qloo evidence is genuine; its exact choices may differ from the video.
2. Choose **Plan with Luna** for a live proposal, or **Build draft manually** for deterministic planning. Inspect the proposed night order, original ranks and any support shortfall. Approve the programme.
3. Lock two nights, then mark the remaining film unavailable. The approved choices stay in place while a repair is pending.
4. Inspect **Why this replacement?**: removed and added films, kept nights, lost/restored support and higher-ranked candidates that are excluded or over the cap. The explanation is calculated from the same original ranks, without another provider request.
5. Choose **Repair with Luna** or **Review programme manually** if another review is needed. Compare the current-limit option with any separate runtime alternative. Neither the limit nor the selection changes until its approval button is used.
6. Approve one option, inspect its receipt and choose **Preview programme sheet → Download HTML sheet**. Confirm night order, original ranks, runtime notes and source caveats.

For a live repair, send once: “Repair the cancelled night. Preserve my locked choices, keep the current runtime limit first, and explain any alternative.” Live wording can vary; the proposal and applied state establish the decision.

## Check browser recovery

After approval, set locks or mark a film unavailable, wait for **Programme saved in this browser**, then reload. The brief, approved order, locks, exclusions, name and note are saved when browser storage is available. An unresolved cancellation remains **Needs a review**; a pending proposal or assistant answer is not restored and no paid request is replayed.

Reload verifies the current catalogue and, for custom references, reads the completed evidence from the server cache. It cannot substitute stale or unverified rankings. If verification fails, the saved version is retained with **Retry saved workspace** and **Start fresh** actions. A prepared artist collection can also resume from its server-held progress without automatically collecting another ranking.

Browser saving is a local convenience, not an account or cloud backup. Private browsing, blocked storage or cleared site data can remove it. The app reports storage failure and detects a competing tab's saved version. **Reset example / Start fresh** deliberately clears the saved workspace. Recorded walkthroughs stay separate from it.

## Choose custom artists

The film pool was curated from the original example references' Qloo suggestions and checked for identity and runtime. Custom artists rerank these same 20 films rather than discover new titles. The three references are declared interests, not member votes or measured audience segments.

1. Choose **Choose artists**. The panel explains that completely new references can take three searches and three rankings, with at least 60 seconds between live calls: about five minutes of waiting gaps, plus processing. Saved matches and rankings can be quicker.
2. Type an artist, explicitly search and choose a canonical match. Typing makes no provider request. Confirm three distinct artists.
3. Choose **Prepare film rankings**. Existing rankings are reused. For each pending artist, explicitly choose **Collect rankings for [artist]** and wait for the displayed next-request time. Nothing retries automatically.
4. Inspect the scored-film counts and **Sources & request limits**. Close the panel to continue planning with the current evidence while waiting. Meaningful search/ranking starts, results, errors and readiness changes have polite status announcements; the countdown is not announced every second.
5. When all three profiles are complete, choose **Start programme with these artists**. This is an explicit fresh-programme action: previous selections, locks and approvals are cleared. The completed evidence and prepared collection remain available for reuse.
6. Plan, repair, approve and export with these profiles. No additional Qloo retrieval is needed for those decisions.

## Understand the evidence

| Mode | Source | New provider use |
| --- | --- | --- |
| Ready example | Genuine previously collected Qloo rankings | No new Qloo collection |
| Live Luna | A new assistant response using the brief, chosen evidence and planning tools | Up to three OpenAI attempts per interaction |
| Custom artist collection | Explicit canonical search and ranking of the fixed film pool | At most one Qloo request per search/ranking action |
| Recorded walkthrough | Clearly labelled earlier Luna replies | No new provider requests |
| Synthetic setup | Invented titles, references, facts and ranks | Provider features disabled |

A reference is supported when at least one usable selected film lies in its **original top five**. Filters never promote a lower-ranked film into that top five. Missing ranks stay unknown. Support does not predict enjoyment, fairness to actual members or attendance. Film-copy availability, screening rights and exact runtimes need organiser confirmation.

The [controlled decision audit](decision-audit.md) compares deterministic policies on the same frozen input and constraints, checks feasible choices independently and reports deliberate missing-rank faults separately. It establishes decision-rule behavior within this pool; it is not an audience study or a generic-LLM comparison.

## Optional judge allowance

Choose the prominent green **Judge sign in** button and enter the credentials supplied privately in Devpost. The popup explains that all features are already public and login adds reserved capacity. Sign-in keeps the current programme and lasts 24 hours. Credentials do not grant owner administration or expose provider keys.

| Access | Luna | Qloo |
| --- | --- | --- |
| Public | 24 interactions per browser session/day within 180 OpenAI attempts/day | 12 attempts per browser session/day within 120 public attempts/day |
| Judges and organisers | 240 reserved OpenAI attempts/day, without the guest interaction cap | 60 reserved attempts/day, without the guest browser cap |

Daily limits use UTC. Public calls cannot consume reserved attempts. One provider operation runs at a time; Qloo calls remain at least 60 seconds apart. Failures pause access and requests never retry automatically. These are application safeguards, not provider quotas or a guarantee of future availability. Cache limits, provisioning and operator recovery are in the [deployment guide](deployment.md).

## Verification status

The 12 October full public check used a fresh Joni Mitchell search and ranking plus cached Radiohead and Bill Evans profiles. Two Qloo calls and two live Luna interactions using six OpenAI attempts completed explicit planning/repair approvals, preserved Nights 1 and 3, kept the 110-minute cap and produced a matching HTML export. A separate judge explanation used only reserved capacity. These dated checks establish technical behavior, not organiser adoption or audience outcomes.

The 13 October tests, deployment and hosted checks are complete. Keep the demo and optional judge access freely available through judging. [Official rules](https://qloo.devpost.com/rules)
