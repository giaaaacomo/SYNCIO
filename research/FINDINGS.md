# Milestone 0 Findings

Status: live probes started on 2026-07-17 with a dedicated Stremio/Trakt test account.

## Stremio Auth

- PASS: Flatpak local storage contains a Stremio profile for the test account.
- PASS: An auth key was extracted into local `.env` without printing it.
- PASS: `getUser` accepts the auth key.
- Observed `getUser` shape includes user fields plus a `trakt` object containing access and refresh token fields.
- Do not commit `.env`; it is ignored by Git.
- Added `STREMIO_EXPECTED_USER_ID` account guard. Stremio probes now fail if the active auth key belongs to a different user ID.
- Important: `tt1375666` / Inception has only been used as a dry-run/read target so far. No Stremio or Trakt write has been applied.

## Stremio Library Datastore

- PASS: `datastoreGet` for `libraryItem` works.
- Current test account baseline: `0` `libraryItem` records.
- Visible Library count: `0`.
- History-only count: `0`.
- After the controlled Trakt seed, Stremio still reports `0` `libraryItem` records. Treat Trakt and Stremio as separate states for SYNCIO to reconcile.

## History-Only Library Items

- PASS: dry-run movie history-only write produces a `libraryItem` with `removed=true` and `temp=true`.
- Pending live apply/client verification: whether that record carries watched state without visible Home/Library rows.

## Movie Watched Writes

- PASS: dry-run movie watched write for `tt1375666` produces a conservative history-only `libraryItem`.
- PASS: live history-only movie watched write applied to Stremio test for The Matrix (`tt0133093`).
- PASS: Stremio datastore now reports `1` total `libraryItem`, `0` visible, `1` history-only.
- PASS: Stremio Like/Love status for The Matrix remains `status: null`; the watched write did not accidentally set a rating status.
- PASS: Flatpak client visually shows The Matrix as watched after the history-only write.
- PASS: The Matrix does not appear in Stremio Library or Continue Watching after the history-only write.
- Observation: the client shows a new `Trakt History - Movie` row. This may be produced by Stremio's official Trakt integration/catalog rather than by SYNCIO's history-only `libraryItem`; isolate before drawing conclusions.
- User also observed `Trakt Watchlist - Series`, `Trakt Watchlist - Movie`, `Trakt Recommendations - Series`, and `Trakt Recommendations - Movie` rows. These are likely official Trakt integration/catalog rows in Stremio, not rows created by SYNCIO datastore writes.

## Trakt -> Stremio Watched Import

- Added `probe:import:watched` to import Trakt watched movies and targeted show episode history into Stremio history-only `libraryItem` records.
- Dry-run by default; write requires `--apply`.
- Added `--movie-ids` and `--show-ids` filters to avoid applying broad imports during test-account validation.
- PASS: broad dry-run found extra watched shows in the Trakt test account (`Silo`, `Fallout`) in addition to the controlled baseline. Do not apply unfiltered imports while validating.
- PASS: filtered import for Matrix (`tt0133093`) and Breaking Bad (`tt0903747`) planned 2 changes.
- PASS: filtered import applied successfully and preserved Stremio datastore state as `0` visible items, all imported records history-only.
- PASS: Breaking Bad remains serialized in the native episode watched shape after the importer pass.

## Episode Watched Bitfield Writes

