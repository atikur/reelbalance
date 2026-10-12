# ReelBalance judge walkthrough

Open the demo URL in the Devpost submission, or watch its linked 1:33 video. The public source is available at [atikur/reelbalance](https://github.com/atikur/reelbalance) under MIT.

Updated on 12 October 2026. `reelbalance:public-access-ui-20261012` is deployed and was healthy at verification. The anonymous full public workflow passed live checks on 12 October, including a fresh Joni Mitchell lookup and ranking, live Luna planning and repair, explicit approvals, preserved locks and actual HTML export. Optional judge access used reserved capacity without consuming the public allowance. Desktop and 390×844 mobile checks verified the prominent judge button and popup with no horizontal overflow. Submission has not been confirmed.

## Published live-call demonstration

The video uses the Radiohead, Bill Evans and Anoushka Shankar references, with three fresh Qloo movie-ranking requests and two live Luna interactions using four OpenAI requests. The initial approved programme is Moonrise Kingdom, Whiplash and Frances Ha. Nights 1 and 3 are locked, and Whiplash is marked unavailable for the demo scenario.

The repair replaces Whiplash with Short Term 12, preserves both locked night positions and the 110-minute per-film limit, and restores original top-five support for all three references. The organiser reviews and approves the proposal before downloading the programme sheet.

This is edited real hosted-app footage from 11 October with English AI-generated narration. Waiting time is trimmed, the cancellation is staged, and some initial successful results are shown in same-session pickups after a recorder interruption. It uses no saved Luna replay. The public example can use different ranking evidence, so its exact film choices and repair trade-offs can differ from the video.

## Identify the source mode

| Mode | What it shows | New provider requests |
| --- | --- | --- |
| Saved Qloo evidence | Genuine previously collected artist-to-movie rankings used by planning tools | None for planning, repair or export |
| Live Luna | A new assistant interaction using the current brief, selected Qloo evidence and solver tools | Up to three OpenAI attempts per interaction |
| Public or reserved live Qloo collection | Visitors explicitly look up canonical artists and rank the vetted film pool through a signed browser session; optional judge access adds reserved capacity | At most one Qloo request per explicit search or ranking action |
| Recorded walkthrough | A labelled replay of genuine earlier Luna answers, with proposals checked against the current solver | None |
| Synthetic setup fixture | Invented ranks and example facts for running the public source package | None; this is not Qloo evidence |

Support means that at least one selected film is in a reference's original top five. Filtering never promotes a lower-ranked film into that top five. Missing ranks remain unknown. Support describes the evidence, not a probability of audience enjoyment.

## Public guest workflow

The full public setup needs no login: the app issues a signed browser session for the example, custom artists, live planning, repair, approvals and export. Public allowances are 24 Luna interactions per browser session per UTC day within a pool of 180 OpenAI attempts, and 12 Qloo attempts per browser session per UTC day within a separate public pool of 120 attempts. Each Luna interaction can use up to three OpenAI attempts. This full public path passed live verification on 12 October.

1. Open the demo URL from the Devpost submission in a fresh browser. Start with the example three-night brief and its displayed per-film runtime limit. Inspect the source notes for the selected evidence.
2. Choose **Plan with Luna** for a live assistant proposal, or **Build draft manually** for the local planning tools. Inspect the proposed order, original-rank support and unknown results. Approve the programme.
3. Use **Lock choice** on the first two nights, then **Mark unavailable** on the third film. The cancelled film should be excluded while the locked films retain their night positions.
4. Choose **Repair with Luna**, or **Review programme manually**, under the current brief. Inspect the support result and the separate runtime option, if one is offered. The current brief stays unchanged while an option is pending.
5. Approve either the current-limit repair or the displayed runtime alternative. Inspect the receipt: locked night positions remain, and any limit change is explicit.
6. Choose **Preview programme sheet**, then **Download HTML sheet**. Confirm the approved order, evidence mode, original ranks, runtime notes and limitations are preserved.

For a live repair, send once: “Repair the cancelled night. Preserve my locked choices, keep the current runtime limit first, and explain any alternative.” Live wording can vary; inspect the proposal and applied state. If live access is unavailable, the manual tools remain usable with completed evidence.

## Optional recorded walkthrough

The separate recorded scenario uses genuine preserved answers and is labelled recorded. It does not make new Qloo or OpenAI requests.

1. Choose **Open recorded walkthrough** and inspect the unapproved draft. The app keeps your existing programme while you explore this separate example.
2. Choose **Approve this programme**, then **Stage cancellation · keep Nights 1 & 2**.
3. Compare the current-limit repair and separate runtime option. Inspect the original-rank evidence.
4. Approve a choice, inspect the retained night positions and receipt, then export the sheet.

**Restart walkthrough** returns to the recording's unapproved draft; **Return to my programme** restores your workspace. If a recording is unavailable, the app reports that state.

## Further checks

- Reduce the programme to two nights and inspect any support shortfall.
- Set a runtime below a locked film's duration. The conflict should remain visible, with any higher-limit proposal pending until approval.
- Compare a film's planning runtime with its source note. The export retains any difference from a primary listing.

Screening rights, actual copy availability and exact runtimes need organiser confirmation before a real event.

## Public custom artists

This capability retains the same vetted 20-film pool; it ranks those films for new references rather than discovering a new catalogue. Three genuine artist searches and three fresh movie rankings completed on 11 October. The published video uses the resulting evidence; planning and repair reuse those completed rankings.

1. Open the demo in a fresh browser to receive a signed public session. Custom artist collection is enabled by the host's `REELBALANCE_PUBLIC_CUSTOM=1` setting; no login is required for the full public workflow.
2. Choose **Choose artists**, then **Check availability**. Typing makes no request. Reuse a saved canonical match or explicitly search a public artist name and confirm its entity.
3. Confirm three distinct artists and choose **Prepare film rankings**. Saved rankings are reused. For each pending artist, **Collect rankings for [artist]** makes at most one guarded request. Wait for the displayed next-request time; no request retries automatically.
4. Inspect provenance, scored-film counts and unknown ranks in **Sources & request limits**. When all three are ready, choose **Start programme with these artists**. This starts a fresh workspace and clears previous selections, locks and approvals.
5. Build or repair with the completed evidence, approve a proposal and export its sheet. These actions make no additional Qloo requests.

New responses stay in the private server cache and completed evidence is retained for reuse. The cache is bounded at 8 MiB, 1,200 artist searches, 600 three-artist selections and 1,200 rankings. Public entry admission stops at 1,000 searches, 500 selections and 1,000 rankings, leaving entry capacity for authenticated judges and organisers. At a limit, existing evidence remains available; the app does not silently discard it to make room. Configuration and private provisioning are documented in [deployment.md](deployment.md).

## Optional judge sign-in for extra capacity

The full public workflow does not need a password. If the submission supplies extra judge credentials privately, choose the prominent green **Judge sign in** button. Its popup explains that every feature is already public and login adds reserved capacity. Enter the supplied username and password, then choose **Sign in**. Opening the popup keeps the current programme; successful sign-in opens a 24-hour session. Sign in again after it expires. Judge credentials do not grant owner administration or expose provider keys.

Judges and organisers share extra reserved pools of 240 OpenAI attempts and 60 Qloo attempts per UTC day. Public usage cannot consume those reserved attempts. Authenticated users have no guest Luna or Qloo browser caps. The one global provider-operation guard, minimum 60-second Qloo gap, failure pauses and absence of automatic retries still apply.

The earlier judge login passed external checks on 12 October: it kept the public programme and locks, displayed **Judge workspace** and enabled custom controls. These are dated observations of the earlier judge-access revision.

The final UI's desktop and mobile checks also verified the prominent button and capacity explanation. A live judge explanation used one interaction and two reserved OpenAI attempts, leaving the public pool and guest quota unchanged.

## Verified access and remaining submission steps

The full public backend uses 180 OpenAI attempts per UTC day, 24 Luna interactions per browser session per day, 120 public Qloo attempts per day and 12 Qloo attempts per browser session per day. Optional judges and organisers retain reserved pools of 240 OpenAI attempts and 60 Qloo attempts, without guest caps. Qloo attempts remain at least 60 seconds apart, failures pause provider access and nothing retries automatically. These are application safeguards, not provider quotas or guarantees of availability.

On the earlier 12 October judge-access revision, a fresh public browser completed one live Luna interaction using three OpenAI requests, approval, locks on Nights 1 and 2, cancellation of Night 3, review under the unchanged 110-minute brief, explicit approval of the separate 117-minute option and an actual HTML download. Judge checks passed login and logout, verified the then-required authentication for custom routes, completed one fresh Nina Simone lookup and two live Luna interactions using four OpenAI requests, and preserved Nights 1 and 3 with a 110-minute limit, all three references supported and an exported sheet. The checks reused genuine 11 October rankings, made no new ranking requests, and left the public pool and guest quota unchanged. They do not verify the new anonymous custom workflow.

The final full public check on 12 October used a fresh Joni Mitchell search and ranking plus cached Radiohead and Bill Evans profiles. It made two public Qloo requests and two public Luna interactions using six OpenAI attempts. Explicit planning and repair approvals kept the 110-minute per-film limit, preserved locked Nights 1 and 3, replaced Night 2 and downloaded an HTML sheet matching the local renderer. The checked guest session had 22 of 24 Luna interactions and 10 of 12 Qloo attempts remaining. Public calls left reserved pools unchanged; the separate judge explanation left public and guest allowances unchanged. No provider retries occurred.

The published video is unchanged. Final UI and full live public checks are complete; submission has not been confirmed. Optional judge credentials can be delivered privately for extra capacity. Preserve free access through the end of judging; the dated checks do not guarantee future hosting or provider availability. [Official access rules](https://qloo.devpost.com/rules).
