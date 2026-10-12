# ReelBalance deployment and publication

Updated on 12 October 2026. Use the demo and optional 1:33 video URLs in the Devpost submission; this public guide omits those links. Public source is available at [atikur/reelbalance](https://github.com/atikur/reelbalance), with genuine runtime evidence provisioned privately. The current `reelbalance:public-access-ui-20261012` image is deployed and was healthy at verification. Its full anonymous public workflow and optional reserved judge access passed live checks on 12 October. The earlier judge-access checks, initial guest verification on 10 October and fresh Qloo rankings on 11 October remain dated historical evidence. Submission has not been confirmed.

## Verified full public deployment

Enable `REELBALANCE_PUBLIC_CUSTOM=1` to offer the complete workflow to anonymous visitors with signed browser sessions: canonical artist search, fixed-pool Qloo ranking collection, Luna planning, repair, explicit approval and export. Owner administration and provider credentials remain private. Optional judge sign-in adds reserved capacity rather than unlocking a separate feature set.

The base backend was deployed healthy at 17:12:26 UTC on 12 October after 139 offline Linux tests passed. It retained the previous eight private state files, genuine evidence and provider counters under 512 MiB and 0.5 CPU. A separate rollback compatibility revision passed 54 tests. The final UI image was deployed healthy at 17:27:27 UTC after 25 offline Linux UI tests under 512 MiB combined memory/swap and 0.5 CPU. Runtime patches, credentials, environment, private state, cache, prior counters and other containers were retained. Deployment made no provider calls.

Desktop and 390×844 mobile checks verified no horizontal overflow, a prominent green **Judge sign in** button and a popup explaining that all features are public and login adds extra reserved allowance. Opening the popup kept the current programme.

Full public live verification completed at 17:28:23 UTC. A fresh Joni Mitchell artist search and movie ranking made two public Qloo requests; Radiohead and Bill Evans profiles were reused from genuine cache. Two public Luna interactions for planning and repair used six OpenAI attempts. Both current-brief approvals were explicit, the 110-minute per-film limit stayed unchanged, Nights 1 and 3 stayed locked in place, Night 2 was replaced and the actual HTML export matched the local renderer. Public activity consumed no reserved attempts.

A separate optional judge explanation completed with two reserved OpenAI attempts and left the public pool and guest quota unchanged. The public session went from 24 to 22 Luna interactions remaining and from 12 to 10 Qloo attempts remaining. No provider retries occurred. Two other public OpenAI attempts occurred before the final verification completed and are accounted for separately from its six public attempts. At completion, total counters were 11 public OpenAI attempts, six reserved OpenAI attempts, two public Qloo attempts and one legacy reserved Qloo attempt; these are dated snapshots, not future-availability promises.

| Setting | Deployed configuration verified on 12 October |
| --- | --- |
| Current image | `reelbalance:public-access-ui-20261012`; healthy at deployment and live-workflow verification |
| Earlier base image | `reelbalance:public-access-20261012`; backend and state-preservation checks passed before UI amendment |
| Resource limits | 512 MiB memory and combined memory/swap; 0.5 CPU |
| Public Luna | 180 OpenAI attempts per UTC day; 24 interactions per browser session per UTC day |
| Public Qloo | Separate pool of 120 attempts per UTC day; 12 attempts per browser session per UTC day |
| Extra judge/organiser capacity | Reserved pools of 240 OpenAI attempts and 60 Qloo attempts per UTC day; no guest browser caps |
| Private taste cache | 8 MiB, 1,200 searches, 600 three-artist selections and 1,200 rankings; existing evidence retained |
| Public cache admission | 1,000 searches, 500 selections and 1,000 rankings, leaving entry capacity for authenticated users |

Provider operations remain globally serialised. Qloo attempts remain at least 60 seconds apart, provider failures pause access and nothing retries automatically. Increasing allowances preserves existing provider counts and does not establish provider availability. The anonymous custom workflow and reserved-pool isolation passed the dated live checks above.

## Verified judge-access deployment

The judge-access source revision passed 102 tests locally and in Linux on 12 October. The Linux run used the original 256 MiB memory/swap cap, 0.5 CPU and disabled networking, with the reviewed test files mounted read-only. Tests and secrets remain excluded from the production image. Its earlier `reelbalance:judge-access-20261012` deployment retained seven existing private state files, evidence and provider counters and made no provider requests. The subsequent headroom adjustment is documented below; the 102-test result belongs to this judge-access revision.

| Access setting | Earlier judge-access configuration verified on 12 October |
| --- | --- |
| Public core workflow | Genuine saved example, manual planning, recorded walkthrough and export without sign-in |
| Public live Luna | Four interactions per browser session per UTC day; separate public pool of 36 OpenAI attempts per UTC day |
| Judge sign-in | Dedicated username/password login; signed 24-hour session; private testing credentials |
| Reserved live Luna | Judges and organisers share 240 OpenAI attempts per UTC day, isolated from public usage; no guest four-interaction cap for authenticated judges |
| Authenticated Qloo collection | Shared 60-attempt UTC-day guard; at least 60 seconds between attempts; pauses on failure; no automatic retries |
| Private taste cache | At most 2 MiB, 240 searches, 120 three-artist selections and 240 rankings; completed evidence retained |

The Qloo allowance is configurable from 1 to 120 and defaults to 12; 60 is the deployed judge-host setting. Each Luna interaction uses at most three OpenAI attempts. These limits control application usage and do not guarantee provider availability. Supply judge credentials privately in submission testing instructions. Never supply the owner's private token or provider keys to judges.

Fresh external checks verified judge API login and logout, anonymous custom-route protection and the login dialog. Judge sign-in retained the public programme and locks, displayed the judge workspace and enabled custom artist controls without the guest four-interaction cap. Judges received custom testing access without owner authority.

The earlier judge-access public-browser check completed one live Luna interaction using three OpenAI requests, approval, locks on Nights 1 and 2, cancellation of Night 3, review under the unchanged 110-minute brief, explicit approval of the separate 117-minute option and an actual HTML download. Judge checks completed one fresh Nina Simone lookup and two live Luna interactions using four OpenAI requests. That custom workflow reused genuine 11 October rankings without new movie-ranking requests. Its repair preserved Nights 1 and 3, retained the 110-minute limit, supported all three references and exported its sheet. Judge checks left the public model pool and guest quota unchanged.

The final read-only server check on 12 October found the container healthy, with no OOM or unfinished model locks. The public pool had 33 of 36 attempts remaining, the reserved pool had 236 of 240, and Qloo had used one of 60 attempts without a pause. These are dated test-completion snapshots, not promises of later availability. Total live verification used one fresh Qloo search and seven OpenAI requests: three public and four judge requests.

## Earlier headroom deployment

The existing Caddy proxy routes the exact HTTPS origin to one ReelBalance container on the shared `web` network. The app publishes no host port. The new site configuration passed validation and was loaded without changing the existing site files.

| Item | Headroom deployment verified on 12 October 2026 |
| --- | --- |
| Image | Patched Linux AMD64 image `reelbalance:server-headroom-20261012`; container healthy at deployment verification |
| Resource limits | 512 MiB memory and combined memory/swap; 0.5 CPU |
| Private runtime | Validated 20-film dataset, three profiles and two recorded scenarios |
| State | Persistent private directory mounted at `/app/.cache` |
| OpenAI | One fresh public interaction and two judge interactions verified on 12 October; judge interactions used four OpenAI requests with `gpt-6-luna` |
| Model allowances | Separate UTC-day pools: 36 public attempts; 240 reserved attempts for judges and organisers |
| Live Qloo collection | Enabled for explicit authenticated actions (`REELBALANCE_QLOO_LIVE=1`); 60 attempts per UTC day; fresh judge artist lookup verified on 12 October |
| Private Qloo config | Mounted read-only at `/home/node/.qloo/config`, readable by the app user; hackathon endpoint configured |
| External access | Fresh public-browser and signed-in judge workflows, login dialog, allowance isolation, approvals, repair and export verified on the earlier judge-access image on 12 October |

## Resource review

The droplet has one vCPU and approximately 1.92 GiB of RAM. The original 256 MiB app container was healthy, with a sampled 26.36 MiB memory reading, no OOM and no restarts. These sampled observations do not establish the maximum resource requirement.

An isolated offline load check used `reelbalance:judge-access-20261012` under the original 256 MiB memory and combined memory/swap cap and 0.5 CPU, with networking disabled and no private mounts. It completed 200 mixed synthetic HTTP requests plus two setup requests at concurrency 10, with zero errors or provider requests. The measured p95 was approximately 162 ms and the container memory peak was 43.71 MiB, including the Node.js load client. The container remained healthy and the temporary container was removed. This short synthetic check does not measure live provider or Qloo subprocess peaks, or establish future capacity.

`reelbalance:server-headroom-20261012` was deployed at 07:29:06 UTC on 12 October and was healthy at verification. It raises the app's memory and combined memory/swap cap to 512 MiB while retaining 0.5 CPU. Its sole application change raises the Qloo browser deadline from 35 to 45 seconds, allowing the existing 40-second server CLI deadline to finish. Fourteen offline Linux UI tests passed before deployment under the original 256 MiB cap and 0.5 CPU. This is a separate check from the earlier 102-test judge-access suite.

The headroom deployment preserved private evidence and provider ledgers, with access-ledger changes allowed for guest sessions. The environment and other container identities were unchanged, and the app had no unfinished model locks, OOM or restarts at verification. Provider daily allowances, active-operation guards, the 60-second Qloo gap and failure pauses remain unchanged; no retries are added.

Post-deployment HTTPS checks verified the genuine bootstrap, exact updated frontend, public manual planning and approval, approved HTML export, authentication protection for custom collection and public Luna readiness. Floorline and Postgres remained healthy and Caddy remained running; all four containers reported no OOM or restarts. The public, reserved and Qloo counters remained at three, four and one attempts respectively. Resource verification and deployment made no provider calls. These are dated checks, with no new live provider interaction after this patch.

One live provider action runs globally at a time, across public guests and authenticated judges, so simultaneous live actions may return a busy response. This guard also covers custom Qloo searches and rankings. Manual planning, app browsing and export remain available while a live action is in progress. Additional memory does not change that intentional concurrency guard.

Deployment files live under `/opt/reelbalance`; run the Docker Compose operator commands from that directory. The state directory is owned by UID/GID 1000 with mode `0700`, and the environment file is root-owned with mode `0600`. The HTTPS site sends `Strict-Transport-Security: max-age=15552000` for this hostname, without a subdomain or preload directive.

## Earlier hosted verification

The `reelbalance:ui-polished-20261011` image was the healthy hosted deployment used for the 11 October live-call demonstration before the judge-access revision replaced it. Earlier fresh-browser checks approved a manual draft, locked two nights, cancelled the third, explicitly approved the separate 117-minute repair option and verified the exported sheet. The recorded check approved its draft, staged cancellation, accepted the 110-minute repair with its disclosed support shortfall and verified the recorded label in the exported sheet. HTTP guest checks passed both repair branches, blocked access to 11 private paths and required owner authentication; provider counters were unchanged before the live test.

The one deliberate live guest interaction returned an unapproved three-night proposal with a 110-minute per-film limit and support for all three declared profiles. The UI identified the answer as live and required explicit approval. Immediately after that test on 10 October, the session had three of four interactions remaining and the shared ledger had 34 of 36 attempts remaining. These are test-completion snapshots, not current availability promises. Existing Floorline and Postgres containers remained healthy, Caddy remained running and no OOM was reported during the checks.

The 11 October live-call session used the Radiohead, Bill Evans and Anoushka Shankar references. The approved repair replaced Whiplash with Short Term 12, retained Moonrise Kingdom and Frances Ha in Nights 1 and 3, kept the 110-minute per-film limit and restored original top-five support for all three references. The organiser approved the repair and downloaded its sheet. Three fresh Qloo ranking requests and four OpenAI requests across two live Luna interactions were verified, with no saved Luna replay or provider retries for footage.

The container health check establishes cached app availability. Monitor assistant readiness separately; one successful live interaction does not establish sufficient allowance or continuous availability for judge testing.

## Prepare a clean source package

The original private project contained Qloo response data. Its initial public release used a reviewed fresh-history package. This restored public checkout contains source and designated synthetic fixtures; keep any recovered genuine evidence outside source control. The developer guide permits private server-side caching and prohibits Qloo response data in public repositories. [Qloo developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide).

From the private workspace:

```sh
npm run public:export
npm run runtime:rehearse
```

The export is written to ignored `.cache/public-source-export`. It includes an explicit source allowlist, a visibly fictional synthetic fixture and a SHA-256 file manifest. It excludes existing Git history, credentials, API responses, recordings, private caches and research results. The export command refuses an existing destination; choose a new empty output directory for another export. The rehearsal builds its own temporary export and verifies its manifest and manual workflow. Neither command publishes or makes a provider request.

The initial public repository was created from a reviewed export with fresh history. For later releases, review the exported files and manifest before updating the public source. Keep `LICENSE`; GitHub has verified MIT detection for the published repository. The exported README describes its standalone setup; the synthetic example provides a reproducible workflow without disclosing real response assets.

## Run the exported package

Use Node.js 22.19 or newer. In the exported directory:

```sh
npm ci
npm test
npm run runtime:rehearse
npm start
```

The clean checkout uses `release/synthetic-data.json`: 20 invented films and three fictional profiles. Labels identify it as synthetic. Manual planning, approval, cancellation and export are available. Agent calls, Qloo retrieval and genuine recordings remain disabled in synthetic mode even if keys exist. This setup fixture is not the competition's Qloo demonstration.

The passed runtime rehearsal is an offline check, not evidence that a public host or Docker image works. Repeat it after changing the release files and inspect the new result; an older manifest does not verify a changed package.

## Provision genuine runtime evidence privately

The competition host needs the genuine saved Qloo evidence, with provenance and source metadata. Keep these files outside the public repository and build context. In a trusted copy of the exported package:

```sh
npm run provision:private -- --dataset /absolute/private/demo.json
```

To include the genuine optional recording:

```sh
npm run provision:private -- --dataset /absolute/private/demo.json --recording /absolute/private/recorded-demo.json
```

This validates and sanitises the supplied files, then writes `dataset.json`, optional `recording.json` and `runtime.json` under ignored `.cache/private-runtime/`. No APIs are called. The next `npm start` selects the provisioned configuration. A recording is optional; its absence must remain visible rather than being filled by an invented model answer.

For a read-only private mount instead, set `REELBALANCE_DATASET_PATH` and optional `REELBALANCE_RECORDING_PATH` to the mounted files. An explicit dataset path takes precedence over the provisioned configuration. Do not use a public response-data repository to supply these assets.

## Configure a public host

Run one instance behind HTTPS with Node.js 22.19 or newer. Set the host's assigned `PORT`, `HOST=0.0.0.0` and the exact HTTPS `APP_ORIGIN`, including scheme and host but no path. A wildcard is not accepted. This listening host selects public access mode; public mode requires the configured origin. Forwarded headers never establish organiser identity.

Persist the package's writable `.cache` directory across restarts. It holds provider-attempt ledgers, the signed-session state and private taste caches; the Qloo guard expects the package-root `.cache` path. Stateless replicas cannot enforce these file-based guards together. Keep a single app instance unless the guard is replaced by genuinely shared storage and coordination.

The genuine cached example and manual planning are freely accessible without an owner credential. With `REELBALANCE_PUBLIC_CUSTOM=1`, visitors with a signed browser session can also choose artists, collect rankings and use the full planning, approval and export workflow without a login. This full public workflow passed live verification on 12 October. Enable live Luna through a private server-side `OPENAI_API_KEY` supplied by the host's secret settings. Never put a key in a build argument, image, frontend, public repository or judge instructions. The local hidden-prompt helper is `npm run setup:openai`; credential-present status does not verify provider availability.

Public guest access uses a Secure, HttpOnly, SameSite=Strict cookie, issued by `GET /api/access/status`, valid for 24 hours. New sessions share a durable limit of 32 issuances per 60 seconds; throttling returns HTTP 429 with `Retry-After`. Valid existing sessions and authenticated judge or owner access bypass issuance throttling. If the 256-record pool is full, only the oldest unused session can be reclaimed; used records and their attempt counts are preserved. Legacy ledgers migrate without resetting quotas.

For the full public host, set `REELBALANCE_OPENAI_DAILY_LIMIT=180` and `REELBALANCE_GUEST_DAILY_LIMIT=24`. The model-pool setting accepts 1–360 and defaults to 36; the guest interaction setting defaults to four for compatibility with earlier deployments. Public sessions share the 180-attempt pool and each browser session receives 24 Luna interactions per UTC day. Judges and organisers retain a separate 240-attempt reserved pool through `REELBALANCE_OPENAI_JUDGE_DAILY_LIMIT` (default 240), without guest caps. Public usage cannot consume reserved attempts. Each interaction uses at most three provider attempts. A single global provider-operation guard serialises live operations; lowering daily settings preserves consumed counts. A signed guest session does not establish visitor identity, so the shared public pool bounds overall usage.

Configure public Qloo collection with `REELBALANCE_PUBLIC_QLOO_DAILY_LIMIT=120` and `REELBALANCE_GUEST_QLOO_DAILY_LIMIT=12`. Keep the legacy reserved Qloo pool at `REELBALANCE_QLOO_DAILY_LIMIT=60` for judges and organisers. Pool settings accept 1–120 and default to 12 when unset. Authenticated judges and organisers bypass the guest Qloo cap, while public attempts cannot spend the reserved pool. All Qloo attempts share a minimum 60-second gap and the global operation and failure guards.

Configure optional dedicated judge credentials privately through `REELBALANCE_JUDGE_USERNAME` and `REELBALANCE_JUDGE_PASSWORD`. The password must represent at least 32 random bytes encoded as hex or base64 and must differ from `REELBALANCE_OWNER_TOKEN`. The **Judge sign in** dialog issues a signed 24-hour Secure, HttpOnly, SameSite=Strict cookie. It provides extra reserved model and Qloo capacity without owner authority or provider secrets. The full public feature set needs no judge login. Owner administration keeps separate bearer-token or one-hour session authentication. Do not publish either password or owner token in URLs, source, screenshots or logs; deliver optional judge credentials privately with the submission.

Provider authentication, rate-limit, server, network and timeout failures pause model access for both pools. Restarts do not clear the pause, and there are no automatic retries. If a pause cannot be persisted, the existing interaction lock is retained to keep requests blocked. Operators must review saved pauses and stale locks after errors before resuming; nothing clears them automatically. Cached manual planning and the genuine recorded workflow remain usable when live access is unavailable.

### Monitor and recover the assistant

Container health checks `/api/bootstrap`, which establishes cached app availability. Monitor assistant readiness separately:

```sh
npm run assistant:check -- --origin https://your-app.example
npm run operator:status
```

The assistant check reads only public `/api/agent-status` and exits nonzero for paused, exhausted, unconfigured or synthetic access, or locks requiring operator review. An in-progress interaction in the app process is healthy; unfinished durable locks are unhealthy. This distinction requires the documented single-app deployment. The operator status reports both public and reserved ledgers; a public check does not establish remaining judge allowance. Neither command makes a provider request or proves that credentials work. In Docker, inspect the mounted state with `docker compose run --rm --no-deps app node scripts/provider-admin.mjs status`.

After a provider failure, review its saved reason, provider account and logs first. Correct the cause, stop every app process, and privately back up the state directory before recovery. With the app stopped, run:

```sh
docker compose stop app
docker compose run --rm --no-deps app node scripts/provider-admin.mjs status
docker compose run --rm --no-deps app node scripts/provider-admin.mjs recover-openai \
  --confirm-app-stopped \
  --reviewed-reason "Provider account reviewed and the reported cause corrected"
docker compose up -d app
```

Use a reason describing the actual correction, without credentials or personal information. If status reports stale OpenAI locks, confirm no app or operator process is using them, then explicitly add `--clear-stale-locks` to recovery. Recovery removes saved model pauses and reviewed stale OpenAI locks, retains both ledgers' exact days and attempt counts, and saves a private review record. Only a subsequent deliberate interaction sends a model request. Running app processes retain their in-memory pause, so restart them after recovery. No Qloo pause, guest quota or daily counter is reset.

An interrupted operator recovery may leave `openai-usage.json.admin.lock`. Status reports it and both the app and recovery fail closed. With every app and operator process stopped and state backed up, inspect the audit and ledger before removing that one stale administration lock; rerun status and the reviewed recovery command. Do not delete the ledger or whole cache to resume access.

### Verify the image locally

The revised interface on 11 October passed 80 portable tests locally and a 52-file clean-copy rehearsal, with no external API requests. The same suite passed in the Linux AMD64 image under the then-deployed 256 MiB cap and 0.5 CPU. The updated hosted interface passed a live Luna proposal, explicit approval, retained locks, the separate 117-minute repair, HTML download and recorded-replay workspace restoration. The deliberate live check used three OpenAI attempts and no new Qloo retrieval. Deployment retained all existing private state byte for byte and made no provider calls. The later live-call demo session on 11 October verified three fresh Qloo movie rankings.

On 10 October 2026, all 57 portable tests passed on the local Node.js runtime and inside the Node.js 22 Linux image with networking disabled. The clean-copy rehearsal verified 48 exported files, launcher startup, approval, cancellation and export with zero external requests. After restoring the private assets, both image variants passed synthetic and private provisioning workflows, recorded replay, private-route checks, non-root execution and health check at 256 MiB memory/swap and 0.5 CPU. The final private-workflow readings were:

| Platform tested | Observed final Docker memory | Health / OOM |
| --- | --- | --- |
| Linux AMD64, emulated on ARM64 | 183.5 MiB | Healthy / no OOM |
| Linux ARM64, native | 24.44 MiB | Healthy / no OOM |

These are sampled memory readings, not maximum-load guarantees. Startup now runs one Node process, and the health probe uses the built-in HTTP client to avoid loading the heavier fetch stack. The verifier rejected synthetic private provisioning, accepted the supplied 20-film/three-profile private dataset and its matching two-scenario recording, and found no provider-attempt files. Independent state checks verified recorded draft approval, cancellation, preserved locks, both repair branches and recorded export labels. Private files remain ignored, untracked and owner-only; a fresh public export contained no genuine film IDs or private assets. Stored hashes establish correspondence, not independent proof of the historical provider calls. The initial AMD64 image passed the external guest and live checks on 10 October; its patched replacement is described below. Local reports are kept privately under ignored `.cache/docker-verification-amd64-private.json` and `.cache/docker-verification-arm64-private.json`.

Build and verify the Linux image without credentials:

```sh
npm run docker:verify -- --platform linux/amd64
```

The verifier uses a temporary container and state volume, a non-root app user, a 256 MiB memory/swap cap and half a CPU. It checks the manual cancellation/approval/export workflow, private-file isolation, health and memory use while blocking external fetches. Temporary resources are removed; the image and ignored `.cache/docker-verification.json` report remain. Select the actual server architecture before deployment. Local emulation establishes functional behaviour, not droplet throughput.

When the genuine private assets are available, repeat with their private paths:

```sh
npm run docker:verify -- --platform linux/amd64 \
  --dataset /absolute/private/demo.json \
  --recording /absolute/private/recorded-demo.json
```

This tests private provisioning without supplying provider credentials or sending live requests. Authenticity remains the evidence owner's responsibility. A synthetic-only result leaves genuine provisioning and live provider verification outstanding.

## Protect custom collection

Set a private, high-entropy `REELBALANCE_OWNER_TOKEN` of at least 32 bytes for owner administration. Owner routes accept the bearer token or a signed one-hour HttpOnly cookie issued by `POST /api/access/owner` with a JSON `token` field. Keep the token out of URLs, screenshots, logs and judge instructions. The full public custom workflow uses a signed browser session when `REELBALANCE_PUBLIC_CUSTOM=1`; it does not grant owner administration. Optional judge credentials remain separate and provide extra reserved capacity. Origin checks and forwarded headers do not establish any user role.

Enable explicit live artist actions with `REELBALANCE_QLOO_LIVE=1` and full public custom access with `REELBALANCE_PUBLIC_CUSTOM=1`. The official harness reads its private `HOME/.qloo/config`; the runtime intentionally does not forward `QLOO_API_KEY` or `QLOO_HOME`. Use an individually attributable event key. Configuration presence alone does not establish provider access; the first guarded hosted artist lookup succeeded on 11 October, verifying actual access. Three fresh Qloo movie rankings completed in the later live-call session that day. A judge-authenticated artist lookup succeeded on the earlier 12 October revision. The final public revision then verified an anonymous Joni Mitchell lookup and fresh movie ranking, with two other genuine cached artist profiles reused for planning. [Kit API access policy](https://github.com/qloo/qloo-hackathon-kit/blob/main/docs/API_ACCESS.md).

The checked-in official dependency tree retains the four original audit findings (two high, two moderate), including Undici 8.9.0 and brace-expansion 5.0.9. Docker now installs the locked security-leaf package and runs `scripts/patch-qloo-dependencies.mjs` after `npm ci`, replacing only those two leaves with Undici 8.10.2 and brace-expansion 5.0.12. Harness 0.1.26, Pi 0.84.2 and the other installed packages remain unchanged. This is a locally patched tree; the published dependency's shrinkwrap makes root overrides alone ineffective. [npm override documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides).

For a local CLI installation, repeat the post-install patch after every `npm ci`:

```sh
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm ci --prefix scripts/qloo-security --ignore-scripts --no-audit --no-fund
node scripts/patch-qloo-dependencies.mjs . scripts/qloo-security
```

The helper preserves the source root lock by default. Docker uses `--update-audit-metadata` to align the image's audit lock with its installed files. The isolated preparation and Linux AMD64 image `reelbalance:qloo-security-20261011` passed actual module-resolution checks, offline official API CLI help and an installed-tree audit with zero findings. The Linux check used Node.js 22.23.3, a 256 MiB memory/swap cap and half a CPU; the synthetic app bootstrapped successfully with provider access disabled, and no OOM occurred. This image initially replaced the hosted app on 11 October through the private backup deployment procedure, and the container was healthy at verification. The later `reelbalance:ui-polished-20261011` deployment retained these security patches. Live Qloo was enabled for organiser actions, with the private read-only config readable and its base URL set to `https://hackathon.api.qloo.com`. After deployment, one deliberately guarded artist lookup through the hosted owner interface returned canonical matches, verifying actual credential/provider access. That successful request moved the guard from 12 to 11 remaining attempts without a failure; this is a test-completion snapshot, not current availability. Three fresh Qloo movie rankings also completed in the later live-call demo session that day. The unpatched source lock's audit continues to describe the original pinned tree.

Provision a private JSON config without a connectivity probe:

```json
{
  "api_key": "<hidden credential input>",
  "base_url": "https://hackathon.api.qloo.com",
  "trusted_base_url": "https://hackathon.api.qloo.com"
}
```

The [README hidden-input recipe](../README.md#use-your-own-private-evidence) creates this with mode 600. For the Docker `node` user, use a mode-700 private parent directory, ownership UID/GID 1000, and mount only the config read-only at `/home/node/.qloo/config`. Do not copy it into the image or include it in logs or recordings. The official `setup --qloo` probes `GET /`, which the application's guard rejects; saving the config makes no network request and does not validate the key. The first deliberate artist lookup verifies actual access. Supply OpenAI credentials only to the server environment. The runtime pins the Qloo endpoint and trust to `https://hackathon.api.qloo.com`.

Each explicit search or ranking makes at most one request. The public and reserved guards count attempts before sending: the public pool allows 120 per UTC day with a 12-attempt browser cap, and the reserved judge/organiser pool allows 60 without guest caps. A minimum 60-second gap and global provider-operation guard apply across pools. Failures pause access, with no automatic retry. If pause persistence fails, the Qloo guard or runtime retains its lock; operator review is required. These are project safeguards, not published provider quotas. Planning, repair, assistant tools and export reuse completed evidence without further Qloo calls. New responses stay in the private cache.

The expanded private taste cache permits at most 8 MiB, 1,200 artist searches, 600 three-artist selections and 1,200 rankings. Public entry admission stops at 1,000 searches, 500 selections and 1,000 rankings, leaving entry capacity for authenticated judges and organisers. Completed evidence is retained, with saved searches and rankings reused before new retrieval. Reaching a cache limit blocks new entries rather than discarding earlier evidence. Existing private state and provider-attempt counts must be preserved when deploying or rolling back an image.

## Verify delivery before submission

The demo URL supplied in Devpost passed external HTTPS, fresh guest manual and recorded workflows, export, private-route protection and one deliberate live assistant interaction on 10 October 2026. The 11 October live-call evidence remains valid for that dated session. The earlier judge-access image passed Linux checks and public example and authenticated workflows on 12 October. The final public UI revision passed desktop/mobile checks and the full live anonymous custom workflow, including fresh Qloo collection, live Luna, explicit approvals, preserved locks, repair, export and reserved-pool isolation. Repeat relevant checks after material changes. A live check must be deliberate; stop for operator review on failure rather than retrying. Use the [judge walkthrough](judge-demo.md) and describe recorded, cached, live and synthetic modes accurately.

The initial deployment has a consistent private backup of state, imports and configuration, plus a verified private copy off the server. The app was stopped for that backup and restarted successfully; the two consumed OpenAI attempts remained in the ledger, with no pause or stale locks. Recurring backups and monitoring have not been configured. Existing database backups do not include this application's filesystem state. For a consistent state backup or reviewed recovery, stop all app processes first. When rolling back an image, keep the current state and usage ledgers; restoring older counters could reset consumed allowances. Use the reviewed `reelbalance:public-access-rollback-20261012` compatibility image, which passed 54 tests and supports version-3 browser counters and the expanded 8 MiB cache. Do not revert to an older unpatched access decoder or cache limits: those images cannot safely read the updated state. An initial hosting rollback stops only ReelBalance and restores or removes only its Caddy site, followed by validation and reload of the existing proxy.

The event requires an externally published functional demo, public licensed source and an English description, with free judge testing through 16 November 2026 at 11:45 p.m. EST. The deadline is 30 October 2026 at 11:45 p.m. EDT, or 31 October at 9:45 a.m. in Dhaka. Maintain the public and reserved live allowances and hosted testing access through judging; protective limits alone do not establish eligibility. [Official overview](https://qloo.devpost.com/), [official rules](https://qloo.devpost.com/rules).

Use the Devpost submission for the actual demo and video URLs; the public [submission template](submission-draft.md) omits them. The public repository and MIT license are recorded in the template. Final UI and full live public verification are complete; submission has not been confirmed. Optional extra judge credentials can be delivered privately. Preserve hosting and free testing access through judging; the dated verification does not guarantee future provider or host availability.