- PASS: Cinemeta `catalog/series/video-ids/imdbIds=...` endpoint responds, but its `videos` payload is currently string IDs, not objects with `id`.
- Updated research Cinemeta adapter to accept both string IDs and `{ id }` objects.
- PASS: dry-run episode watched write for `tt0944947:1:1` builds a watched bitfield for 128 video IDs.
- PASS: live history-only episode watched write applied to Stremio test for Breaking Bad S01E01 (`tt0903747:1:1`).
- PASS: Cinemeta returned 67 video IDs for Breaking Bad and the watched bitfield was built around target `tt0903747:1:1`.
- PASS: Stremio datastore now reports `2` total `libraryItem` records, `0` visible, `2` history-only.
- Client observation after first episode write: Breaking Bad S01E01 showed as watched, but the UI appeared to treat the whole series as watched.
- Likely cause: the initial series payload reused movie-level markers (`flaggedWatched`, `timesWatched`, `lastWatched`) on the series `libraryItem`.
- Updated series watched writes to use the compressed `state.watched` bitfield as the authoritative episode-level state and avoid setting movie-level watched markers.
- PASS: corrective write for Breaking Bad S01E01 applied. Stremio normalized omitted top-level watched markers to empty/zero values (`flaggedWatched=0`, `timesWatched=0`) while preserving `state.watched`.
- Client observation after bitfield-only corrective write: Breaking Bad no longer showed as watched at all, neither at series level nor episode level.
- Applied intermediate episode payload for Breaking Bad S01E01: preserve `lastWatched`, `video_id`, `season=1`, `episode=1`, and `state.watched`, but keep `flaggedWatched=0` and `timesWatched=0`.
- PASS: Stremio persisted the intermediate episode payload with `season=1`, `episode=1`, `flaggedWatched=0`, and `timesWatched=0`.
- Client observation after intermediate payload: Breaking Bad still did not show as watched at series level or episode level.
- Added explicit `--series-flagged` probe mode for controlled testing of active series markers.
- Applied flagged episode payload for Breaking Bad S01E01: `lastWatched`, `video_id`, `season=1`, `episode=1`, `state.watched`, `flaggedWatched=1`, and `timesWatched=1`.
- PASS: Stremio persisted the flagged episode payload with `season=1`, `episode=1`, `flaggedWatched=1`, and `timesWatched=1`.
- Client observation after flagged episode payload: Breaking Bad still appears as fully watched.
- Important client observation: none of the episode write variants showed the usual yellow eye icon on the S01E01 thumbnail. This suggests the tested payloads set an aggregate series watched state, not the true client-recognized episode watched state.
- PASS: Native UI write for Better Call Saul S01E01 produced a history-only series item with `flaggedWatched=0`, `timesWatched=0`, empty `video_id`, `season=0`, `episode=0`, and a `state.watched` value anchored to the watched episode ID (`tt3032476:1:1:234:...`).
- Important correction: Stremio's watched bitfield serialization anchors to the latest watched episode ID and shifts the packed bits so that anchor maps to the last bit. It does not anchor to the final Cinemeta video ID.
- Updated `watched-bitfield` serialization to match the native UI shape.
- Applied native-shaped episode payload for Breaking Bad S01E01: `flaggedWatched=0`, `timesWatched=0`, empty `video_id`, `season=0`, `episode=0`, and `state.watched` anchored to `tt0903747:1:1`.
- PASS: Flatpak client visually shows the native-shaped Breaking Bad payload correctly: S01E01 has the watched eye and the whole series is not treated as watched.

## Stremio Ratings

- PASS: `likes.stremio.com/api/get_status` works for `tt1375666` movie and returned `status: null`.
- PASS: `rating-send` validates a `liked` payload in dry-run.
- No live rating write has been applied yet.

## Trakt -> Stremio Rating Import

- Added `probe:import:ratings` for Trakt movie rating import into Stremio Like/Love status.
- Dry-run by default; write requires `--apply`.
- Current mapping: Trakt `9-10 => loved`, `7-8 => liked`, lower ratings clear Stremio status.
- PASS: filtered dry-run for Matrix (`tt0133093`) maps Trakt `8/10` to Stremio `liked`.
- Product decision: user selected `9+ => loved`, `7+ => liked`.
- PASS: filtered rating import for Matrix applied successfully.
- PASS: Stremio Like/Love `get_status` now returns `status: liked` for Matrix.

## Trakt -> Stremio Watchlist Import

- Added `probe:import:watchlist` for Trakt movie watchlist import into visible Stremio library items.
- Dry-run by default; write requires `--apply`.
- Use `--movie-ids` while validating to avoid broad visible Library changes.
- PASS: filtered dry-run for Interstellar (`tt0816692`) planned a visible library item with `removed=false`, `temp=false`, and no watched state.
- PASS: filtered watchlist import for Interstellar applied successfully.
- PASS: Stremio datastore now reports `4` total library items: `1` visible item (Interstellar) and `3` history-only watched/test records.
- PASS: Interstellar record is visible and not watched (`flaggedWatched=0`, `timesWatched=0`).

## Stremio -> Trakt Watched Export

