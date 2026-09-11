# ADR 0006: Initial Read-Only Status Candidates

- Status: proposed
- Date: 2026-09-10

## Context

The read-only protocol PoC received and decrypted repeated `infoType` 20001
gateway events from one real Proscenic M7 Pro, including during active
cleaning, pause, return-to-dock, and docked/charging states. The event exposes
status-like fields, but the project has not yet verified every field's exact
user-visible meaning, range, unit, enum values, or change behavior.

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
| `cleanTime` | `status.clean.time` | number | `value` | `s` | observed | Current or last cleaning time in seconds. |
| `allArea` | `status.clean.totalArea` | number | `value` |  | candidate | Likely accumulated area; exact meaning and scale pending. |
| `allTime` | `status.clean.totalTime` | number | `value` | `s` | candidate | Likely accumulated time in seconds; exact meaning pending. |
| `elec` | `status.battery.percent` | number | `value.battery` | `%` | candidate | Likely displayed battery percentage. |
| `elecReal` | `status.battery.rawPercent` | number | `value.battery` | `%` | candidate | Second battery-like value; public value pending. |
| `mode` | `status.mode` | string | `state` |  | candidate | Observed values include `charge`, `sweep`, `pause`, `backcharge`, and `dormant`; not reliable enough by itself as app-equivalent activity state. |
| `subMode` | `status.subMode` | string | `state` |  | observed | Observed values: `total`, literal string `null`. |
| `water` | `status.water.level` | number | `level` |  | candidate | Likely mopping water level; range pending. |
| `mop` | `status.mop.mode` | number | `state` |  | candidate | Mopping-related mode; semantics pending. |
| `workNoisy` | `status.fan.mode` | string | `state` |  | candidate | Likely suction/fan mode; enum values pending. |
| `errorState` | `status.error.rawCount` | number | `value` |  | candidate | Expose only derived count initially, not raw vendor error array. |
| `autoBoost` | `status.features.autoBoost` | boolean | `indicator` |  | observed | Boolean feature/status flag; label pending. |
| `cleanComponents` | `status.features.cleanComponents` | boolean | `indicator` |  | observed | Boolean feature/status flag; label pending. |

Do not expose position arrays, timestamps, vendor counters, forbidden-mode
internals, workstation details, or undocumented raw JSON in the first public
contract.

Observed `infoType` 20001 fields that remain intentionally excluded from the
candidate public contract include `cleanMode`, `dustCenterFreq`,
`isInForbidMode`, `ldAvoidCollide`, `mute`, `phi`, `pos`, `reliable`,
`timeStamp`, `vol`, and `workstationType`.

Observed state transitions include:

- `sweep` with `subMode` `total` during cleaning;
- `pause` with `subMode` `total` after pausing a cleaning run;
- `backcharge` with `subMode` `total` while returning to the dock;
- `charge` with literal `subMode` string `null` after docking.

`cleanTime` increased in short cleaning runs using second-scale values and
remained stable after docking, so the candidate unit is seconds. `cleanArea`
increased during cleaning and remained stable after docking; square meters are
plausible but still require comparison with the app before acceptance.

Self-emptying or self-cleaning did not start during the observed dock test, so
no dust-bin or station operation state is accepted by this ADR.

Later command PoC validation confirmed dust collection behavior, including a
case where `collect-dust` was triggered during active cleaning and the robot
returned to the station before continuing cleaning. This confirms command
trigger behavior, but not a public station-operation status field.

The Proscenic app displayed a maintenance warning equivalent to "dust bag full,
please replace". The public object contract needs a maintenance/warning area,
but this ADR does not yet accept a concrete state because the project has not
identified whether the safe source is `errorState`, a station-related field,
or another cloud/app data source.

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
during at least these remaining states:

- idle;
- a low-risk error or unavailable condition, if it occurs naturally.

Active cleaning, pause, return-to-dock, and docked/charging have produced
redacted `infoType` 20001 value observations. A later adapter observation found
`status.mode` stuck at `dormant` despite visible robot activity, so the
accepted contract must either derive a separate app-equivalent activity state
or clearly label `mode` as raw/candidate upstream state. Before accepting this
ADR, compare the proposed public fields with the Proscenic app labels and
ranges.

Record only redacted field names, types, enum labels, and semantic conclusions.
Do not record raw maps, serial numbers, gateway endpoints, or complete payloads.
