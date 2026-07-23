# Cloudflare Deployment Notes

SYNCIO has been validated on a staging Cloudflare Worker and is being prepared as a reusable self-host template.

## Already Prepared

- Worker entrypoint: `src/worker.ts`
- Worker manifest helper: `src/manifest.ts`
- D1 storage adapter: `src/storage/d1.ts`
- D1 repositories: `src/storage/repositories/users.ts`, `src/storage/repositories/connections.ts`
- AES-GCM secret helper: `src/crypto/secrets.ts`
- Migrations: `migrations/0001_initial.sql` through `migrations/0004_trakt_auth_mode.sql`
- Generic Wrangler config: `wrangler.jsonc`
- Worker checks:

```sh
corepack pnpm run worker:typecheck
corepack pnpm run worker:test
```

- Wrangler 4.113.0 generic dry-run bundle verified with an ID-free D1 binding.

## Routes Available In The Worker Shell

- `GET /manifest.json`
- `GET /configure`
- `GET /healthz`
- `GET /status.json`
- `GET /api/status`
- `GET /api/setup/status`
- `GET /api/setup/settings`
- `PUT /api/setup/settings`
- `POST /api/setup/trakt-app`
- `POST /api/setup/trakt/start`
- `POST /api/setup/trakt/poll`
- `POST /api/setup/trakt-mode`
- `POST /api/setup/stremio`
- `GET /api/sync/preview` runs an authenticated, read-only account baseline for watched history, Library/Watchlist, and movie/series rating differences.
- `POST /api/sync/apply` applies only an exact fingerprint in Test or activated Live mode.
- `POST /api/sync/activate` requires Preview only mode, `ENABLE SYNCIO`, the exact fingerprint, and a successful first apply before arming Live mode.
- `POST /api/sync/run` invokes the guarded pipeline used by the hourly cron.
- `GET /api/setup/health` verifies the live account guards without returning credentials.
- `GET /api/setup/export` returns a credential-free privacy export.
- `POST /api/setup/disconnect` disarms live sync before removing account connections.
- `DELETE /api/setup/data` requires an explicit confirmation and deletes all installation rows.

The setup routes use the self-host installation id internally, require `Authorization: Bearer <SYNCIO_SETUP_TOKEN>`, and return only redacted readiness states. Authenticating values and the temporary Trakt device code are encrypted before D1 persistence.

## Deploy Button Flow

Cloudflare can clone the public repository, provision D1 from the ID-free binding in `wrangler.jsonc`, and deploy the Worker. The repository's deploy script applies migrations by binding name.

The user still supplies two independent secrets during deployment. The default `/configure` path reuses the Trakt authorization already linked in Stremio and does not require a new Trakt app. SYNCIO never receives those values on maintainer-controlled infrastructure.

The Deploy to Cloudflare form reads `.dev.vars.example` and the required-secret declarations from `wrangler.jsonc`, then asks for exactly `SYNCIO_ENCRYPTION_KEY` and `SYNCIO_SETUP_TOKEN`. Both can be independent random password-manager values of at least 32 characters. Base64-encoded 32-byte keys remain supported.

For a terminal deployment, the equivalent command shape is:

```sh
openssl rand -base64 32
openssl rand -base64 48
corepack pnpm install
corepack pnpm run deploy
```

The first value is `SYNCIO_ENCRYPTION_KEY`; the second is `SYNCIO_SETUP_TOKEN`. Keep local recovery copies outside Git.

## Notes

- Cloudflare's current automatic provisioning supports D1 bindings without account-specific resource IDs.
- D1 migrations live in `migrations/` by default and can be applied through Wrangler.
- Wrangler can create a D1 database and print the database ID.
- Generate `SYNCIO_ENCRYPTION_KEY` as either 32 random bytes encoded as base64/base64url or an independent random password-manager value of at least 32 characters.
- Generate an independent high-entropy `SYNCIO_SETUP_TOKEN`, for example with `openssl rand -base64 48`. Do not reuse the encryption key.
- Delegated Trakt mode uses Stremio's public client identity and fetches the current access grant from Stremio for each run. It does not persist Trakt OAuth tokens.
- Optional direct mode uses Trakt Device OAuth, whose token endpoint requires both the app client id and client secret.
- Stremio account writes rely on Stremio's internal account API, not the public Addon SDK contract. Account identity is verified before an auth key is accepted.
- The free Workers plan currently allows 50 external subrequests per invocation. Cinemeta lookups and Stremio rating checks are batched, Trakt collections use bounded pagination, and the sync interval is one hour.
- Each run applies at most 250 logical differences. Ledger entries are inserted in grouped D1 queries to keep first imports within free-tier query limits.
- Read [SELF_HOST_ONBOARDING.md](SELF_HOST_ONBOARDING.md) for the intended setup flow and privacy boundary.

References:

- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://docs.trakt.tv/docs/authentication-oauth
- https://docs.trakt.tv/reference/postoauthdevicecode
- https://docs.trakt.tv/reference/postoauthdevicetoken