- Added `probe:export:watched` for exporting Stremio watched movie/episode state to Trakt `/sync/history`.
- Dry-run by default; write requires `--apply`.
- Uses `--movie-ids` and `--show-ids` filters during validation to avoid duplicate history events.
- Fixed filter semantics: when any filter is supplied, unfiltered media types are excluded instead of defaulting to `all`.
- PASS: dry-run for Better Call Saul (`tt3032476`) planned `0` movies, `1` show, `1` episode.
- PASS: export for Better Call Saul S01E01 applied to Trakt successfully; Trakt response reported `added.episodes=1` and empty `not_found`.
- PASS: lookup resolved Better Call Saul to Trakt show ID `59660`.
- PASS: `/sync/history/shows/59660` now returns `1` history event.

## Guarded Watched Sync

- Added `sync:watched` as the first guarded sync command above the one-off probes.
- Dry-run by default; writes require `--apply`.
- Applies are refused without `--movie-ids` or `--show-ids` unless `--allow-unfiltered-apply` is explicitly passed.
- Added local sync state at `.syncio/state.json` for future applied-operation dedupe. The directory is ignored by Git.
- Added target-side dedupe before writing: Trakt -> Stremio skips items already watched in Stremio, and Stremio -> Trakt skips items already watched in Trakt. This covers history created before the local state file existed.
- PASS: targeted dry-run for Matrix, Breaking Bad, and Better Call Saul planned `0` writes. It skipped all watched items because they are already present on the target side, including the previously exported Better Call Saul episode.

## Stremio Rating Enumeration

- SKIP for now: account has no `libraryItem` movie/series records to sweep.

## Minimal No-Catalog Manifest

- Pending client test.
- Local sandbox cannot bind the probe server port, so run `npm run probe:manifest` outside this restricted Codex sandbox.

## Addon Shell

- Added `addon:dev` as the first addon-first shell.
- Routes:
  - `/configure` and `/` serve a local configure/install page.
  - `/manifest.json` serves manifest ID `community.syncio`, name `SYNCIO`, configurable with configuration required.
  - `/catalog/movie/syncio-status.json` serves one visible `SYNCIO Status` catalog item.
  - `/status.json` and `/healthz` expose development status.
- The shell declares one `SYNCIO Status` movie catalog so Stremio sees a normal addon resource shape while deep sync remains handled by the backend/core.
- PASS: Stremio read the local manifest from `http://127.0.0.1:7017/manifest.json` and showed the install dialog for `SYNCIO v0.1.0`.
- PASS: Stremio rendered the `SYNCIO Status` catalog and poster.
- Updated `/configure` and `/status.json` to show redacted local readiness only: Stremio env configured/missing, Trakt env configured/missing, and local sync state operation count.
- Added local Trakt Device OAuth endpoints to the addon shell:
  - `POST /oauth/trakt/start` requests a Trakt user code and saves `TRAKT_DEVICE_CODE` locally.
  - `POST /oauth/trakt/poll` performs one poll attempt and saves Trakt access/refresh tokens locally after authorization.
  - The configure page exposes `Start Trakt Link` and `Complete Link` buttons.
- Client observation: after authorizing a Trakt code, `Complete Link` showed `Trakt device poll failed.`
- Root cause fixed: `updateDotEnv` wrote new values to `.env` but did not update `process.env` in the already-running addon server, so the poll endpoint could use a stale/expired `TRAKT_DEVICE_CODE`.
- Added a regression test for live process env updates and improved poll error text.
- PASS: retry after the fix completed Trakt linking from the addon configure page.
- PASS: independent `probe:trakt:account` verification still matches the isolated test account.
- Added `POST /account/trakt/verify` and a `Verify Trakt Account` button to show the redacted account username and guard state from the configure page.
- Added `POST /sync/watched/preview` and a `Preview Watched Sync` button. It runs the existing watched sync engine in dry-run mode with explicit test filters only.
- PASS: watched preview equivalent dry-run for Matrix, Breaking Bad, and Better Call Saul planned `0` writes and skipped all operations because the target side already has the watched state.
- Added `POST /sync/ratings/preview` and `POST /sync/watchlist/preview`, exposed by `Preview Ratings` and `Preview Watchlist` buttons.
- Improved ratings import idempotence: dry-run now checks the current Stremio rating status and reports `target-skip` when it already matches the mapped Trakt rating.
- Improved watchlist import idempotence: dry-run now reports `target-skip` when the movie is already visible in Stremio.
- PASS: ratings preview for Matrix planned `0` writes and skipped because Stremio already has `liked`.
- PASS: watchlist preview for Interstellar planned `0` writes and skipped because Interstellar is already visible in Stremio.
- Added controlled apply endpoints for the test set:
  - `POST /sync/ratings/apply` applies Trakt -> Stremio ratings for Matrix only.
  - `POST /sync/watchlist/apply` applies Trakt -> Stremio watchlist for Interstellar only.
