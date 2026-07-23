# Self-Host Onboarding Shape

SYNCIO is targeting a self-hosted setup, not a hosted-by-us service.

Each user deploys their own Cloudflare Worker + D1 database. By default, SYNCIO reuses the Trakt authorization already linked to the user's Stremio account. The runtime that processes credentials and sync state belongs to the user.

Version 0.2.1 is a technical preview. Begin with isolated test accounts and inspect the read-only result before connecting accounts that matter.

## Intended User Flow

1. Open the SYNCIO deploy/setup page from the repository.
2. Authorize the Deploy to Cloudflare flow against the user's Cloudflare and Git provider accounts.
3. Choose the Worker, repository, and automatically provisioned D1 names.
4. Generate independent random `SYNCIO_ENCRYPTION_KEY` and `SYNCIO_SETUP_TOKEN` values of at least 32 characters with a password manager and enter both as Worker secrets.
5. Let Cloudflare clone the repository, apply migrations, and deploy the Worker.
6. Open the deployed `/configure` page.
7. Link the Stremio account that already has the intended Trakt account connected.
8. Enter the expected Trakt username and enable `Stremio Delegated`.
9. Run a read-only full-account preview and confirm both account guards.
10. For live scheduling, confirm the exact preview with `ENABLE SYNCIO`; SYNCIO applies that first batch before arming the hourly cron.
11. Install the generated manifest in Stremio.

Delegated mode reads the current Trakt access grant from Stremio at the beginning of every run. It uses Stremio's public Trakt client identity for Trakt requests, keeps the access token only in memory, ignores the refresh token, and fails closed if the grant is absent, expired, or belongs to another account. Reconnect Trakt inside Stremio if that guard reports an expired grant.

Direct OAuth remains available under the collapsed **Advanced options** section as an optional fallback. It requires a user-owned Trakt application, consumes a Trakt connected-app slot, and stores its encrypted OAuth tokens in D1. The same section contains direct-app readiness so the default status view stays focused on the delegated path.

Less common sync controls, including optional catalogs and the internal account scope, are grouped under **Advanced sync settings**. New installs can leave them closed and use the preview-to-live activation flow.

Each run applies at most 250 deterministic differences. Larger first imports converge over later hourly runs. Returning the mode to Preview only disarms live scheduling immediately. History removals remain disabled.

## Setup Token

`SYNCIO_SETUP_TOKEN` is the administrative password for the configure, preview, activation, and manual sync APIs. It is separate from the encryption key and from the Stremio and Trakt credentials.

Cloudflare secrets cannot be read after they are saved. If the setup token is lost, replace it rather than trying to recover it:

1. Open the `syncio` Worker in the Cloudflare dashboard.
2. Open **Settings**, then **Variables and Secrets**.
3. Edit `SYNCIO_SETUP_TOKEN` and enter a new long random value.
4. Deploy the secret change and use the new value on `/configure`.

With Wrangler, generate and replace it with:

```sh
openssl rand -base64 48
wrangler secret put SYNCIO_SETUP_TOKEN
```

Store the new value in a password manager. Replacing it invalidates setup access in existing browser sessions but does not modify D1 data or linked account credentials.

## Privacy Boundary

With this model, SYNCIO maintainers do not receive, store, or process user tokens on infrastructure controlled by us.

The user's own Cloudflare project stores:

- encrypted Stremio auth material;
- sync settings;
- sync run metadata and dedupe ledger.

Delegated mode does not store Trakt OAuth access or refresh tokens. Optional direct mode stores encrypted Trakt OAuth tokens and app credentials. The user's Trakt account controls API authorization, and the user's Cloudflare account controls runtime/storage. There is no shared SYNCIO Trakt app.

## One-Click Target

The realistic target is not literally zero clicks because Cloudflare and Stremio require user-owned authorization. The target is guided one-click per external action:

- one deploy button for repository cloning, D1 provisioning, migrations, and Worker creation;
- two independent password-manager values entered directly into the user's Cloudflare deployment;
- one Stremio account link;
- one expected-Trakt-account confirmation;
- one Stremio addon install link.

Every setup page must show redacted readiness only, never raw tokens.

The setup token is kept in browser `sessionStorage`, is sent only as a bearer header to the user's own Worker, and is never written to D1. Closing the browser tab clears that browser session. The encryption key never enters the browser.
