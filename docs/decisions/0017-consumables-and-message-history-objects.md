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

Both paths are read-only in the implemented adapter flow. The counter-reset
operation `21016` remains untested and must not be exposed.

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
- `capabilities.maintenanceMessages`.

After a gateway connection is established, the adapter triggers both verified
read paths once per connection attempt. The consumable REST acknowledgement is
not treated as data; the adapter waits for a bounded `21015` gateway event and
keeps the previous values when the event is not received. The message-history
request is bounded to the first page of ten items for now.

Historical messages do not by themselves set or clear
`status.maintenance.hasWarning`. Active warning semantics remain a separate
decision because current cloud texts and older Android code tables conflict for
some message codes.

## Consequences

VIS and object-tree users can inspect consumable runtime, remaining percentage,
overdue hours, and recent device messages without private raw protocol data.
The values update after a successful connection and after any future received
`21015` event.

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

Unit tests cover consumable normalization, negative remaining percentages,
message-history redaction, object definitions, projection, and read-failure
states. Full adapter checks are required because this changes runtime protocol
behavior and public objects.
