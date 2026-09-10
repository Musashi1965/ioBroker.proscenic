# ADR 0012: Command proof of concept before public controls

- Status: accepted for command validation
- Date: 2026-09-10

## Context

The read-only adapter can authenticate, discover the device, receive gateway
status events, and recover from observed gateway socket closure. The next
milestone is command validation, but commands mutate real robot state and must
not be exposed as public ioBroker states before real-device behavior and
confirmation semantics are known.

Unlicensed legacy references list candidate REST command endpoints for M7 Pro
behavior. They may inform independent test requirements but their source code
must not be copied, translated, or vendored.

## Decision

Create a separate private `tools/command-poc` utility for individual command
tests. The existing `tools/protocol-poc` remains read-only.

The command PoC:

- authenticates and selects one device using the existing legacy cloud flow;
- supports only the first command candidates `start`, `pause`, `continue`, and
  `return`;
- defaults to dry-run behavior and requires `--confirm` before sending exactly
  one command;
- prints only redacted-safe execution summaries;
- must not print or persist password, token, serial number, gateway endpoint,
  map data, raw payload, private account data, or private device names.

The public adapter must not expose writable command states until each command
has separate real-device evidence for trigger behavior, resulting status
transition, failure behavior, and acknowledgement/result semantics.

## Consequences

Command testing can proceed safely without prematurely expanding the public
ioBroker object contract. The first adapter command implementation can later
reuse independently validated behavior behind typed project interfaces.

The first command candidates are not yet adapter features. They remain PoC
candidates until validation is recorded.

## Alternatives Considered

Add writable adapter states immediately. Rejected because the command behavior
and confirmation path are not yet proven.

Mix command sending into the existing read-only protocol PoC. Rejected because
it would weaken the read-only safety boundary that is already documented and
useful.

## Validation

Automated tests must cover command request construction without live
credentials. Real-device validation must be private and redacted and must
record one command at a time.
