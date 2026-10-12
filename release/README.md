# ReelBalance

Keep a film season together when plans change.

ReelBalance helps a film-club organiser choose a two- or three-night programme, preserve locked nights after a cancellation, and inspect an optional runtime change before approving it. Qloo supplies cross-domain taste evidence from three declared music interests; a deterministic planner enforces the brief, and a bounded AI assistant explains proposals. Every programme change needs the organiser's approval.

The external demo and optional 1:33 video are linked from the Devpost submission. The app uses genuine privately cached Qloo evidence, live Luna interactions and an optional labelled recorded walkthrough. On 11 October 2026, the hosted organiser workflow collected three fresh Qloo movie rankings and completed two live Luna interactions using four OpenAI requests. Its approved repair preserved Nights 1 and 3, kept the 110-minute per-film limit and restored original top-five support for all three references before export. The video shows that session with AI narration and disclosed editing; it uses no saved Luna replay. The current `reelbalance:public-access-ui-20261012` image is deployed and was healthy at verification. The full anonymous public workflow and optional reserved judge access passed live checks on 12 October.

This repository contains the complete application source and invented setup fixtures. Genuine Qloo responses, recorded model replies and credentials stay outside the public source and container image.

## What the app does

- Builds a season from a vetted 20-film shortlist, within the chosen runtime limit.
- Preserves locked films in their approved night positions when another film becomes unavailable.
- Shows which declared tastes have original top-five ranking support, including missing evidence and support shortfalls.
- Keeps a proposed runtime increase separate until explicitly approved.
- Exports an HTML programme sheet with the approved order, evidence mode and source notes.

Ranking support describes the evidence, not a probability of enjoyment. Film-copy runtimes, availability and screening rights need organiser confirmation.

The synthetic sample is for running and testing the code. Its film titles, music references, runtimes, IDs and ordinal ranks are invented. It demonstrates the manual planner and approval flow; it does not demonstrate Taste AI accuracy or qualify as the genuine competition demo.

## Run the synthetic sample

Use Node.js 22.19.0 or newer. The manual sample needs no API keys or package installation.

```sh
npm start
```

Open `http://127.0.0.1:4173/`. Propose a three-night programme, approve it, lock the first two nights, and mark the third title unavailable. Review the current-limit repair and the separate runtime alternative before approving either option. The source labels and programme sheet identify the evidence as synthetic.

Run the portable tests and the clean-copy rehearsal:

```sh
npm test
npm run runtime:rehearse
```

The rehearsal copies only the public source allowlist into a temporary directory and checks the manual planning, cancellation, approval and export flow with external requests blocked. It does not read the original project's private assets or usage ledgers.

With Docker available, `npm run docker:verify -- --platform linux/amd64` builds and checks the image under a 256 MiB memory cap with external requests blocked. Add `--dataset` and optional `--recording` private paths to check genuine provisioning. The default synthetic check does not verify genuine evidence or live providers.

On 10 October 2026, all 57 portable tests passed locally and in the Node.js 22 Linux image. On 11 October, the UI review passed 80 portable tests locally and in Linux, plus a clean-copy rehearsal of 52 manifest files, including the UI regression suite and Qloo security patch. The initial AMD64 and ARM64 images passed the synthetic and genuine private recorded workflows under a 256 MiB memory/swap cap and 0.5 CPU, with no provider requests. Three artist searches and three fresh movie rankings completed through organiser access on 11 October. The 12 October judge-access revision passed 102 tests locally and in offline Linux checks under the original 256 MiB cap and 0.5 CPU. Its `reelbalance:judge-access-20261012` deployment retained existing private evidence and provider counters and made no provider requests before the subsequent headroom revision replaced it.

Public guest manual and recorded workflows, export and one live assistant interaction passed external checks on 10 October. The 12 October fresh public-browser check completed one live Luna interaction using three OpenAI requests, approval, cancellation with Nights 1 and 2 locked, explicit approval of the separate 117-minute option and an HTML download. Signed-in judge checks completed one fresh Qloo artist lookup and two live Luna interactions using four OpenAI requests, reusing genuine 11 October rankings without new ranking requests. The judge repair preserved Nights 1 and 3 and the 110-minute limit, supported all three references and exported its sheet. Judge checks left the public model pool and guest quota unchanged. The login dialog kept the existing public programme and locks and exposed the judge workspace without the guest message cap.

