# ADR 0013: Initial command object structure

- Status: accepted for test-host validation
- Date: 2026-09-11

## Context

Private real-device command PoC runs confirmed the first M7 Pro command
candidates for start, pause, continue, return, fan speed, deep cleaning, and
dust collection. The next development step is validating those commands through
the adapter object tree instead of the standalone PoC.

Commands mutate real robot state. They must therefore be explicit writable
objects, separated from read-only status, and they must not optimistically claim
that a physical target state has already been reached.

## Decision

Expose the confirmed command candidates as boolean ioBroker button states:

| State ID | Command |
| --- | --- |
| `commands.start` | start cleaning |
| `commands.pause` | pause cleaning |
| `commands.continue` | continue cleaning |
| `commands.return` | return to station |
| `commands.fan.quiet` | quiet fan mode |
| `commands.fan.standard` | standard fan mode |
| `commands.fan.strong` | strong fan mode |
| `commands.deepCleaning` | deep cleaning |
| `commands.collectDust` | dust collection |

An external write of `true` with `ack=false` sends exactly one command. The
adapter then resets the button to `false` with `ack=true`.

Expose command result metadata as read-only states:

- `commands.lastCommand`
- `commands.lastResult`
- `commands.lastError`
- `commands.lastExecution`

The adapter may set `capabilities.commands` to `true` only after selecting a
device whose product code and model match the verified M7 Pro target. Commands
are serialized so that only one command is in flight at a time.

## Consequences

The test host can now validate commands from normal ioBroker state writes. This
does not yet mean the command contract is release-ready: final failure
semantics, user-facing names, result enums, and command confirmation behavior
still need real-device adapter validation.

The status tree remains read-only. Command result states describe request
handling only; actual robot movement or fan state must still come from
subsequent status events.

## Alternatives Considered

Expose commands as strings or enums under a single `commands.command` state.
Rejected for the first adapter milestone because individual button states are
easier to test safely from ioBroker and avoid parsing arbitrary external text.

Keep commands only in the standalone PoC. Rejected because all first command
candidates have now passed private trigger validation and the next required
proof is adapter-level `ack` and result behavior.

## Validation

Automated tests must verify command request construction and object metadata.
Real-device validation must verify that each button sends one command, resets
the button, updates result metadata, and receives plausible follow-up status
events without logging private data.
