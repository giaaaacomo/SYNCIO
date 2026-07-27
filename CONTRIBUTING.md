# Contributing

SYNCIO is a technical beta built around conservative account writes. Small, well-tested changes are preferred.

## Before Opening A Change

- Use a separate Stremio and Trakt test account for integration work.
- Never commit auth keys, OAuth tokens, passwords, setup tokens, Worker secrets, or raw account exports.
- Open an issue before changing sync semantics, undocumented Stremio contracts, storage schema, or removal behavior.
- Keep removals disabled unless a separate design and acceptance plan has been approved.

## Local Checks

Use Node.js 22 and pnpm 10:

```sh
corepack pnpm install
corepack pnpm run deploy:check
corepack pnpm run worker:typecheck
corepack pnpm run worker:test
corepack pnpm run typecheck
corepack pnpm test
corepack pnpm exec wrangler deploy --dry-run
```

New D1 schema changes require a forward-only migration under `migrations/`. Sync behavior changes require focused planner/apply tests and an update to the relevant ADR or acceptance evidence.

## Pull Requests

Describe:

- the user-visible behavior;
- the safety and privacy impact;
- tests performed;
- migration or deployment implications;
- any real-client validation still needed.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
