# ADR 0005: Stremio-Delegated Trakt Transport

## Status

Accepted for the technical preview.

## Context

Trakt limits non-VIP connected community applications. Requiring every SYNCIO installation to authorize another application can force a user to revoke an existing grandfathered connection.

Stremio stores the Trakt authorization connected to a Stremio account and exposes the current grant through its authenticated account response. Trakt access tokens are bound to the OAuth client that issued them, so this grant works only with Stremio's public Trakt client identity.

This is account API behavior, not part of the public Stremio addon protocol. Stremio can change or remove it.

## Decision

The default SYNCIO transport is `stremio-delegated`.

For every preview or apply, the user's Worker:

1. decrypts its stored Stremio auth key;
2. requests the current Stremio account record;
3. verifies the immutable Stremio user id;
4. extracts only the current Trakt access token and expiry;
5. calls Trakt with Stremio's public OAuth client id;
6. verifies the Trakt username against the value explicitly entered during setup;
7. keeps the access token only in memory for that run.

SYNCIO never extracts, returns, logs, or stores Stremio's Trakt refresh token. Enabling delegated mode deletes direct Trakt OAuth tokens previously stored by SYNCIO.

Direct OAuth remains available as a fallback for users who can create and connect their own Trakt application.

## Consequences

- Delegated mode consumes no additional Trakt connected-app slot.
- SYNCIO requests count against Stremio's Trakt application traffic and rate limits.
- There is no interception, packet proxy, or man-in-the-middle component. SYNCIO is a second API client using the authorization exposed to the authenticated Stremio account.
- Account mismatches fail before synchronization writes.
- Missing, stale, or near-expiry Stremio grants fail closed. The user may need to reconnect Trakt inside Stremio.
- A Stremio or Trakt policy change can break delegated mode. Direct OAuth remains the recovery path.