- PASS: created a controlled Matrix rating mismatch by clearing the Stremio rating only.
- PASS: ratings dry-run then planned `1` change: Trakt `8/10` -> Stremio `liked`.
- PASS: `POST /sync/ratings/apply` restored Matrix to Stremio `liked`.
- PASS: follow-up Stremio rating read returned `status: liked`.
- Improved redaction to treat `userId` / `user_id` fields as sensitive.
- Added `probe:stremio:library-presence` to toggle a single Stremio library item visible/non-visible for controlled mismatch tests.
- PASS: created a controlled Interstellar watchlist mismatch by setting Stremio library presence to non-visible while leaving Trakt watchlist intact.
- PASS: watchlist dry-run then planned `1` change for Interstellar.
- PASS: `POST /sync/watchlist/apply` restored Interstellar as a visible Stremio library item.
- PASS: follow-up library item read returned `removed=false` and `temp=false` for Interstellar.
- Refactored Trakt -> Stremio ratings into importable core module `research/lib/sync-ratings.ts`; the old probe is now a thin CLI wrapper.
- Refactored Trakt -> Stremio watchlist into importable core module `research/lib/sync-watchlist.ts`; the old probe is now a thin CLI wrapper.
- Updated addon ratings/watchlist preview/apply endpoints to call the core modules directly instead of spawning subprocesses.
- Refactored guarded watched sync into importable core module `research/lib/sync-watched.ts`; the old `research/sync-watched.ts` probe is now a thin CLI wrapper.
- Updated addon watched preview to call the watched core directly instead of spawning the CLI subprocess.
- PASS: post-refactor ratings dry-run for Matrix still reports `plannedChanges=0`, `targetSkipped=1`.
- PASS: post-refactor watchlist dry-run for Interstellar still reports `plannedChanges=0`, `targetSkipped=1`.
- PASS: post-refactor watched dry-run for Matrix, Breaking Bad, and Better Call Saul still plans `0` writes and skips all operations because both target sides already match.
- PASS: `POST /sync/watched/preview` now returns `command: sync-watched core dry-run` and the expected `planned=0` result through the running addon server.
- Added `POST /sync/watched/apply` and an `Apply Watched Test` button for the guarded test set only.
- PASS: `POST /sync/watched/apply` completed as an idempotent no-op: `planned=0`, target-side skips only, Stremio apply returned success, and Trakt apply reported `0` added movies/episodes.
- Added `research/lib/sync-run.ts` as the first unified sync orchestrator for watched, ratings, and watchlist.
- Added shared guarded test filters in `research/lib/test-sync-options.ts`.
- Added `sync:run` CLI plus addon routes `POST /sync/preview` and `POST /sync/run`.
- Added `Preview Full Test Sync` and `Apply Full Test Sync` buttons to the configure page.
- PASS: `POST /sync/preview` returned a unified summary with `plannedChanges=0`, `watched=0`, `ratings=0`, and `watchlist=0`.
- PASS: `POST /sync/run` completed as an idempotent full test run with no planned writes.
- PASS: `corepack pnpm run sync:run` returned the same unified preview summary through the CLI probe reporter.
- Added local sync settings persisted at `.syncio/settings.json`, which is ignored by Git.
- Added `GET /sync/settings` and `POST /sync/settings` to read/write local test-scope settings.
- Added configure-page controls for watched, ratings, watchlist, Like threshold, and Love threshold.
- Updated full sync run and `sync:run` CLI to load settings before building the guarded test sync options.
- Updated ratings import to accept configurable `likeThreshold` and `loveThreshold`; defaults remain `7` and `9`.
- PASS: default settings report test scope, all modules enabled, and rating thresholds `7/9`.
- PASS: settings POST writes the local settings file and returns the normalized settings.
- PASS: disabling watchlist in settings removes watchlist from the full preview results while leaving watched and ratings enabled.
- PASS: settings were restored to all modules enabled with thresholds `7/9`.
- Added explicit tests that watched movie/episode writes preserve existing visible Stremio Library membership (`removed=false`, `temp=false`).
- Policy decision: SYNCIO must never remove or hide a user-collected show just because all currently released episodes are watched. Continue Watching may clear naturally, but Library/Calendar membership must be preserved.
- Added `account-preview` settings scope. It removes the guarded test filters for preview-only account inspection.
- Added apply guards so full and granular apply endpoints refuse to run outside `test` scope.
- PASS: account-preview returned a broader dry-run on the test account, with potential changes but no writes.
- PASS: apply in account-preview returned the expected blocked error before any sync write.
- PASS: settings were restored to `test` scope after account-preview validation.
- Added `research/lib/sync-run-review.ts` to build a compact human-readable review for full sync runs.
- Added configure-page rendering for full sync reviews: metric cards, warnings, grouped sections, then raw JSON details.
- Review groups planned watched episodes by show ID instead of showing only a flat operation wall.
- Watched summaries now expose compact planned Stremio item impact: id, name, type, visible Library preservation, and history-only writes.
- Review uses planned Stremio item names when available, so account-preview shows titles such as Silo and Fallout instead of only IMDb IDs.
- PASS: review unit test verifies grouped episode output and account-preview apply warning.
- PASS: `POST /sync/preview` now returns `review.headline`, summary metrics, safety warnings, and per-module sections.
- PASS: account-preview review shows Silo/Fallout episode groups and marks both as history-only, not visible Library additions.
- PASS: settings were restored to `test` scope after the enriched account-preview verification.
- Added the first self-hosted Cloudflare shell under `src/`, separate from the local research addon.
- Added `wrangler.toml` with a placeholder D1 binding and `migrations/0001_initial.sql` for users, encrypted connections, settings, sync runs, ledger, and conflicts.
- Added `worker:typecheck` so the Worker shell can be validated independently from Node-local research probes.
- Added typed D1 storage adapter at `src/storage/d1.ts` and `/api/status` Worker route.
- Added D1 repositories for Worker users and sync settings.
- Replaced the public predeploy user-id settings routes with protected self-host routes: `GET /api/setup/settings` and `PUT /api/setup/settings`.
- Added `worker:test` with a separate Worker test tsconfig so runtime Worker code stays free of Node types.
- Added `docs/CLOUDFLARE_PREDEPLOY.md` with the remaining Cloudflare login, D1 creation, migrations, secrets, and deploy steps.
- PASS: `corepack pnpm run worker:typecheck`.
- PASS: `corepack pnpm run worker:test`.
- Decision: production is self-hosted Cloudflare Worker + D1 per user, not hosted-by-us.
- Decision: production onboarding will require each user to create their own Trakt application; no shared SYNCIO Trakt app.
- Added ADR 0003 and self-host onboarding notes.
- Updated the initial D1 `connections` table to store per-installation Trakt app credentials alongside Stremio/Trakt auth material.
- Added AES-GCM secret helper for application-layer encryption before writing authenticating values to D1.
- Added Worker setup routes:
  - `GET /api/setup/status` returns redacted self-host readiness.
  - `POST /api/setup/trakt-app` encrypts and saves user-owned Trakt app credentials in D1.
