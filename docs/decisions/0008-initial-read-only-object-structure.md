# ADR 0008: Initial read-only object structure

- Status: accepted for first adapter milestone
- Date: 2026-09-10

## Context

The read-only PoC has verified legacy Proscenic authentication, device
enumeration, gateway discovery, gateway socket framing, decryption, and
`infoType` 20001 status events on one real Proscenic M7 Pro.

The project now needs the first real adapter implementation. Using live values
is useful for development, but raw payloads, maps, positions, serial numbers,
gateway endpoints, tokens, and account data must stay out of public states,
logs, tests, and commits.

## Decision

Implement the first adapter object structure as read-only projection for the
single selected robot represented by the instance. Do not use the vendor serial
number, gateway address, map ID, map payload, position, or device display name
as public object identity.

Top-level object groups:

- `device.*`: non-secret selected-device metadata;
- `connection.*`: redacted cloud/gateway connection health;
- `capabilities.*`: booleans for features that are actually exposed;
- `status.*`: normalized read-only status from verified gateway events;
- `commands.*`: confirmed command test buttons and read-only command result
  metadata, as defined by ADR 0013;
- `map.*`: safe `infoType` 20002 metadata only, as defined by ADR 0014.

Initial states:

| State ID | Type | Role | Unit | Source |
| --- | --- | --- | --- | --- |
| `device.code` | string | `info.name` |  | selected cloud device code with `PROSCENIC` display prefix |
| `device.model` | string | `info.name` |  | selected cloud device |
| `device.online` | boolean | `indicator.reachable` |  | selected cloud device |
| `device.image` | string | `text` |  | bundled product image for verified M7 Pro |
| `connection.cloud` | boolean | `indicator.connected` |  | login/device discovery |
| `connection.gateway` | boolean | `indicator.connected` |  | gateway socket |
| `connection.lastError` | string | `text` |  | redacted adapter error |
| `connection.lastStatusEvent` | string | `date` |  | last accepted status event |
| `capabilities.statusRead` | boolean | `indicator` |  | implementation capability |
| `capabilities.commands` | boolean | `indicator` |  | implementation capability |
| `capabilities.maps` | boolean | `indicator` |  | implementation capability |
| `capabilities.consumables` | boolean | `indicator` |  | verified `21015` read capability |
| `capabilities.maintenanceMessages` | boolean | `indicator` |  | verified REST `20003` history capability |
| `consumables.<component>.usedSeconds` | number | `value` | `s` | `infoType` 21015 |
| `consumables.<component>.intervalHours` | number | `value` | `h` | verified app interval |
| `consumables.<component>.remainingPercent` | number | `value` | `%` | derived from used seconds |
| `consumables.<component>.overdueHours` | number | `value` | `h` | derived from used seconds |
| `consumables.updated` | string | `date` |  | latest accepted `infoType` 21015 event |
| `consumables.lastReadResult` | string | `text` |  | `21015` refresh result |
| `consumables.lastError` | string | `text` |  | redacted `21015` refresh error |
| `status.mode` | string | `state` |  | `infoType` 20001 |
| `status.subMode` | string | `state` |  | `infoType` 20001 |
| `status.clean.area` | number | `value` | `m²` | `infoType` 20001 |
| `status.clean.time` | number | `value` | `s` | `infoType` 20001 |
| `status.clean.totalArea` | number | `value` |  | `infoType` 20001 |
| `status.clean.totalTime` | number | `value` | `s` | `infoType` 20001 |
| `status.battery.percent` | number | `value.battery` | `%` | `infoType` 20001 |
| `status.battery.rawPercent` | number | `value.battery` | `%` | `infoType` 20001 |
| `status.water.level` | number | `level` |  | `infoType` 20001 |
| `status.mop.mode` | number | `state` |  | `infoType` 20001 |
| `status.fan.mode` | string | `state` |  | `infoType` 20001 |
| `status.error.rawCount` | number | `value` |  | derived from `errorState` |
| `status.features.autoBoost` | boolean | `indicator` |  | `infoType` 20001 |
| `status.features.cleanComponents` | boolean | `indicator` |  | `infoType` 20001 |
| `status.maintenance.hasWarning` | boolean | `indicator` |  | derived from `errorState` |
| `status.maintenance.warningCount` | number | `value` |  | derived from `errorState` |
| `status.maintenance.code` | number | `value` |  | latest `infoType` 20003 event code |
| `status.maintenance.level` | number | `value` |  | latest `infoType` 20003 event level |
| `status.maintenance.message` | string | `text` |  | generic maintenance warning or latest `infoType` 20003 message |
| `status.maintenance.details` | string | `text` |  | redacted diagnostic summary |
| `status.maintenance.eventCount` | number | `value` |  | accepted `infoType` 20003 event count since adapter start |
| `status.maintenance.updated` | string | `date` |  | latest accepted `infoType` 20003 event |
| `status.maintenance.history.items` | string | `json` |  | bounded REST `20003` history |
| `status.maintenance.history.count` | number | `value` |  | safe history entries stored |
| `status.maintenance.history.totalCount` | number | `value` |  | backend-reported total when present |
| `status.maintenance.history.latestCode` | number | `value` |  | latest safe history entry code |
| `status.maintenance.history.latestLevel` | number | `value` |  | latest safe history entry level |
| `status.maintenance.history.latestMessage` | string | `text` |  | latest safe history entry message |
| `status.maintenance.history.latestEventTime` | string | `date` |  | latest safe history entry time |
| `status.maintenance.history.updated` | string | `date` |  | latest history read |
| `status.maintenance.history.lastReadResult` | string | `text` |  | history read result |
| `status.maintenance.history.lastError` | string | `text` |  | redacted history read error |
| `map.available` | boolean | `indicator` |  | derived from `infoType` 20002 |
| `map.id` | number | `value` |  | `infoType` 20002 metadata |
| `map.pathId` | number | `value` |  | `infoType` 20002 metadata |
| `map.width` | number | `value` |  | `infoType` 20002 metadata |
| `map.height` | number | `value` |  | `infoType` 20002 metadata |
| `map.resolution` | number | `value` |  | `infoType` 20002 metadata |
| `map.areaCount` | number | `value` |  | derived from `infoType` 20002 `area` length |
| `map.compressedBytes` | number | `value` | `B` | `infoType` 20002 metadata |
| `map.encodedBytes` | number | `value` | `B` | derived from encoded map length |
| `map.updated` | string | `date` |  | last safe map metadata update |

All states are read-only and are written by the adapter with `ack=true`.
Raw map objects, positions, raw events, and full upstream JSON remain out of
scope. Writable command buttons are now defined separately by ADR 0013.

## Consequences

The adapter can already validate a realistic object tree and project live
status values while keeping private data local and out of the repository.

Some value semantics remain candidate-level before public release. In
particular, `cleanArea`, `allArea`, `allTime`, `elec`, `elecReal`, `water`,
`mop`, `workNoisy`, and station-related behavior still need comparison against
the Proscenic app and additional real-device observations.

## Validation

Unit tests must verify status normalization and object metadata. Adapter
integration tests must continue to pass without live credentials. Real-device
verification remains private and redacted.
