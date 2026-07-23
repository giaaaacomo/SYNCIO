# ADR 0002: Addon-First Product Shape

## Status

Accepted.

## Context

SYNCIO should feel like a normal Stremio addon: the user installs it from Stremio, configures accounts, and does not have to keep a local script or daemon running.

The sync engine also needs behavior that is not a natural fit for a purely request-driven addon:

- scheduled sync runs;
- OAuth refresh and account guards;
- persistent dedupe state;
- conflict handling;
- background retries.

## Decision

SYNCIO will be addon-first, backed by a self-hosted sync service.

The addon manifest and configure page are the product entrypoint. A user-owned Cloudflare Worker owns durable state, scheduled jobs, OAuth tokens, and deep sync writes. The local CLI remains a development and diagnostics tool.

## Consequences

- Users get an install flow that matches the Stremio addon model.
- The core sync engine must stay portable so it can run locally in development and inside the self-hosted Worker in production.
- The addon can expose status/configuration/catalog surfaces, but should not be the only trigger for sync correctness.
- Production onboarding must guide each user through deploying their own Worker/D1 and creating their own Trakt app.
