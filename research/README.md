# SYNCIO Research Probes

These probes are Milestone 0. They are designed to answer the dangerous questions before the production addon exists.

Run probes through the package scripts so TypeScript is compiled first:

```sh
npm run probe:stremio:auth
```

If `npm` is not available but Corepack is, use `corepack pnpm ...`.

All probes print sanitized response shapes and a clear conclusion. Stremio write probes are dry-run by default and require `--apply`.

## Environment

You can export these variables in your shell or copy `.env.example` to `.env`. The probe runner loads `.env` automatically.

Stremio probes accept either:

```sh
STREMIO_AUTH_KEY=...
STREMIO_EXPECTED_USER_ID=...
```

or:

```sh
STREMIO_EMAIL=...
STREMIO_PASSWORD=...
STREMIO_EXPECTED_USER_ID=...
```

Set `STREMIO_EXPECTED_USER_ID` for live testing. It makes every Stremio probe fail if the auth key belongs to a different account.

Trakt probes require:

```sh
TRAKT_CLIENT_ID=...
TRAKT_ACCESS_TOKEN=...
SYNCIO_USER_AGENT="SYNCIO/0.0.0 research your-contact"
```

If you do not yet have a SYNCIO-owned Trakt access token, start Device OAuth:

```sh
npm run probe:trakt:device-start
```

Copy the printed `TRAKT_DEVICE_CODE=...` line into `.env`, visit the printed Trakt activation URL, enter the user code, then run:

```sh
npm run probe:trakt:device-poll
```

## Recommended Order

1. `npm run probe:stremio:auth`
2. `npm run probe:stremio:library`
3. `npm run probe:stremio:rating-get -- --media-id tt... --media-type movie`
4. `npm run probe:stremio:rating-send -- --media-id tt... --media-type movie --status liked`
5. `npm run probe:stremio:history-only -- --media-id tt... --name "..." --year 2020`
6. `npm run probe:stremio:movie -- --media-id tt... --name "..." --year 2020`
7. `npm run probe:stremio:episode -- --show-id tt... --season 1 --episode 1`
8. `npm run probe:stremio:rating-enumeration`
9. `npm run probe:trakt:device-start`, then authorize in Trakt and run `npm run probe:trakt:device-poll`
10. `npm run probe:trakt:account -- --lock-expected`
11. `npm run probe:trakt:baseline`
12. `npm run probe:trakt:last-activities`
13. `npm run probe:trakt:pagination -- --endpoint /sync/watched/movies --limit 250 --max-pages 1`
14. `npm run probe:import:watched`
15. `npm run probe:import:ratings`
16. `npm run probe:import:watchlist`
17. `npm run probe:export:watched`
18. `npm run probe:manifest`, then install the served manifest in each Stremio client.

## Probe Notes and Undo

`stremio-auth.ts`

- Logs in or validates an auth key.
- Does not print full tokens.
- No undo needed.

`stremio-library-read.ts`

- Reads `libraryItem` datastore entries.
- No writes.

`stremio-movie-watched-write.ts`

- Plans or writes one movie watched-state update.
- Defaults to history-only representation for newly created records.
- Undo: run the same command with `--apply --undo`. This sets watched counters to zero; it cannot reconstruct unknown previous account state unless the item already existed and you saved it separately.

`stremio-episode-watched-write.ts`

- Fetches Cinemeta video IDs and plans or writes one series episode bit in `state.watched`.
- Defaults to history-only representation for newly created records.
- Undo: run the same command with `--apply --undo`.

`stremio-history-only-item.ts`

- Specifically tests whether `removed=true` and `temp=true` can carry watched state without showing a visible Library row.
- Undo: run the same command with `--apply --undo`.

`stremio-rating-get.ts`

- Calls Stremio Like/Love status for a known item.
- No writes.

`stremio-rating-send.ts`

- Dry-runs or sends `watched`, `liked`, `loved`, or `null`.
- Undo: run with `--apply --status null`.

`stremio-rating-enumeration.ts`

- Tests the fallback of sweeping known `libraryItem` records and querying their Like/Love status one by one.
- This does not prove a complete bulk endpoint exists.

`trakt-last-activities.ts`

- Reads Trakt `/sync/last_activities`.
- No writes.

`trakt-pagination.ts`

- Reads an explicitly paginated Trakt endpoint with `limit<=250`.
- No writes.

`trakt-baseline.ts`

- Verifies the controlled test seed: The Matrix watched/rated, Breaking Bad S01E01 watched, and Interstellar watchlisted.
- No writes.

`trakt-to-stremio-import.ts`

- Imports Trakt watched movies and episode history into Stremio history-only `libraryItem` records.
- Dry-run by default; write with `--apply`.
- Uses targeted `/sync/history/shows/{traktId}` reads for episode-level history and native Stremio watched-bitfield serialization.

`trakt-to-stremio-ratings.ts`

- Maps Trakt movie ratings to Stremio Like/Love status.
- Dry-run by default; write with `--apply`.
- Current conservative mapping: `9-10 => loved`, `7-8 => liked`, lower ratings clear the Stremio status.

`trakt-to-stremio-watchlist.ts`

- Imports Trakt movie watchlist entries into visible Stremio library items.
- Dry-run by default; write with `--apply`.
- Use `--movie-ids` while validating to avoid broad visible Library changes.

`stremio-to-trakt-watched.ts`

- Exports Stremio watched movie/episode state to Trakt `/sync/history`.
- Dry-run by default; write with `--apply`.
- Use `--movie-ids` and `--show-ids` while validating to avoid duplicate Trakt history events.

`minimal-manifest/server.ts`

- Serves a manifest with no catalogs, no streams, and no token in the URL.
- Use it to test whether each Stremio client accepts a resource-free configurable addon.
