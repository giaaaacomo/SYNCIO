# ADR 0006: Rating conflict snapshots

## Status

Accepted

## Context

Watched history and Library/Watchlist synchronization are additive unions. Their supported operations cannot conflict because SYNCIO does not propagate removals.

Ratings are different: Stremio stores a categorical Like/Love state while Trakt stores a numeric value. A blind bidirectional comparison cannot distinguish a new user change from an old mapping result, and can collapse a native Trakt value such as 8 to the configured Like threshold.

## Decision

SYNCIO stores the last successfully converged Stremio and Trakt rating state for every scanned movie or series.

- With no snapshot, Trakt remains authoritative when it already has a rating.
- If only Trakt changed, its numeric rating is mapped to Stremio.
- If only Stremio changed, Like or Love is mapped to the configured Trakt threshold.
- If both changed and the resulting states are equivalent, the snapshot advances without a write.
- If both changed and disagree, SYNCIO records an idempotent conflict and writes neither side.
- Removing a rating from Stremio does not remove a Trakt rating. Destructive removals remain unsupported.

Snapshots advance only after every planned external write succeeds. A later manual alignment resolves the open conflict automatically.

Preview remains read-only: it reports conflict candidates but persists them only during an activated or explicitly applied synchronization.

## Consequences

Native Trakt numeric ratings remain intact when Stremio has not changed. Simultaneous edits cannot oscillate or silently overwrite each other. Conflict resolution is intentionally source-driven for the beta: the user aligns either Stremio or Trakt, and the next run records the converged state.
