# ADR 0001: Project Identity And Initial Scope

- Status: accepted
- Date: 2026-09-10

## Context

The project is intended to become a public ioBroker adapter. Repository, npm,
adapter, namespace, license, and first supported hardware must be consistent
before code and public objects are created.

## Decision

Use:

- product: `Proscenic`;
- GitHub repository: `ioBroker.proscenic`;
- npm package: `iobroker.proscenic`;
- adapter ID: `proscenic`;
- namespace: `proscenic.<instance>`;
- implementation: TypeScript/Node.js;
- original project license: MIT.

The first hardware/backend target is the legacy-cloud Proscenic M7 Pro with
product code `M7_PRO` and model `811_LDS`. Other models and Tuya-local control
remain unsupported until separately proven.

## Consequences

The adapter can later add verified models/backends behind internal interfaces
without renaming its public identity. The broad brand name requires careful
capability and compatibility claims.

## Validation

A private real-device probe verified legacy authentication and enumeration of
one matching M7 Pro. No installable adapter exists yet.
