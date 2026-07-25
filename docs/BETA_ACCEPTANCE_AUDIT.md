# Beta Acceptance Audit

Audit date: 2026-07-25

This document maps the original MVP acceptance matrix to reproducible evidence. A row is complete only when its stated evidence exists; automated coverage does not substitute for client-specific visual validation.

## Release Criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| No catalog rows are added by default | Automated | `src/worker.test.ts` verifies an installable manifest with an empty `catalogs` array. |
| External Trakt movie history becomes native Stremio watched state | Automated and live | Worker planning/apply tests cover the write shape; the isolated E2E account displayed the imported watched state. |
| External Trakt episode history becomes native per-episode Stremio watched state | Automated and live | Episode planning, bitfield, and Library-preservation tests pass; isolated E2E tests showed the episode eye marker without flagging the whole show. |
| Stremio watched state reconciles to Trakt without duplicate plays | Automated and live | History payload grouping and duplicate-history planning are covered; repeated E2E previews converged to zero writes. |
| Library and Watchlist additions synchronize in both directions | Automated and live | Bidirectional planning and payload tests pass; the isolated account exercised both directions. |
| Watchlist removal does not remove Stremio Library membership | Automated policy | Removal apply is rejected and visible Library membership is preserved by the Library change builders. |
| Ratings synchronize in both directions for movies and series | Automated and live | Threshold, authority, payload, movie, and series cases pass; isolated E2E tests exercised Like/Love mapping. |
| Existing native Trakt ratings do not collapse to threshold values | Automated | The rating planner keeps an existing Trakt value authoritative and maps it to Stremio without rewriting Trakt. |
| A second unchanged sync performs zero external writes | Automated and live | Fingerprint/idempotency behavior is covered and repeated E2E previews reported no operations. |
| Credentials are encrypted at rest and absent from URLs/logs/exports | Automated | Secret encryption, context binding, redacted status, lifecycle export, and protected-route tests pass. |
| Users can disconnect and delete all stored data | Automated | Worker lifecycle and foreign-key-safe deletion tests pass. |
| API failures cannot create destructive changes | Automated policy | Reads fail rather than returning partial pagination, removals are unsupported, account mismatches fail closed, and applies require the exact preview fingerprint. |
| Personal deployment works on Cloudflare | Live | Deploy-to-Cloudflare created an isolated Worker and D1 database; hourly scheduled runs completed successfully. |
| Delegated Trakt authorization renews without a new app slot | Automated and live | Credential rotation is covered without token persistence. The E2E grant renewed before expiry and remained bound to the expected test account. |
| Undocumented Stremio integration is isolated and contract tested | Automated | Stremio account, Library, watched bitfield, rating, and API adapter behavior is isolated under `src/stremio` and `src/sync`. |

## Remaining Release Gates

### Multi-client validation

The following checks require real clients and remain open for Stremio Web, desktop, Android, and Android TV:

- addon installation and Configure access;
- no unexpected Home or Board rows;
- movie and episode watched marks render correctly;
- Library membership and calendar behavior remain intact;
- imported state survives client restart and Stremio account refresh;
- no client overwrites imported watched or rating state.

Use isolated accounts until all four client rows have been recorded in the release checklist below.

| Client | Install | No rows | Watched marks | Library/calendar | Restart/account sync | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Web | Pass; installed card cached 0.2.2 while the live manifest served 0.3.0 | Pass | Pass; historical episodes remained watched and Silo's newly released episode remained unwatched | Not exercised; all test series were history-only | Pass | Partial pass |
| Desktop | Pass | Pass | Pass; matched Web state | Not exercised; all test series were history-only | Pass | Partial pass |
| Android | Pending | Pending | Pending | Pending | Pending | Pending |
| Android TV | Pending | Pending | Pending | Pending | Pending | Pending |

During Web validation, intermittent metadata and search failures named the Env and YouTube addons. SYNCIO exposes no catalogs or metadata resources, and its live manifest remained reachable, so those failures are not attributed to SYNCIO. Opening a history-only item while metadata was unavailable produced Stremio's "No metadata was found" placeholder; the same title resolved after the catalog recovered.

### Conflict semantics

Watched state is an additive union, removals are disabled, and Trakt ratings are currently authoritative when both services already contain different values. These rules prevent the currently supported operations from oscillating, but they do not prove that both sides changed since the previous successful run.

The `sync_conflicts` table is available for lifecycle export and future conflict records, but simultaneous-change detection needs persisted source snapshots or equivalent revision evidence. This is an explicit beta gap, not a completed feature. It must be designed before any destructive sync or bidirectional removal policy is introduced.

## Operational Observation

The isolated E2E deployment observed a delegated grant originally expiring at `2026-07-24T17:46:04Z`. Stremio exposed a replacement created at `2026-07-24T17:00:41Z`, expiring at `2026-07-31T17:00:41Z`. A read-only Trakt identity request returned HTTP 200 and the configured account guard matched.

No access token, refresh token, auth key, or secret value is recorded in this audit.
