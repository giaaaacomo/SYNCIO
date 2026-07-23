# SYNCIO

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/giaaaacomo/SYNCIO)
[![CI](https://github.com/giaaaacomo/SYNCIO/actions/workflows/ci.yml/badge.svg)](https://github.com/giaaaacomo/SYNCIO/actions/workflows/ci.yml)

SYNCIO is a self-hosted TypeScript project for deep Stremio <-> Trakt synchronization. Each installation runs in the user's own Cloudflare account and stores its encrypted Stremio credential and sync state in its own D1 database.

> [!IMPORTANT]
> Version 0.2.1 is a technical preview. Start with isolated test accounts and inspect the full read-only preview before activating live synchronization. The default delegated Trakt transport relies on Stremio account behavior that is not a public addon API. Removals are intentionally unsupported.

## Quick Self-Hosted Deploy

1. Open the **Deploy to Cloudflare** button above and authorize Cloudflare to create a personal fork, Worker, and D1 database.
2. In the deployment form, generate two independent random values of at least 32 characters with a password manager:
   - `SYNCIO_ENCRYPTION_KEY` encrypts account credentials stored in D1.
   - `SYNCIO_SETUP_TOKEN` unlocks the configure page and protected sync APIs.
3. Keep both values in the password manager and let Cloudflare deploy. The repository deploy command applies all D1 migrations automatically.
4. Open the Worker URL, enter the setup token, link Stremio, and enable the delegated Trakt transport with the expected Trakt username.
5. Run a read-only preview, install the displayed Stremio manifest, and activate hourly synchronization only after reviewing the exact changes.

The Cloudflare account, fork, Worker, D1 database, secrets, and account tokens belong only to the user. SYNCIO has no maintainer-operated backend. See [the full self-host onboarding guide](docs/SELF_HOST_ONBOARDING.md) for recovery and privacy details.

This repository started with **Milestone 0** research probes that verify undocumented or weakly documented behavior. It now contains a self-hosted Cloudflare Worker with guarded watched reconciliation, rating mapping, additive Library/Watchlist synchronization, D1 state, and hourly scheduling.

Research probes cover:

- Stremio login/auth-key acquisition.
- Stremio `libraryItem` read/write behavior.
- history-only watched items with `removed=true` and `temp=true`.
- movie and episode watched writes.
- Stremio Like/Love get/send behavior.
- Stremio rating enumeration fallback discovery.
- Trakt last activity and pagination behavior.
- a minimal no-catalog Stremio manifest.

## Requirements

The probes use only Node standard APIs at runtime, but this repository compiles TypeScript before running them:

```sh
npm install
npm run probe:stremio:auth
```

In this workspace I used Corepack with pnpm because `npm` was not in PATH:

```sh
corepack pnpm install
corepack pnpm test
corepack pnpm run typecheck
```

## Secrets

Copy `.env.example` to `.env` only locally if useful. The probes load `.env` automatically. Do not commit real account data.

Every probe redacts secrets in its output. Probes that can mutate Stremio require an explicit `--apply` flag and otherwise run as dry-runs.

## Watched Sync

The first guarded sync commands are still conservative and dry-run by default.

Run the full current test sync set:

```sh
corepack pnpm run sync:run
```

This executes watched, ratings, and watchlist planning together using the guarded test filters and local settings from `.syncio/settings.json`. Writes require `--apply`.

Run watched reconciliation directly:

```sh
corepack pnpm run sync:watched -- --movie-ids tt0133093 --show-ids tt0903747,tt3032476
```

It plans both directions unless a direction is supplied:

```sh
corepack pnpm run sync:watched -- --direction trakt-to-stremio --show-ids tt0903747
corepack pnpm run sync:watched -- --direction stremio-to-trakt --show-ids tt3032476
```

Writes require `--apply`. Unfiltered writes are refused unless `--allow-unfiltered-apply` is also passed. Applied operations are stored locally in `.syncio/state.json`, which is ignored by Git.

## Local Research Harness

SYNCIO is addon-first. The current local addon shell can be started with:

```sh
corepack pnpm run addon:dev
```

By default it serves:

- configure page: `http://127.0.0.1:7017/configure`
- manifest: `http://127.0.0.1:7017/manifest.json`
- install URL: `stremio://127.0.0.1:7017/manifest.json`

For local testing, paste the manifest URL into Stremio's add-on repository field. Some desktop builds rewrite `stremio://` shortcut links for localhost and may drop the port.

The production Worker manifest intentionally declares no catalogs or content resources, so installing SYNCIO does not add rows to Stremio's Home or Board. The configure page remains available through the addon's Configure action.

The configure page also has a local Trakt Device OAuth flow:

- `Start Trakt Link` requests a Trakt user code and saves only the device code locally.
- `Complete Link` polls once and saves Trakt access/refresh tokens to `.env` when the user has authorized the code.
- The page and `/status.json` only show redacted readiness states, never token values.

The page also persists local sync settings in `.syncio/settings.json`:

- watched, ratings, and watchlist toggles;
- Trakt rating thresholds for Stremio Like/Love mapping;
- `test` scope for guarded preview/apply;
- `account-preview` scope for broader account previews with apply disabled.

Watched synchronization must preserve existing visible Library membership. A collected movie or series is not removed or hidden just because its watched state changes.

It also exposes guarded previews and test applies for the current test set. `Preview Full Test Sync` and `Apply Full Test Sync` run all current sync cores together. Every action uses explicit filters:

- watched: Matrix, Breaking Bad, Better Call Saul;
- ratings: Matrix;
- watchlist: Interstellar.

The preview/apply paths are intentionally idempotent: when the target side already matches, they report `target-skip` instead of planning a write.

Full sync preview responses include a compact review summary before the raw details: planned totals, watched groups, rating changes, watchlist additions, Library/history-only impact, and safety warnings.

Watched, ratings, and watchlist now use importable core modules directly from the addon. The old probe commands remain as thin CLI wrappers for repeatable research runs.

## Self-Hosted Cloudflare Shell

The self-hosted Worker lives in `src/`. It serves the no-catalog addon manifest, protected configure flow, health/status endpoints, sync APIs, and the guarded hourly scheduler.

```sh
corepack pnpm run worker:typecheck
corepack pnpm run worker:test
```

`wrangler.jsonc` declares a generic automatically provisioned D1 binding, required Worker secrets, and the hourly cron. Migrations live in `migrations/` and the deploy script applies them through the binding before publishing.

The Worker has a small typed D1 adapter in `src/storage/d1.ts`. `/status.json` and `/api/status` report whether the D1 binding is configured and, when reachable, basic table counts.

Production is self-hosted: every user deploys their own Worker/D1. The default transport reuses the Trakt authorization already linked to that user's Stremio account, so it needs neither a new Trakt application nor an additional connected-app slot. Direct OAuth with a user-owned Trakt application remains an optional fallback. There is no shared SYNCIO Trakt app and no hosted-by-us sync service planned.

The Worker engine supports identity-checked previews, fingerprint-confirmed bidirectional watched applies, additive bidirectional Stremio Library/Trakt Watchlist synchronization for IMDb movies and series, and bidirectional movie/series rating mapping. Trakt ratings are authoritative when both services already have a different value; a Stremio Like or Love fills a missing Trakt rating using the configured thresholds. Because Stremio exposes no verified bulk Like/Love listing, SYNCIO checks known Library/history items in bounded rotating batches. The engine also maintains a D1 change ledger, persisted cursors and run status, and an hourly guarded scheduler. Library/Watchlist removals remain intentionally disabled. Runs are limited to 250 deterministic operations and continue converging on later hours when a backlog remains.

Trakt `429` responses preserve the server-provided `Retry-After` delay. The configure page pauses preview retries and shows the remaining cooldown instead of repeatedly calling the API.

Live mode cannot be enabled by changing ordinary settings. Activation requires Preview only mode, the exact current preview fingerprint, the explicit `ENABLE SYNCIO` confirmation, and a successful first apply. Only then is the hourly scheduler armed. Switching back to Preview only clears that activation immediately.

The Worker configure page now supports the self-host onboarding sequence:

- setup routes require a separate `SYNCIO_SETUP_TOKEN` bearer token;
- Stremio can be linked with email/password or an existing auth key; the password is never stored, while the verified auth key is encrypted;
- delegated mode retrieves Stremio's current Trakt access grant for each run, verifies the expected Trakt username, and never persists Trakt access or refresh tokens;
- switching to delegated mode deletes any previously stored direct Trakt OAuth tokens;
- optional direct mode encrypts a user-owned Trakt client id, client secret, access token, and refresh token in D1;
- sync settings default to account preview, with removals disabled.

The relevant protected routes are `GET /api/setup/status`, `GET|PUT /api/setup/settings`, `POST /api/setup/stremio`, `POST /api/setup/trakt-mode`, `POST /api/setup/trakt-app`, `POST /api/setup/trakt/start`, and `POST /api/setup/trakt/poll`.

`GET /api/sync/preview` verifies both linked identities and plans watched, watchlist, and rating differences. Delegated runs fetch a fresh Stremio-held access grant; direct runs refresh their own expiring token. `POST /api/sync/activate` performs the guarded first live apply and arms scheduling. `POST /api/sync/apply` requires an active mode and the exact preview fingerprint. `POST /api/sync/run` invokes the same guarded pipeline used by the hourly cron.

Read [docs/SELF_HOST_ONBOARDING.md](docs/SELF_HOST_ONBOARDING.md) and [docs/CLOUDFLARE_PREDEPLOY.md](docs/CLOUDFLARE_PREDEPLOY.md) before deploying.

## Research Notes

Read [research/README.md](research/README.md) for the original probe execution order and required environment variables.
