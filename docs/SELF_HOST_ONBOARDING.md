# Self-Host Onboarding Shape

SYNCIO is targeting a self-hosted setup, not a hosted-by-us service.

Each user deploys their own Cloudflare Worker + D1 database. By default, SYNCIO reuses the Trakt authorization already linked to the user's Stremio account. The runtime that processes credentials and sync state belongs to the user.

Version 0.3.2 is a public technical beta. Begin with isolated test accounts and inspect the read-only result before connecting accounts that matter.

## Intended User Flow

1. Open the SYNCIO deploy/setup page from the repository.
2. Authorize the Deploy to Cloudflare flow against the user's Cloudflare and Git provider accounts.
3. Choose the Worker, repository, and automatically provisioned D1 names.
4. Open the [SYNCIO secret generator](https://giaaaacomo.github.io/SYNCIO/secret-generator.html), copy its independent `SYNCIO_ENCRYPTION_KEY` and `SYNCIO_SETUP_TOKEN` values into the Worker secret fields, and save both in a password manager. The static generator uses Web Crypto entirely in the browser and makes no network requests.
5. Let Cloudflare clone the repository, apply migrations, and deploy the Worker.
6. Open the `https://...workers.dev` address shown in the completed build output.
7. Select **Add to Stremio**, then choose **Configure** in Stremio's installation window.
8. Unlock setup with the saved `SYNCIO_SETUP_TOKEN`.
9. Link the Stremio account that already has the intended Trakt account connected.
10. Enter the expected Trakt username without the leading `@` and enable `Stremio Delegated`.
11. Run a read-only full-account preview and confirm both account guards.
12. For live scheduling, confirm the exact preview with `ENABLE SYNCIO`; SYNCIO applies that first batch before arming the hourly cron.
13. Return to Stremio and complete the addon installation.

## Find The Worker URL

Cloudflare assigns every deployed Worker an address in this form:

```text
https://<worker-name>.<account-subdomain>.workers.dev
```

The deploy log prints it near the end, directly below `Deployed ... triggers`. Opening this address displays the installation button. Stremio reads the manifest's standard `configurationUrl` field and exposes the SYNCIO setup page through **Configure** in its installation window.

If the deploy log is no longer open:

1. Open the Cloudflare dashboard.
2. Select **Workers & Pages**.
3. Select the SYNCIO Worker.
4. Open **Domains** or **Settings > Domains & Routes**, depending on the dashboard layout.
5. Open the listed `workers.dev` address.

The configure page presents these actions as five ordered steps: Stremio, Trakt, sync settings, preview/activation, and installation. Later steps remain inactive until their prerequisites are ready, while completed account and settings forms collapse into editable summaries. System diagnostics and the Direct OAuth fallback stay collapsed below the main flow.

## Stremio Accounts Created With Facebook

SYNCIO does not embed Facebook Login or ask for a Facebook access token. Stremio does not document a third-party OAuth handoff for addons, and routing a Facebook credential through a self-hosted Worker would widen the credential boundary unnecessarily.

Choose **Facebook** in the Stremio connection step and follow [Stremio's official password setup instructions](https://stremio.zendesk.com/hc/en-us/articles/9877172192786-How-to-use-Facebook-created-account-with-email-and-password). This adds email/password access to the existing Stremio account; Stremio states that Facebook login continues to work. Return to SYNCIO, select **Email**, and connect with that password. Users who already possess a Stremio auth key can continue to use the **Auth Key** option.

Delegated mode reads the current Trakt access grant from Stremio at the beginning of every run. It uses Stremio's public Trakt client identity for Trakt requests, keeps the access token only in memory, ignores the refresh token, and fails closed if the grant is absent, expired, or belongs to another account. An isolated E2E deployment observed Stremio rotate the grant automatically before its July 2026 expiry, so periodic manual reconnection is not expected under the currently observed behavior. Reconnect Trakt inside Stremio only if the health guard reports a missing or expired grant.

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

## Connection Health And Run History

The collapsed **System status** section can verify the current Stremio and Trakt identities on demand. It reports the delegated Trakt grant expiry but never returns the access token. Every delegated and direct sync run repeats the appropriate account guard before reading or writing data.

The same section lists the eight most recent scheduled or manual runs, including status, timestamp, planned operation count, and a bounded error message when a run fails.

The current beta evidence and remaining client checks are tracked in [the beta acceptance audit](BETA_ACCEPTANCE_AUDIT.md).

## Data Lifecycle

The collapsed **Data and privacy** section provides three protected actions:

- **Export data** downloads settings, account identifiers, secret-presence flags, recent runs, the idempotency ledger, cursors, rating snapshots, and conflicts. Credentials and encrypted secret values are deliberately excluded.
- **Disconnect accounts** first returns settings to Preview only, disarming live sync, then deletes stored Stremio/Trakt connection material while preserving settings and run history.
- **Delete all data** requires the exact `DELETE SYNCIO DATA` confirmation and removes every SYNCIO row from the user's D1 database.

These actions affect only SYNCIO's D1 state. They do not delete Stremio or Trakt accounts and do not remove history from either service.
