# ADR 0017: Consumables and message history objects

- Status: accepted for local development
- Date: 2026-09-14

## Context

Owner-local reverse engineering and real-device probes verified two additional
read paths for the M7 Pro legacy backend:

- `POST /instructions/cmd21015/{sn}` requests consumable counters; the values
  arrive asynchronously as gateway `infoType` 21015.
- `POST /app/cleanRobot/20003/{sn}` returns the first page of the maintenance
  and device message history.

Static application inspection also recovered the `21016` reset request shape.
No reset has yet been sent to the real device, so the implementation remains a
local-development candidate and must not be described as real-device verified.

## Decision

Expose the verified consumable counters under a dedicated read-only
`consumables.*` object tree:

- `consumables.filter.usedSeconds`;
- `consumables.filter.intervalHours`;
- `consumables.filter.remainingPercent`;
- `consumables.filter.overdueHours`;
- `consumables.sideBrush.usedSeconds`;
- `consumables.sideBrush.intervalHours`;
- `consumables.sideBrush.remainingPercent`;
- `consumables.sideBrush.overdueHours`;
- `consumables.mainBrush.usedSeconds`;
- `consumables.mainBrush.intervalHours`;
- `consumables.mainBrush.remainingPercent`;
- `consumables.mainBrush.overdueHours`;
- `consumables.sensors.usedSeconds`;
- `consumables.sensors.intervalHours`;
- `consumables.sensors.remainingPercent`;
- `consumables.sensors.overdueHours`;
- `consumables.updated`;
- `consumables.lastReadResult`;
- `consumables.lastError`.

The four verified counters are interpreted as used seconds. Nominal intervals
are 150 hours for the filter, 200 hours for the side brush, 300 hours for the
main brush, and 30 hours for sensors. `remainingPercent` may be negative when a
maintenance interval is exceeded. `overdueHours` is a non-negative derived
diagnostic. The derived percentage and overdue-hour values are rounded to two
decimal places for object-tree readability; `usedSeconds` remains the unchanged
integer counter. The additional upstream `battery` field in `21015` is not
exposed because its meaning is not verified.

Expose the current maintenance message history under a read-only
`status.maintenance.history.*` object tree:

- `status.maintenance.history.items`;
- `status.maintenance.history.count`;
- `status.maintenance.history.totalCount`;
- `status.maintenance.history.latestCode`;
- `status.maintenance.history.latestLevel`;
- `status.maintenance.history.latestMessage`;
- `status.maintenance.history.latestEventTime`;
- `status.maintenance.history.updated`;
- `status.maintenance.history.lastReadResult`;
- `status.maintenance.history.lastError`.

`history.items` is a bounded JSON array containing only redacted, safe fields:
`code`, `level`, `title`, `message`, and `eventTime` when present. It must not
include serial numbers, account names, backend IDs, tenant IDs, or raw upstream
objects.

The existing `status.maintenance.eventCount` remains a live gateway event
counter. REST history refreshes must not increment it, because reconnects would
otherwise count the same historical messages repeatedly. REST history refreshes
also must not write `status.maintenance.code`, `status.maintenance.level`,
`status.maintenance.message`, or `status.maintenance.updated`; those states are
reserved for live gateway `20003` events and status-derived diagnostics.

The adapter also exposes:

- `capabilities.consumables`;
- `capabilities.consumableReset`;
- `capabilities.maintenanceMessages`.

Expose four write-only boolean reset buttons:

- `consumables.filter.reset`;
- `consumables.sideBrush.reset`;
- `consumables.mainBrush.reset`;
- `consumables.sensors.reset`.

Expose transaction diagnostics under `consumables.reset.*`:

- `lastComponent`;
- `lastResult`;
- `lastError`;
- `lastExecution`.

A reset is never a direct fire-and-forget write. It is serialized with normal
robot commands and performs one complete transaction:

1. request a fresh `21015` snapshot;
2. require the complete observed integer field set `filter`, `mainBrush`,
   `sideBrush`, `sensors`, and `battery`;
3. copy the snapshot and set only the selected component to zero;
4. send JSON to `POST /instructions/cmd21016/{sn}?username=...`;
5. require an asynchronous `21016` event in which the selected counter is zero
   and every non-selected counter is unchanged;
6. request another `21015` snapshot and require exact equality with the
   confirmed reset result.

The adapter rejects snapshots with missing or additional fields instead of
reflecting unknown data into the write request, and does not automatically
retry a reset. If the selected counter is already zero, the fresh read
completes the transaction with `already-zero` without sending `21016`.
`capabilities.consumableReset` becomes true only after a complete, safe
snapshot has been observed for the verified M7 Pro target and is cleared when
the command session is discarded.

After a gateway connection is established, the adapter may trigger both verified
read paths, but no more often than once every 15 minutes. The consumable REST
acknowledgement is not treated as data; the adapter waits for a bounded `21015`
gateway event and keeps the previous values when the event is not received. The
message-history request is bounded to the first page of ten items for now. This
throttle prevents short-lived gateway reconnect loops from repeatedly hitting
the legacy cloud with auxiliary read requests.

Historical messages do not by themselves set or clear
`status.maintenance.hasWarning`. Active warning semantics remain a separate
decision because current cloud texts and older Android code tables conflict for
some message codes.

## Consequences

VIS and object-tree users can inspect consumable runtime, remaining percentage,
overdue hours, and recent device messages without private raw protocol data.
The values update after a successful connection and after any future received
`21015` event.

The reset buttons provide an auditable result instead of treating HTTP success
as physical confirmation. Until a controlled single-component real-device test
has confirmed the `21016` echo and `21015` persistence read, they remain a
development candidate rather than a released support claim. Adding the states
is backward-compatible; rollback removes the new button, capability, and
diagnostic objects without changing the existing counter states.

The object tree now contains more owner-specific operational data. It is safe
for the local development adapter but must be described carefully before public
release.

## Alternatives Considered

Expose the unverified `21015.battery` value. Rejected because it could be
misread as battery charge, battery health, or another stable user-facing
metric.

Expose raw message-history JSON. Rejected because it includes private backend
metadata and would turn an internal protocol shape into public API.

Treat `level=1` or code `6132` as an active warning. Rejected because live
backend text and older app dictionaries disagree, and ordinary dust-collection
events share the same observed level.

## Validation

Unit tests cover consumable normalization, complete reset snapshots, request
construction, unchanged-counter validation, negative remaining percentages,
message-history redaction, object definitions, projection, and read-failure
states. Full adapter checks are required because this changes runtime protocol
behavior and public objects. Real-device acceptance requires one selected
counter to reset to zero, all other counters to remain unchanged, and the same
values to persist in a subsequent `21015` read.
