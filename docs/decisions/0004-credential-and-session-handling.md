# ADR 0004: Credential And Session Handling

- Status: accepted for initial implementation
- Date: 2026-09-10

## Context

The legacy API requires an account identifier and password and returns a bearer
token used for device and gateway access. Account data, tokens, and serial
numbers can expose the user's installation. Public references and early tools
have printed these values, which is unacceptable for the adapter.

## Decision

When Admin configuration is implemented:

- store account and password only in adapter native configuration;
- include both fields in ioBroker `protectedNative` and `encryptedNative`;
- use a password-type Admin field and never echo an existing secret into logs or
  message responses;
- hold the session token and raw device serial in memory only;
- never expose password, token, authorization headers, serial, gateway address,
  or map payload in ordinary ioBroker states;
- redact secrets and sensitive query/body fields before constructing any log or
  error;
- clear active session material and abort requests/sockets on unload;
- use TLS certificate validation and never adopt `curl -k`/verification bypass;
- persist no token unless a later ADR documents encryption, expiry, migration,
  deletion, backup/restore, and tests.

PoC credentials remain outside the repository in an owner-only private location
on the test host. PoC code must read them interactively or from an ignored,
permission-restricted source and must never print them.

## Consequences

Restart requires reauthentication, which is acceptable until token behavior is
measured. Other adapters cannot casually read protected configuration fields,
and stored values are encrypted by ioBroker.

## Validation

The future implementation must test native metadata, redaction, absence of
secrets in states/logs/errors, authentication failure, unload cleanup, and
package/history hygiene. Real-device verification must use redacted output.
