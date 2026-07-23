# SYNCIO Service Shape Options

SYNCIO should be installable from Stremio like a normal addon. The open choice is not whether an addon exists, but how much responsibility lives inside the addon versus a sync backend.

## Option A: Local CLI / Daemon

Runs on the user's machine with local `.env` credentials and a local state file.

- Best for fast iteration and deep Stremio desktop testing.
- Easiest to debug because it can inspect the same environment the user is using.
- Weak for always-on sync unless the user configures a timer or background service.
- Useful as a developer tool, not as the product UX.

## Option B: Self-Hosted Worker / Service

Runs as a user-owned hosted job, for example on Cloudflare Workers plus durable storage in the user's Cloudflare account.

- Best engine for automatic sync.
- Gives scheduled runs, durable state, and a clean OAuth onboarding flow.
- Keeps tokens and sync state in infrastructure controlled by the user.
- Needs careful secret storage, account linking, rate limiting, and a UI/setup flow.
- Should sit behind the addon, not replace it as the user's entrypoint.

## Option C: Stremio Addon

Runs as a Stremio addon manifest and exposes catalogs/resources to the client.

- Required product shape: users should install SYNCIO through Stremio like other addons.
- Best for native discovery, configuration, and optional visible sync/status surfaces.
- Not ideal as the only sync engine because addon requests are client-driven, while deep sync needs reliable background work.

## Current Recommendation

Build SYNCIO as an addon-first product backed by a self-hosted Cloudflare sync engine.

- The addon manifest is the installable Stremio entrypoint.
- The configure page links Stremio and Trakt accounts, stores user-level sync preferences, and guides creation of a user-owned Trakt application.
- The user-owned Worker performs scheduled sync, dedupe, OAuth refresh, and conflict handling.
- Production does not use a shared SYNCIO Trakt app and does not offer hosted-by-us sync.
- The local CLI remains a development harness for probes and regression tests.

This preserves the desired user experience while avoiding a fragile design where sync only runs when Stremio happens to request addon resources.
