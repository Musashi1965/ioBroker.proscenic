# ADR 0002: Legacy Cloud Protocol Strategy

- Status: accepted for read-only PoC; production adoption pending
- Date: 2026-09-10

## Context

Public reverse-engineering references document two materially different paths:
legacy Proscenic cloud/gateway behavior and Tuya-local behavior. The tested M7
Pro account authenticates against the legacy European Proscenic endpoint and
enumerates as `M7_PRO` / `811_LDS`. The Tuya OEM diagnostic did not authenticate
against this account.

Relevant legacy reference repositories have no identified license. Tuya-local
Home Assistant references are GPL-3.0.

## Decision

Implement an independent, read-only legacy-cloud PoC first. Separate:

- bounded HTTPS authentication/device/gateway requests;
- gateway TCP connection, framing, decryption, and validation;
- normalized domain status and stable errors;
- lifecycle/reconnect/cleanup;
- later ioBroker projection.

Do not port or translate reference source. Do not send device commands in the
read-only milestone. Production adoption requires the proofs listed in
`docs/UPSTREAM_RESEARCH.md`.

Treat the cloud API as undocumented and potentially unstable. Keep it behind a
project-owned backend interface so a future verified backend does not leak into
the public object contract.

## Consequences

The first adapter remains cloud-dependent. Vendor changes may break it, so
timeouts, redacted diagnostics, session renewal, and explicit availability are
mandatory. Local Tuya support is neither promised nor excluded permanently.

## Validation

Login, token issuance, and device enumeration passed on one real M7 Pro. Gateway
status and every command remain pending.
