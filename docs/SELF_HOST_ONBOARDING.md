# Self-Host Onboarding Shape

SYNCIO is targeting a self-hosted setup, not a hosted-by-us service.

Each user deploys their own Cloudflare Worker + D1 database and creates their own Trakt application. SYNCIO code guides the setup, but the runtime that processes tokens and sync state belongs to the user.

Version 0.1.1 is a technical preview. Begin with isolated test accounts and inspect the read-only result before connecting accounts that matter.

## Intended User Flow

1. Open the SYNCIO deploy/setup page from the repository.
2. Authorize the Deploy to Cloudflare flow against the user's Cloudflare and Git provider accounts.
3. Choose the Worker, repository, and automatically provisioned D1 names.
4. Generate independent random `SYNCIO_ENCRYPTION_KEY` and `SYNCIO_SETUP_TOKEN` values of at least 32 characters with a password manager and enter both as Worker secrets.
5. Let Cloudflare clone the repository, apply migrations, and deploy the Worker.
6. Open the deployed `/configure` page.
7. Create a Trakt application at `https://trakt.tv/oauth/applications/new`. The legacy application-list URL may return `404` in the current Trakt UI.
8. Paste the Trakt app client id and client secret.
9. Link Trakt with Device OAuth.
10. Link Stremio.
11. Run a read-only full-account preview.
12. For live scheduling, confirm the exact preview with `ENABLE SYNCIO`; SYNCIO applies that first batch before arming the hourly cron.
13. Install the generated manifest in Stremio.

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
- encrypted Trakt OAuth tokens;
- encrypted Trakt app credentials when needed;
- sync settings;
- sync run metadata and dedupe ledger.

The user's Trakt account controls API authorization, and the user's Cloudflare account controls runtime/storage. There is no shared production Trakt app.

## One-Click Target

The realistic target is not literally zero clicks because Cloudflare and Trakt both require user-owned authorization. The target is guided one-click per external action:

- one deploy button for repository cloning, D1 provisioning, migrations, and Worker creation;
- two independent password-manager values entered directly into the user's Cloudflare deployment;
- one Trakt app creation link with copyable callback/redirect values;
- one encrypted Trakt app credential save;
- one Device OAuth approval;
- one Stremio addon install link.

Every setup page must show redacted readiness only, never raw tokens.

The setup token is kept in browser `sessionStorage`, is sent only as a bearer header to the user's own Worker, and is never written to D1. Closing the browser tab clears that browser session. The encryption key never enters the browser.
