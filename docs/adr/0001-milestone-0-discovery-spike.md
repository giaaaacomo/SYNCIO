# ADR 0001: Start With a Discovery Spike

## Status

Accepted.

## Context

The hardest risk in SYNCIO is not Trakt. It is writing Stremio account state through integration surfaces that are not the stable public Addon SDK contract.

## Decision

Build Milestone 0 first: small probes under `research/` that verify Stremio auth, datastore, watched-state, rating, no-catalog manifest, Cinemeta episode IDs, and Trakt pagination behavior.

Do not build the production sync engine until these probes produce findings from dedicated test accounts.

## Consequences

- We can learn without coupling the future architecture to wrong assumptions.
- Any account-mutating action must require `--apply`.
- Findings will be recorded in `research/FINDINGS.md`.
