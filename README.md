# SYNCIO

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/giaaaacomo/SYNCIO)
[![CI](https://github.com/giaaaacomo/SYNCIO/actions/workflows/ci.yml/badge.svg)](https://github.com/giaaaacomo/SYNCIO/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/giaaaacomo/SYNCIO?include_prereleases)](https://github.com/giaaaacomo/SYNCIO/releases)

SYNCIO keeps Stremio and Trakt account state aligned. It runs in your own Cloudflare account: there is no shared SYNCIO server and the maintainer never receives your credentials or viewing data.

> [!IMPORTANT]
> SYNCIO 0.3.2 is a public technical beta. Review the read-only preview before enabling live sync. Stremio account integration uses behavior outside the public Addon SDK and may change upstream.

## What It Syncs

- watched movies in both directions;
- watched episodes as native per-episode Stremio state;
- Stremio Library additions and Trakt Watchlist additions in both directions;
- movie and series ratings using configurable Like/Love thresholds;
- hourly reconciliation with account guards, idempotency, and rating conflict detection.

SYNCIO never propagates removals in this beta. A completed show remains in the Stremio Library so future episodes can continue to appear in Calendar.

## Before You Start

You need:

- a Cloudflare account and a GitHub or GitLab account;
- a Stremio account with the intended Trakt account already connected;
- a password manager or another safe place for two generated secrets.

Using isolated test accounts for the first deployment is recommended. If you use an established account, inspect the complete preview before activation.

## Deploy

1. Select **Deploy to Cloudflare** above.
2. Give Cloudflare access to the new SYNCIO repository it creates in your Git account.
3. Create a new D1 database in the deployment form.
4. Open the [SYNCIO secret generator](https://giaaaacomo.github.io/SYNCIO/secret-generator.html), then generate and save two different random values:
   - `SYNCIO_ENCRYPTION_KEY` encrypts credentials stored in your D1 database.
   - `SYNCIO_SETUP_TOKEN` unlocks your private configure page.
   The generator runs entirely in your browser and makes no network requests.
5. Keep the default build command `pnpm run build` and deploy command `pnpm run deploy`.
6. Select **Deploy**, then open the `https://...workers.dev` address shown when the build finishes.
7. Select **Add to Stremio**, then choose **Configure** in Stremio's installation window.

If you already closed the build result, open **Workers & Pages** in the Cloudflare dashboard, select your SYNCIO Worker, and open its `workers.dev` address under **Domains** (or **Settings > Domains & Routes**).

Cloudflare provisions the Worker and D1 database, applies all migrations, and creates a personal Git repository for future updates.

## Configure

The configure page guides you through five steps:

1. connect Stremio;
2. confirm the Trakt username already linked inside Stremio;
3. choose watched, rating, and Library/Watchlist settings;
4. run a read-only preview and activate hourly sync;
5. install the generated manifest in Stremio.

The default delegated Trakt mode reuses Stremio's existing authorization. It does not create another Trakt application, consume another connected-app slot, or persist Trakt access/refresh tokens in D1.

For a Stremio account created with Facebook, choose **Facebook** in the first configuration step. SYNCIO links to Stremio's official password setup procedure; adding a password does not disable Facebook login. SYNCIO never requests or processes Facebook credentials or tokens.

Read the [full self-host onboarding guide](docs/SELF_HOST_ONBOARDING.md) for token recovery, updating, privacy export, disconnect, and deletion.

## Privacy And Security

Your Cloudflare account owns the Worker, D1 database, secrets, and runtime. SYNCIO stores:

- an encrypted Stremio auth key;
- sync settings, cursors, snapshots, run metadata, and an idempotency ledger;
- encrypted Trakt credentials only when the optional Direct OAuth fallback is used.

The setup token stays in browser session storage and is not stored in D1. Passwords are used only to obtain and verify a Stremio auth key. Privacy exports omit credentials and ciphertext.

See [SECURITY.md](SECURITY.md) for private vulnerability reporting and the [beta acceptance audit](docs/BETA_ACCEPTANCE_AUDIT.md) for tested behavior.

## Beta Limits

- Android TV has not yet been included in client acceptance testing.
- Removals and strict mirroring are disabled.
- Sync runs hourly and process at most 250 differences per run.
- Stremio Like/Love enumeration is limited, so SYNCIO scans known items in bounded batches.
- Metadata/search availability belongs to other Stremio addons; SYNCIO exposes no catalog or metadata rows.
- Self-hosted instances do not update automatically unless their Cloudflare Git integration deploys repository changes.

## Development

```sh
corepack pnpm install
corepack pnpm run deploy:check
corepack pnpm run worker:typecheck
corepack pnpm run worker:test
corepack pnpm run typecheck
corepack pnpm test
corepack pnpm exec wrangler deploy --dry-run
```

The production Worker is in `src/`, D1 migrations are in `migrations/`, and the original integration probes are retained under `research/`.

See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), and the architecture decisions in [`docs/adr`](docs/adr).

## Support

Questions and reproducible bugs are welcome in [GitHub Issues](https://github.com/giaaaacomo/SYNCIO/issues).

If SYNCIO is useful to you, you can support development through [GitHub Sponsors](https://github.com/sponsors/giaaaacomo), [Ko-fi](https://ko-fi.com/giaaaacomo), or [PayPal](https://www.paypal.com/paypalme/giaaaacomo).

SYNCIO is available under the [MIT License](LICENSE).
