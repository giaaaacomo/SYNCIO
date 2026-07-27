# Changelog

All notable changes to SYNCIO are documented here.

## [0.3.2] - 2026-07-28

### Changed

- the Worker home now opens a direct Stremio installation flow;
- setup is entered through Stremio's standard **Configure** action;
- Stremio accounts created with Facebook receive a guided, official password setup path without exposing Facebook credentials to SYNCIO;
- deployment documentation no longer asks users to construct the `/configure` URL manually.

## [0.3.1] - 2026-07-28

First public technical beta.

### Added

- guided self-host deployment on Cloudflare Workers with private D1 storage;
- protected five-step configure flow and installable no-catalog Stremio manifest;
- delegated Trakt transport that reuses Stremio's existing grant without occupying another app slot;
- bidirectional watched movie and per-episode synchronization;
- additive Stremio Library and Trakt Watchlist synchronization;
- bidirectional movie and series rating mapping;
- persisted rating snapshots and fail-closed simultaneous-change conflicts;
- hourly guarded scheduling, bounded batches, idempotency ledger, and run history;
- encrypted credentials, privacy export, disconnect, and complete data deletion;
- funding links and public beta acceptance evidence.

### Safety

- removals and strict mirroring are disabled;
- every preview verifies both account identities;
- activation and manual apply require the exact current preview fingerprint;
- delegated Trakt tokens remain in memory and are not stored in D1;
- native Trakt numeric ratings are preserved unless Stremio subsequently changes them.

### Known Limitations

- Stremio account integration relies on behavior outside the public Addon SDK;
- Android TV acceptance testing is deferred;
- rating discovery is limited to known items and processed in bounded batches;
- existing installations require their own Cloudflare deployment to receive updates.

[0.3.2]: https://github.com/giaaaacomo/SYNCIO/releases/tag/v0.3.2
[0.3.1]: https://github.com/giaaaacomo/SYNCIO/releases/tag/v0.3.1
