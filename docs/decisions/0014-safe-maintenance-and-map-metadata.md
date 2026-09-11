# ADR 0014: Safe maintenance diagnostics and map metadata

- Status: proposed
- Date: 2026-09-11

## Context

Private real-device observations found two next adapter needs after command
validation:

- the Proscenic app can show maintenance warnings such as a full dust bag while
  the adapter only exposed a derived warning count;
- `infoType` 20002 carries map-related data that is useful for later map
  integration, but raw maps, paths, positions, room layout, serial numbers, and
  station coordinates are private.

The repository is MIT-licensed and must not copy unlicensed or GPL integration
code. Upstream projects are behavioral references only. The public ioBroker
object tree must also avoid exposing private home-layout data by accident.

## Decision

Expose only safe, derived maintenance and map information in the adapter:

- `status.maintenance.details` stores a bounded, redacted diagnostic summary of
  up to five entries from `errorState`. It keeps non-sensitive scalar fields and
  field names, but excludes keys that look like serials, accounts, addresses,
  maps, positions, paths, or endpoints.
- `map.*` stores metadata from `infoType` 20002 only:
  - `map.available`;
  - `map.id`;
  - `map.pathId`;
  - `map.width`;
  - `map.height`;
  - `map.resolution`;
  - `map.areaCount`;
  - `map.compressedBytes`;
  - `map.encodedBytes`;
  - `map.updated`.

Do not expose or persist the raw base64 map, decompressed map image, robot
position, path coordinates, charger/station coordinates, serial number, or
complete 20002 payload in public states, tests, fixtures, logs, commits, or
release artifacts.

The map capability state may become `true` when safe metadata is observed. This
does not imply public map image rendering support.

## Consequences

The adapter gains enough safe signal to diagnose maintenance/warning payloads
and build the next map work without committing private home data. Public map
image rendering remains a separate decision that must define local-only storage,
redaction, object IDs, update frequency, and retention.

`status.maintenance.details` is diagnostic, not a localized user-facing
translation. It must not claim that an unknown warning means "dust bag full"
until the exact mapping is proven with private redacted evidence.

## Alternatives Considered

Expose raw `errorState` and raw 20002 map data. Rejected because that would
publish private vendor data and home-layout information as part of the public
ioBroker API.

Ignore 20002 until full map rendering is implemented. Rejected because metadata
is low-risk and helps validate dimensions, map/path changes, and update timing.

## Validation

Unit tests must cover redaction and the absence of raw map/private fields from
normalization. Object definition tests must continue to reject raw map, image,
position, serial, and gateway endpoint states. Full adapter checks are required
because this changes public states and gateway event handling.
