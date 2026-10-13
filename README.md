# ReelBalance

Keep the agreed nights. Repair the programme.

ReelBalance helps a small adult film-club organiser build a two- or three-night programme, then replace an unavailable film without disturbing agreed nights. Qloo ranks a curated 20-film pool against three declared music interests. The planner checks the runtime limit, exclusions and locked night positions; Luna explains the proposal, and the organiser approves every change.

The published demonstration follows a concrete repair. Moonrise Kingdom, Whiplash and Frances Ha initially give all three references an original top-five film. With Nights 1 and 3 locked, cancelling Whiplash leaves two of three references supported. Short Term 12 restores the third reference through its original rank five for Anoushka Shankar. Both agreed nights and the 110-minute per-film limit stay in place, and the organiser approves and exports the result.

The external demo and unchanged 1:33 video are linked from Devpost. The video uses genuine hosted-app calls from 11 October 2026: three fresh Qloo movie rankings and two live Luna interactions, using four OpenAI requests. It includes AI narration and disclosed editing, with no saved Luna replay. The full anonymous custom-artist workflow and optional reserved judge access subsequently passed live checks on 12 October.

This repository contains the complete application and invented setup fixtures. Genuine Qloo responses, recorded model replies and credentials remain outside the public source and container image.

## What the app does

- Builds and repairs a programme within a runtime limit, preserving locked films in their approved night positions.
- Shows original top-five support, unknown ranks and support shortfalls. A separate runtime increase needs its own approval.
- Explains **Why this replacement?** using the removed title, preserved choices and original ranking evidence, including why higher-ranked candidates may be unavailable or too long.
- Saves the brief, approved order, locks, exclusions and prepared artist-collection checkpoint in this browser when storage is available. Reload revalidates the current catalogue and cached evidence; pending proposals, assistant replies and authentication are not restored.
- Offers a ready example, explicit custom-artist collection, useful waiting and error states, keyboard focus handling and polite operation-status announcements.
- Exports an approved HTML programme sheet with night order, original ranks, runtime notes and source caveats.

The pool was curated from the original example references' Qloo film suggestions and checked for film identity and runtime. Custom artists rerank that same pool; they do not discover a new catalogue. The three references are declared interests, not member votes or measured audience segments. Top-five support is a planning policy, not an enjoyment probability. Adoption, time savings and attendance have not been measured. Screening availability, rights and exact film-copy runtimes still need organiser confirmation.

All features are public on the competition host. Optional **Judge sign in** adds reserved provider allowance. Completely new artists can require three searches and three rankings, with at least 60 seconds between live requests: about five minutes of waiting gaps, plus processing. Saved matches and rankings can be quicker; the ready example needs no new Qloo collection.

## Run the synthetic sample

Use Node.js 22.19.0 or newer. The manual sample needs no API keys or package installation.

```sh
npm start
```

Open `http://127.0.0.1:4173/`. Build a three-night draft, approve it, lock the first two nights and mark the third film unavailable. Inspect the current-limit repair and the separate runtime alternative, then approve one and export its sheet. The source labels identify all sample titles, interests, runtimes, identities and ranks as invented. Synthetic mode keeps provider features disabled.

```sh
npm test
npm run runtime:rehearse
```

The rehearsal uses a clean copy of the public allowlist and checks the synthetic manual workflow with external requests blocked. It does not read the original project's private evidence or provider ledgers. With Docker available, `npm run docker:verify -- --platform linux/amd64` checks the image offline under its test resource cap. Add `--dataset` and optional `--recording` private paths for genuine provisioning checks; synthetic checks do not verify live providers.

## Verification and limits

On 13 October 2026, all 179 portable tests passed locally and in Node.js 22 Linux under 512 MiB combined memory/swap and 0.5 CPU. The clean-copy rehearsal verified 61 public source and fixture files with external requests blocked. The healthy `reelbalance:programme-review-ux-20261013` deployment retained patched dependencies, private evidence, provider counters, credentials and existing allowances. Hosted desktop, 390×844 mobile and keyboard checks verified saving, safe reload, prepared custom-evidence recovery, replacement explanations, explicit approval and the programme sheet. The actual HTML download matched the canonical renderer. These release checks reused genuine completed Qloo evidence and made no new provider calls.

The [controlled decision audit](docs/decision-audit.md) compares three deterministic policies on the same frozen rankings and constraints, with an exhaustive independent enumerator. Deliberately deleted ranks are reported separately as synthetic faults. The audit checks decision rules; it is not user testing, a generic-LLM comparison or proof that audiences prefer the films.

For dated test/deployment evidence, resource limits, access configuration and safe operator recovery, see the [deployment guide](docs/deployment.md). Follow the [judge walkthrough](docs/judge-demo.md) or use the [submission copy template](docs/submission-draft.md).

A GitHub Actions template is included at `release/.github/workflows/check.yml`. To enable it, copy it to `.github/workflows/check.yml` with an account allowed to publish workflow files. It runs on Node.js 22 without provider credentials; repository automation is not enabled by this template alone.

## How it works

| Component | Source | Responsibility |
| --- | --- | --- |
| Organiser workspace | `app/public/` | Brief, evidence, proposals, approval, safe browser saving and printable export |
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

The full public live workflow passed checks on 12 October; the 13 October improvements are deployed and passed the release checks above. Provide optional judge credentials privately through the submission's testing instructions and preserve free access through judging. Dated checks do not guarantee future hosting or provider availability. `npm run assistant:check -- --origin https://your-app.example` inspects public assistant readiness without a provider call. `npm run operator:status` inspects both private model ledgers; the deployment guide gives the Docker command and reviewed recovery while the app is stopped, preserving consumed attempts.

`public-manifest.json` lists the exported files, byte counts and SHA-256 hashes. Start any public repository from this exported directory with fresh history, after reviewing the manifest. The MIT license covers the code and invented fixtures; Qloo evidence and service access remain subject to their own terms.

## Author and license

Created by [Atikur Rahman](https://github.com/atikur). The application code and invented fixtures are licensed under [MIT](LICENSE). Third-party packages retain their own licenses and notices. Qloo data and API access are not relicensed by this repository.