- Added a first Worker configure page form for saving the user-owned Trakt app credentials.
- PASS: Worker tests verify setup status redaction and encrypted Trakt app credential persistence.
- Added protected Worker onboarding with `SYNCIO_SETUP_TOKEN`; every `/api/setup/*` route now requires bearer authorization.
- Public `/status.json` no longer includes setup state, account identifiers, or active OAuth codes.
- Added Trakt Device OAuth start/poll routes using encrypted temporary device-code persistence and server-enforced polling intervals.
- Current Trakt documentation requires both client id and client secret for the Device OAuth token poll; Worker onboarding now requires both.
- Added terminal handling for pending, invalid, used, expired, denied, and slow-down Trakt responses.
- Added Trakt account verification through `/users/settings`; only the verified username is stored alongside encrypted access/refresh tokens.
- Added Stremio linking by transient email/password login or existing auth key. Passwords are never persisted; the verified auth key is encrypted and paired with the account id guard.
- Added protected sync settings UI. New self-host installs default to `account-preview`, and destructive removals remain disabled.
- PASS: initial D1 migration parses cleanly in SQLite with the connection and temporary OAuth session tables.
- PASS: Worker protocol, repository, crypto, setup-auth, Trakt, Stremio, and integration tests pass without external network calls.
- Added Trakt refresh-token support using the exact per-install redirect URI, followed by account identity verification before refreshed tokens are persisted.
- Added a Worker-compatible asynchronous watched bitfield codec using `CompressionStream`/`DecompressionStream`; episode anchoring and shifted-list tests match the validated local behavior.
- Replaced the Worker sync-preview `501` placeholder with a protected, read-only account baseline.
- Worker preview now plans watched movie differences in both directions, watched episode differences in both directions, and Trakt movie watchlist additions to visible Stremio Library membership.
- Cinemeta video-id lookups are batched in groups of 100 to stay well below Cloudflare Free's current 50-external-subrequest limit for normal accounts.
- Changed the self-host default interval to 60 minutes because Cloudflare documents a substantially larger Cron CPU allowance at intervals of one hour or more.
- PASS: Wrangler 4.113.0 `deploy --dry-run` produced an 84.42 KiB Worker bundle (18.01 KiB gzip) and recognized the placeholder D1 binding without publishing anything.
- Client observation: clicking the local `stremio://127.0.0.1:7017/manifest.json` shortcut made Stremio try `https://127.0.0.1/manifest.json`, dropping port `7017`.
- Updated local test guidance: paste `http://127.0.0.1:7017/manifest.json` into Stremio's add-on repository field instead of relying on the shortcut link.
- PASS: live client test installed the local addon by pasting `http://127.0.0.1:7017/manifest.json` into the Stremio test profile's add-on repository field.

