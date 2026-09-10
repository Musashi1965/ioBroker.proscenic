# ADR 0006: Initial Read-Only Status Candidates

- Status: proposed
- Date: 2026-09-10

## Context

The read-only protocol PoC received and decrypted an `infoType` 20001 gateway
event from one real Proscenic M7 Pro. The event exposes status-like fields, but
the project has not yet verified every field's exact user-visible meaning,
range, unit, enum values, or change behavior.

The ioBroker object tree is a public API. State IDs, value types, roles, write
semantics, units, and ranges must be stable once released. Therefore the first
adapter skeleton may project only a minimal set of fields whose semantics are
clear enough for read-only use.

## Decision

Use the following observed `infoType` 20001 fields as candidates for the first
read-only status contract. These IDs are not accepted until this ADR is moved
from proposed to accepted after value-level real-device verification.

| Upstream field | Candidate state ID | Type | Role | Unit | Confidence | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `cleanArea` | `status.clean.area` | number | `value` | `m2` | candidate | Cleaning area; unit needs app comparison. |
| `cleanTime` | `status.clean.time` | number | `value` | `min` | candidate | Cleaning time; unit needs app comparison. |
| `allArea` | `status.clean.totalArea` | number | `value` | `m2` | candidate | Likely accumulated area; exact meaning pending. |
| `allTime` | `status.clean.totalTime` | number | `value` | `min` | candidate | Likely accumulated time; exact meaning pending. |
| `elec` | `status.battery.percent` | number | `value.battery` | `%` | candidate | Likely displayed battery percentage. |
| `elecReal` | `status.battery.rawPercent` | number | `value.battery` | `%` | candidate | Second battery-like value; public value pending. |
| `mode` | `status.mode` | string | `state` |  | observed | Mode string; enum values pending. |
| `subMode` | `status.subMode` | string | `state` |  | observed | Sub-mode string; enum values pending. |
| `water` | `status.water.level` | number | `level` |  | candidate | Likely mopping water level; range pending. |
| `mop` | `status.mop.mode` | number | `state` |  | candidate | Mopping-related mode; semantics pending. |
| `workNoisy` | `status.fan.mode` | string | `state` |  | candidate | Likely suction/fan mode; enum values pending. |
| `errorState` | `status.error.rawCount` | number | `value` |  | candidate | Expose only derived count initially, not raw vendor error array. |
| `autoBoost` | `status.features.autoBoost` | boolean | `indicator` |  | observed | Boolean feature/status flag; label pending. |
| `cleanComponents` | `status.features.cleanComponents` | boolean | `indicator` |  | observed | Boolean feature/status flag; label pending. |

Do not expose position arrays, timestamps, vendor counters, forbidden-mode
internals, workstation details, or undocumented raw JSON in the first public
contract.

All accepted states will be read-only and published with `ack=true`. Commands
remain out of scope for this ADR.

## Consequences

The first adapter milestone can focus on authentication, connection state, and
a small read-only status surface. The project avoids mirroring the whole vendor
payload and can add fields later with tests and migration notes.

Fields with uncertain meanings may remain internal to the protocol layer until
their semantics are confirmed. This keeps the future object tree smaller and
less surprising.

## Alternatives Considered

Expose every observed `infoType` 20001 key as a state. Rejected because it would
turn an undocumented vendor payload into the public ioBroker API and increase
privacy and migration risk.

Expose no device status until every field is fully understood. Rejected because
the observed event is already enough to start validating a minimal read-only
surface behind a proposed ADR.

## Validation

Before accepting this ADR, verify candidate values against the Proscenic app
during at least these states:

- docked/charging;
- idle;
- active cleaning;
- returning to dock;
- a low-risk error or unavailable condition, if it occurs naturally.

Record only redacted field names, types, enum labels, and semantic conclusions.
Do not record raw maps, serial numbers, gateway endpoints, or complete payloads.
