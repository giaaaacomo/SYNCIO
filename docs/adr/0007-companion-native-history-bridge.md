# ADR 0007: Companion Native History Bridge

## Status

Accepted for an experimental read-only preview on `feature/companion-bridge`.

## Context

SYNCIO can synchronize Stremio and Trakt, but neither account contains complete viewing activity
from services such as Netflix, Prime Video, Disney+ or Crunchyroll. Universal Trakt Scrobbler
already contains service-specific adapters, but its normal transport requires a separate Trakt
community-app connection and couples history matching to Trakt.

Browser navigation history is not suitable evidence. Opening a title page does not mean the title
was watched, and reading unrelated browser history would expand the privacy surface without solving
the completion problem.

## Decision

SYNCIO Companion is maintained as a credited fork of Universal Trakt Scrobbler. It reuses native
service account, viewing-history and playback adapters locally in the browser.

The browser sends the Worker only a strict normalized observation:

- provider and provider item ids;
- movie or episode coordinates;
- title and optional year;
- measured progress or an explicit platform completion signal;
- viewing date and optional duration.

Cookies, service authorization headers, raw service responses and browser navigation history are
outside the contract and rejected if supplied as extra fields.

Initial completion rules are conservative:

- explicit platform completion is a candidate;
- reliable measured progress of at least 80 percent is a candidate;
- lower progress is excluded;
- missing or conflicting evidence is sent to review;
- missing dates or episode coordinates are sent to review.

The first implementation is preview-only. Import and live-scrobble writes require separate
contracts, idempotency and user confirmation.

## Pairing and storage

The setup-authenticated Worker creates a ten-minute, one-use pairing code. Exchanging it produces a
scoped bearer token. The extension stores the raw token only in extension-local storage; the Worker
stores only its SHA-256 hash.

Worker requests use a dedicated fetch path with credentials omitted and no referrer. Companion
clients can revoke themselves, and setup can list or revoke clients. Disconnect and full deletion
remove pairing sessions, clients and encrypted mappings.

## Consequences

- Watches performed on mobile or TV can be discovered later when a native service history adapter
  reads the same account on desktop.
- Discovery is not real-time while the desktop browser is closed.
- Netflix, Prime Video and Crunchyroll are the first preview adapters.
- Disney+ requires a new native history adapter; current upstream support covers playback
  scrobbling only.
- Apple TV content delivered through Prime Channels is treated as a Prime adapter experiment.
- Matching and encrypted reusable mappings remain subsequent work.
- Upstream adapter updates are fetched deliberately and merged into the fork without presenting
  SYNCIO's AI-assisted changes as upstream hand-written work.