A 12 October resource review found the original app container healthy, with no OOM or restarts. An isolated offline check of the judge-access image under 256 MiB and 0.5 CPU completed 200 mixed synthetic HTTP requests plus two setup requests at concurrency 10, with zero errors or provider requests, approximately 162 ms p95 and a 43.71 MiB memory peak including its Node.js load client. This does not measure live provider or Qloo subprocess peaks, or guarantee future capacity. The healthy `reelbalance:server-headroom-20261012` deployment raises the memory and combined memory/swap cap to 512 MiB, retains 0.5 CPU and extends the Qloo browser deadline from 35 to 45 seconds around the existing 40-second server CLI limit. Fourteen offline Linux UI tests passed before that deployment under the original caps. Private evidence, provider ledgers, daily allowances, active-operation guards and the 60-second Qloo gap are preserved. See the [resource review](docs/deployment.md#resource-review).

The full public backend was deployed healthy at 17:12:26 UTC on 12 October, retaining the prior eight private state files, genuine evidence and provider counts under 512 MiB and 0.5 CPU. It passed 139 offline Linux tests; a separate rollback compatibility revision passed 54 tests. That compatibility image supports the version-3 browser ledger and expanded cache. Roll back only to a reviewed compatible image such as `reelbalance:public-access-rollback-20261012`; older unpatched access decoders or cache limits cannot safely read the new state. Keep the current evidence and consumed counters during any rollback. The subsequent live verification is recorded below.

The final UI image was deployed healthy at 17:27:27 UTC after 25 offline Linux UI tests under 512 MiB combined memory/swap and 0.5 CPU. It preserved the existing runtime, environment, private state and provider counts, with no deployment provider calls. Desktop and 390×844 mobile checks verified the prominent green **Judge sign in** button and popup explaining that all features are public and login adds reserved capacity, with the current programme kept.

The full public live check completed at 17:28:23 UTC: one fresh Joni Mitchell search and one fresh movie ranking used two public Qloo requests, while Radiohead and Bill Evans rankings were reused from genuine cache. Two live public Luna interactions used six OpenAI attempts for planning and repair. Explicit approvals kept the 110-minute per-film limit, preserved Nights 1 and 3, replaced Night 2 and exported an HTML sheet matching the local renderer. Public activity left reserved pools unchanged. A separate judge explanation used two reserved OpenAI attempts and left the public pool and guest quota unchanged. The checked public session had 22 of 24 Luna interactions and 10 of 12 Qloo attempts remaining. No provider retries occurred. Two other public OpenAI attempts were accounted for separately from these verification calls.

A GitHub Actions template is included at `release/.github/workflows/check.yml`. To enable automated checks, copy it to `.github/workflows/check.yml` using an account or token allowed to publish workflow files. It runs these commands on Node.js 22 without provider credentials. Automated repository checks are currently pending.

## How it works

| Component | Source | Responsibility |
| --- | --- | --- |
| Organiser workspace | `app/public/` | Brief, evidence, proposals, approval and printable export |
| Deterministic planner | `app/programme-service.mjs`, `scripts/reelbalance-solver.mjs` | Runtime limits, exclusions, preserved locks and ranking support |
| Agent loop | `app/agent-service.mjs` | Bounded model calls and evidence-bound planning tools |
| Taste collection | `app/taste-service.mjs`, `app/qloo-runtime.mjs` | Explicit canonical artist lookup, private ranking cache and guarded Qloo calls |
| Public access | `app/public-access.mjs` | Signed browser sessions, public workflow allowances, optional extra judge capacity and separate owner administration |

There are no background model requests. Manual planning, repair and export use the selected dataset without new Qloo requests. Live model and Qloo failures pause their respective guards without automatic retries.

## Use your own private evidence

Supply your own 20-film dataset in the shape shown by `release/synthetic-data.json`, with genuine canonical film IDs, verified film facts and original Qloo ordinal ranks. Keep `dataset.synthetic` absent or false only for genuine evidence. The provisioning command validates the file's structure and provenance fields; the source owner is responsible for the authenticity of the API evidence and film facts.

To construct genuine evidence privately:

1. Resolve canonical Qloo IDs for 20 movies and three distinct music artists. Verify each film's year, runtime, eligibility and source notes.
2. Request one independent movie ranking for each artist against the same frozen film pool. The guarded adapter uses `filter.type=urn:entity:movie`, `signal.interests.entities` for the artist ID, `filter.results.entities` for the 20 movie IDs and `take=20`.
3. Store returned movie order as that profile's original ordinal ranks. Omit movies that were not returned; their rank stays unknown. Filtering a film out later must never renumber the remaining ranks.
4. Record genuine source, endpoint, checked-at timestamp, requested count and runtime policy in the dataset. Follow the fixture's schema and populate its source fields honestly; invented evidence must remain labelled synthetic.
5. Keep all responses and the assembled dataset outside source control, then provision the dataset with the command below. Apply the request spacing and failure-pause policy described in the live setup section.

```sh
npm run provision:private -- --dataset /absolute/path/to/your/dataset.json
```

An optional recording must match that dataset and the application's validated recording schema:

```sh
npm run provision:private -- --dataset /absolute/path/to/your/dataset.json --recording /absolute/path/to/your/recording.json
```

Sanitized copies and a runtime configuration are written with private permissions inside ignored `.cache/private-runtime/`. Restart `npm start` to use them. `REELBALANCE_DATASET_PATH` and `REELBALANCE_RECORDING_PATH` explicitly override those paths. Never commit genuine Qloo evidence, recordings, credentials, or the private cache to the public source repository.

For genuine private evidence, the OpenAI key setup uses a hidden prompt:

```sh
npm run setup:openai
```

The key stays in ignored `.env.local`. The agent uses the fixed `gpt-6-luna` model and requires organiser approval before applying a proposal. Synthetic mode keeps the model, recording and artist-retrieval paths disabled.

For your own live Qloo access, install the pinned official harness and apply the two reviewed security patches. Pi's published shrinkwrap overrides ordinary root overrides, so this post-install step must run after every `npm ci`. It retains harness 0.1.26 and Pi 0.84.2, replacing only Undici with 8.10.2 and brace-expansion with 5.0.12. Docker builds perform the same step automatically.

```sh
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm ci --prefix scripts/qloo-security --ignore-scripts --no-audit --no-fund
node scripts/patch-qloo-dependencies.mjs . scripts/qloo-security
```

Create the harness's private `~/.qloo/config` without a connectivity probe. This hidden-input recipe requires Python 3 and a terminal; it refuses to overwrite an existing config. Reuse an existing private config only after reviewing its endpoint and access terms.

```sh
python3 - <<'PY'
import getpass, json, os
from pathlib import Path
path = Path.home() / ".qloo" / "config"
path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
if path.parent.is_symlink() or path.exists():
    raise SystemExit("Review the existing private Qloo configuration first.")
os.chmod(path.parent, 0o700)
key = getpass.getpass("Qloo API key (hidden): ").strip()
if not key or any(character in key for character in "\r\n\0"):
    raise SystemExit("A nonempty, single-line key is required.")
with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
    json.dump({"api_key": key, "base_url": "https://hackathon.api.qloo.com",
               "trusted_base_url": "https://hackathon.api.qloo.com"}, output)
    output.write("\n")
print("Private Qloo config saved; no network request was made.")
PY
```

The official setup command probes `GET /`, which the application's endpoint guard rejects. Saving the JSON config establishes configuration presence; the first deliberate artist lookup verifies actual access and consumes one guarded attempt. Keep the key out of source control, logs and recordings. Enable `REELBALANCE_QLOO_LIVE=1` only after checking the patched installed versions and using your genuine private catalogue. `REELBALANCE_PUBLIC_CUSTOM=1` enables custom collection for anonymous visitors with a signed browser session. Every artist search and ranking still requires an explicit action. The host separates public Qloo collection at 120 attempts per UTC day (`REELBALANCE_PUBLIC_QLOO_DAILY_LIMIT`) from 60 reserved attempts for judges and organisers (`REELBALANCE_QLOO_DAILY_LIMIT`). Public browser sessions receive 12 Qloo attempts per UTC day through `REELBALANCE_GUEST_QLOO_DAILY_LIMIT`. Attempts remain at least 60 seconds apart, errors pause collection and nothing retries automatically. Stop for operator review after a failure. These are application limits, not Qloo's published quota. Use the [Qloo developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide) for your access terms.

The private taste cache is bounded at 8 MiB, 1,200 artist searches, 600 three-artist selections and 1,200 rankings. Public entry admission stops at 1,000 searches, 500 selections and 1,000 rankings, leaving entry capacity for authenticated judges and organisers. Completed evidence is retained and reused; reaching a limit blocks new entries rather than silently deleting existing evidence.

The checked-in root lock retains the official dependency tree, so its audit still reports the original findings. The local patch keeps that lock unchanged. Docker opts into updated audit metadata inside the image; verify its actual installed versions and audit before enabling live collection.

## Prepare a genuine judged host

A competition host needs genuine private Qloo evidence and the working model integration. The public source package intentionally keeps that evidence out of the repository and container image. Mount or provision your own private assets and supply credentials on the server.

Local startup remains on loopback. Public hosting requires `HOST=0.0.0.0`, `REELBALANCE_ACCESS_MODE=public` and one exact HTTPS `APP_ORIGIN`. The full public host also enables `REELBALANCE_PUBLIC_CUSTOM=1`. Anonymous visitors receive a signed browser session and can choose artists, collect rankings, plan, repair, approve and export without a login. Keep owner administration and provider keys private. Optional dedicated judge credentials provide extra reserved capacity; configure them through `REELBALANCE_JUDGE_USERNAME` and `REELBALANCE_JUDGE_PASSWORD`, separately from the owner token. Follow the [deployment instructions](docs/deployment.md), [judge demo](docs/judge-demo.md) and [submission template](docs/submission-draft.md). A successful local rehearsal does not verify a Docker build or public deployment.

The deployed public model pool is 180 OpenAI attempts per UTC day through `REELBALANCE_OPENAI_DAILY_LIMIT` (1–360, default 36). Each browser session receives 24 Luna interactions per UTC day through `REELBALANCE_GUEST_DAILY_LIMIT`; its default remains four for existing deployments. New guest sessions share a durable 32-per-minute issuance limit; unused sessions can be reclaimed without discarding used guest quotas.

**Judge sign in** provides optional extra capacity through a dedicated username/password login with a 24-hour session. Authenticated judges and organisers use separate reserved pools of 240 OpenAI attempts (`REELBALANCE_OPENAI_JUDGE_DAILY_LIMIT`) and 60 Qloo attempts (`REELBALANCE_QLOO_DAILY_LIMIT`) per UTC day. They have no guest interaction or Qloo browser cap. Public usage cannot consume reserved attempts. Each Luna interaction can use up to three OpenAI attempts. The single global provider-operation guard, Qloo spacing, provider failure pauses and lack of automatic retries remain in place.

The full public UI and live workflow passed checks on 12 October. Provide optional judge credentials privately through the submission's testing instructions and preserve free access through judging. Dated checks do not guarantee future hosting or provider availability. `npm run assistant:check -- --origin https://your-app.example` inspects public assistant readiness without a provider call. `npm run operator:status` inspects both private model ledgers; the deployment guide gives the Docker command and reviewed recovery while the app is stopped, preserving consumed attempts.

`public-manifest.json` lists the exported files, byte counts and SHA-256 hashes. Start any public repository from this exported directory with fresh history, after reviewing the manifest. The MIT license covers the code and invented fixtures; Qloo evidence and service access remain subject to their own terms.

## Author and license

Created by [Atikur Rahman](https://github.com/atikur). The application code and invented fixtures are licensed under [MIT](LICENSE). Third-party packages retain their own licenses and notices. Qloo data and API access are not relicensed by this repository.
