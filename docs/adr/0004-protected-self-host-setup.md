# ADR 0004: Protected Self-Host Setup

## Status

Accepted.

## Context

A deployed Cloudflare Worker has a public URL. Knowing that URL must not be enough to replace Trakt credentials, connect a different account, or change sync settings.

## Decision

All `/api/setup/*` routes require a separate high-entropy `SYNCIO_SETUP_TOKEN` stored as a Cloudflare Worker secret. The configure page keeps the entered token only in browser `sessionStorage` and sends it in the `Authorization` header.

The encryption key remains server-side and is never accepted from or returned to the browser. Public addon, health, and status routes do not expose linked account identifiers or active OAuth codes.

## Consequences

- A leaked Worker URL does not grant setup access.
- The setup token and encryption key must be generated independently.
- Opening setup in a new browser session requires entering the setup token again.
- Account credentials, OAuth device codes, and tokens remain encrypted at rest in the user's D1 database.
