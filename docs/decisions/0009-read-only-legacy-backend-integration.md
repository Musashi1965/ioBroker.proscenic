# ADR 0009: Read-only legacy backend integration

- Status: accepted for first adapter milestone
- Date: 2026-09-10

## Context

The adapter skeleton exists and the private PoC has verified the legacy
Proscenic cloud and gateway path on one M7 Pro. The next milestone is a real
adapter runtime that can use the configured credentials without publishing
private installation data.

## Decision

Wire the first read-only backend into the adapter runtime:

- create the initial object structure idempotently on startup;
- authenticate against the legacy European Proscenic cloud with bounded HTTPS
  requests;
- enumerate devices and select the configured `deviceCode`;
- keep token and serial number in memory only;
- discover a gateway endpoint but never expose or log it;
- connect to the gateway socket, send the verified handshake, split frames,
  decrypt encrypted events, and normalize `infoType` 20001 status values;
- project only the ADR 0008 read-only object structure with `ack=true`;
- mark `info.connection` true only when the gateway connection is established;
- clear the gateway socket on unload;
- redact account, host, IP, and endpoint material before writing error states
  or logs.

The first implementation does not add reconnect loops, command execution,
maps, multi-device identity, or local Tuya support.

## Consequences

The adapter can now be installed in a private test environment and checked
against live status events. It is still not release-ready because reconnect
behavior, token renewal, detailed status semantics, command confirmation,
multi-device behavior, and map policy remain pending.

The gateway implementation is intentionally small and bounded. If the gateway
closes, the adapter marks the gateway connection offline instead of silently
claiming an online state.

## Validation

Automated tests must cover status normalization, frame decryption, read-only
object metadata, and redaction. Public CI and integration tests must pass
without live credentials. Real-device verification stays private and redacted.