## Trakt Last Activities and Pagination

- BLOCKED: the Stremio-stored Trakt access token alone is not enough for direct Trakt API calls.
- Observed direct call to Trakt with only `Authorization: Bearer ...` returns HTTP 403.
- Need `TRAKT_CLIENT_ID` from a Trakt application for official Trakt API probes.
- Current Trakt docs point app credential management to `https://trakt.tv/oauth/applications`, but that list route may return `404`; the direct creation route `https://trakt.tv/oauth/applications/new` remains available.
- PASS: the deployed Worker linked the isolated Trakt and Stremio test accounts with encrypted D1 credentials and verified both identities before previewing.
- Fixed the Worker episode baseline to use `/sync/history/episodes` instead of assuming `/sync/watched/shows` contains complete season details; the deployed preview now matches the local probe at 41 episode-history events.
- Current remote read-only baseline plans 40 Trakt-to-Stremio operations: one visible movie-library addition and 39 episode watched markers, with no Stremio-to-Trakt writes.
- PASS: protected remote apply required Test account mode and the exact SHA-256 preview fingerprint, then aggregated 40 confirmed operations into three Stremio library writes.
- PASS: the post-apply remote preview returned zero differences; D1 reports 40 ledger entries and zero conflicts.
- PASS: a controlled Ava mismatch was exported Stremio-to-Trakt, increasing Trakt watched movies from one to two; the following preview returned zero and the ledger reached 41.
- PASS: a Trakt 9/10 rating for Ava mapped to Stremio `loved`; direct rating verification and the following preview both passed, with 42 ledger entries total.
- Added an hourly guarded Cloudflare cron plus persisted sync-run status. Preview mode performs no external calls and Test mode may apply a fresh fingerprint.
- PASS: `TRAKT_CLIENT_ID` was added locally to `.env`.
- PASS: the Stremio-provided Trakt OAuth token was tested with the SYNCIO app client ID and returned HTTP 401, so it cannot be reused safely by our app.
- PASS: Stremio-provided Trakt tokens were removed from local `.env`; SYNCIO should use its own Trakt Device OAuth grant.
- PASS: `oauth/device/code` works with the SYNCIO app client ID when sent with Trakt API headers.
- PASS: `TRAKT_DEVICE_CODE` is saved locally to `.env` without printing it.
- Pending user action: authorize the Trakt Device OAuth code in the browser for the dedicated test Trakt account.
- Added `probe:trakt:account` to summarize `/users/settings` without printing tokens or email and to enforce `TRAKT_EXPECTED_USERNAME` when set.
- PASS: Device OAuth completed and Trakt access/refresh tokens were saved locally to `.env`.
- PASS: `TRAKT_EXPECTED_USERNAME` guard was saved locally for the isolated test account.
- PASS: Trakt helpers now enforce `TRAKT_EXPECTED_USERNAME` before non-account Trakt requests.
- PASS: `/users/settings` identifies the expected isolated OAuth test account.
- PASS: `/sync/last_activities` works with the guarded test-account token.
- PASS: `/sync/watched/movies` pagination works and currently returns `0` watched movies.
- PASS: `/sync/watched/shows` pagination works and currently returns `2` watched shows.
- PASS: controlled Trakt seed is now present on the test account.
- PASS: The Matrix (`tt0133093`) is watched and rated `8/10` through the API, corresponding to the user's `4/5` UI rating.
- PASS: Breaking Bad S01E01 / Pilot is present through `/sync/history/shows/1388`.
- PASS: Interstellar (`tt0816692`) is in the movie watchlist.
- Observation: `/sync/watched/shows` is useful as a show aggregate but does not expose the episode rows needed by the baseline probe. Use targeted history reads such as `/sync/history/shows/{traktId}` for episode-level verification.

