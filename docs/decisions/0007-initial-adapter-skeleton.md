# ADR 0007: Initial adapter skeleton

- Status: accepted
- Date: 2026-09-10

## Context

The project needed to move from documentation and read-only protocol PoC work
to an installable ioBroker adapter foundation without importing code from the
behavioral reference repositories.

## Decision

Generate the initial adapter skeleton with `@iobroker/create-adapter` 3.1.5 and
commit the replay answers in `.create-adapter.json` without machine-specific
paths.

The skeleton uses:

- TypeScript with a build step;
- JSON Config for the initial Admin UI;
- Node.js 22 as the minimum supported runtime;
- `household` adapter type;
- `cloud` connection type;
- `push` data source;
- `info.connection` as the initial connection indicator;
- MIT license;
- no Dependabot configuration by default;
- routine adapter-test CI on Linux, Windows, and macOS with Node.js 22, 24, and
  26.

The initial Admin configuration exposes only non-command setup fields:

- `region`;
- `vendor`;
- `username`;
- `password`;
- `deviceCode`.

The `password` native field is listed in both `common.protectedNative` and
`common.encryptedNative`. Runtime code must not log credentials, tokens, serial
numbers, gateway endpoints, map data, positions, or raw payloads.

## Consequences

The generated adapter can provide normal ioBroker project structure, package
metadata, CI, build, lint, type-check, package tests, and integration-test
entry points.

The skeleton deliberately does not wire in the Proscenic protocol PoC yet. That
keeps the first adapter commit low-risk and prevents unreviewed public state
IDs or command semantics from becoming part of the adapter API.

Dependabot or similar dependency-update automation can be added later by an
explicit decision when the branch/PR policy is settled.

## Alternatives Considered

- Copying another adapter skeleton was rejected because the project rules call
  for the current official ioBroker generator as the baseline.
- Wiring the protocol PoC immediately was rejected for this step because the
  public state contract and lifecycle boundaries still need a dedicated review.

## Validation

The skeleton must pass the repository `check:full` quality gate before it is
committed.
