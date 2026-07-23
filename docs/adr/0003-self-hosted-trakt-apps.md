# ADR 0003: Self-Hosted Trakt Applications

## Status

Superseded by ADR 0005 for the default onboarding path. Direct OAuth remains an accepted fallback.

## Context

SYNCIO needs Trakt API credentials to read and write watched history, ratings, and watchlist data.

Using one shared SYNCIO Trakt application would make onboarding shorter, but it would also put our app credentials, rate limits, support burden, and abuse surface in the middle of every user's sync. The project direction is not to offer a hosted-by-us service.

## Decision

SYNCIO production onboarding will require each user to create their own Trakt application and deploy their own Cloudflare Worker + D1 instance.

The Worker stores that installation's Trakt app credentials, Stremio auth material, Trakt OAuth tokens, sync settings, and sync ledger only inside the user's own Cloudflare account. Values that can authenticate a user or app are encrypted by the Worker before being written to D1.

## Consequences

- We do not operate shared infrastructure that receives or stores user tokens.
- We do not need a shared Trakt client id or client secret in production.
- Onboarding has one extra guided step: create a Trakt app and paste its credentials into the SYNCIO configure flow.
- The configure flow must make this step nearly one-click with clear links, copied redirect URLs, validation, and redacted status.
- A user can revoke access by deleting their own Trakt app, revoking Trakt OAuth, deleting Worker secrets, or deleting the Cloudflare project.