## Hosted Live Activation Validation

- Published the self-host template as `giaaaacomo/SYNCIO` with an MIT license, generic D1 provisioning, required secrets, migrations, Deploy to Cloudflare button, and GitHub CI.
- Added bounded Trakt episode-history pagination that fails explicitly instead of returning a partial account history.
- Changed rating reconciliation to a persisted one-page scan with ten status lookups per run.
- Limited every apply to 250 deterministic operations; larger backlogs converge over later runs.
- Replaced one-ledger-query-per-operation with grouped JSON-backed D1 inserts, validated against SQLite.
- Added live activation columns in migration `0003_live_sync_activation.sql`.
- Live mode now requires Preview only mode, the exact SHA-256 preview fingerprint, `ENABLE SYNCIO`, and a successful first apply before the hourly scheduler is armed.
- Ordinary settings updates cannot arm Live mode. Returning to Preview only clears the activation record.
- Apply and scheduler independently require the persisted activation record in addition to `scope=account`.
- PASS: staging activation on the isolated account applied zero changes, stored a 64-character fingerprint, and switched to armed account scope.
- PASS: the first manual Live run planned and applied zero changes, completed without error, and was persisted as succeeded.
- PASS: an existing Matrix rating mismatch was left pending before the next hourly trigger: Trakt `8/10` mapped to Stremio `liked`, while Stremio still reported `loved`.
- PASS: the 04:00 local hourly run was persisted as `scheduled` and `succeeded` with exactly one planned change, without a manual sync invocation.
- PASS: direct post-cron verification reported Matrix as `liked`; the following seven hourly runs succeeded with zero planned changes, confirming stable idempotence.
- Added additive bidirectional Stremio Library/Trakt Watchlist planning and apply for IMDb movies and series.
- Trakt watchlist additions preserve existing Stremio movie watched markers and series episode bitfields; Stremio Library additions use Trakt `/sync/watchlist`, separate from watched-history writes.
- Non-IMDb Stremio Library items are ignored for Trakt Watchlist export, and removals remain disabled.
- Added bounded 250-item pagination for Trakt movie/show Watchlist reads.
- Added Trakt `429` propagation with `Retry-After`; the configure page disables preview retries and renders the cooldown.
- PASS: staging read-only preview planned exactly one new operation, adding visible Stremio Library movie Ava to the Trakt Watchlist.
- PASS: guarded Live activation applied Ava through Trakt `/sync/watchlist`, persisted the ledger operation, and armed the hourly scheduler with the exact preview fingerprint.
- PASS: direct Trakt verification returned Interstellar and Ava in the movie Watchlist, both already visible in Stremio.
- PASS: GitHub CI runs all Worker and research tests, both typechecks, and a Wrangler deployment dry-run.

## Open Questions

- Can all target Stremio clients install a manifest with empty `resources`, `types`, and `catalogs`?
- Does `removed=true` and `temp=true` reliably prevent visible Library/Home rows while preserving native watched state?
- Is there any supported Stremio bulk source for all Like/Love states?
- Which Trakt test data should we deliberately seed next for one movie, one episode, ratings, watchlist, and favorites?
