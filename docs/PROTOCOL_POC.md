# Legacy Protocol Proof Of Concept

Status: read-only real gateway reception verified on one M7 Pro

The repository contains a small TypeScript proof of concept in
`tools/protocol-poc`. It exists to verify the undocumented legacy Proscenic
cloud and gateway behavior before the official ioBroker adapter skeleton is
generated.

## Scope

The PoC may:

- authenticate against the legacy European cloud endpoint;
- enumerate devices;
- select one M7 Pro device returned by the account;
- discover the gateway endpoint for that device;
- open a bounded TCP socket;
- send only the read-only `infoType` 70001 gateway handshake;
- receive delimited gateway frames;
- decrypt encrypted payloads with the memory-only token;
- print redacted event summaries;
- print candidate `infoType` 20001 status fields without live values.

The PoC must not:

- send robot commands;
- persist credentials, tokens, serial numbers, gateway endpoints, maps, or raw
  payloads;
- print passwords, tokens, serial numbers, gateway addresses, map payloads, or
  full upstream payloads;
- create ioBroker objects or claim adapter support;
- run as public CI because it requires a private account and a live vendor
  service.

Per ADR 0015, owner-local private captures are an approved reverse-engineering
input. They may contain raw payloads and other private data for local analysis,
but only redacted or derived conclusions may be copied into tracked files,
issues, release artifacts, adapter logs, or chat excerpts.

Command validation is intentionally separated into `tools/command-poc`. The
protocol PoC remains read-only.

REST endpoint discovery for maintenance, consumables, notifications, and
message history is intentionally separated into `tools/rest-poc`. That tool may
probe candidate read-oriented legacy REST endpoints after login and device
selection, but it must keep raw responses below ignored owner-local
`.poc-private/rest-poc/` and print only redacted shapes plus derived keyword
hints. It must not reset consumables, send robot movement commands, create
ioBroker objects, or claim endpoint support before a real-device probe proves
the specific endpoint and field semantics.

Command PoC runs have confirmed `start`, `pause`, `continue`, `return`,
`fan-quiet`, `fan-standard`, `fan-strong`, `deep-cleaning`, and `collect-dust`
on the first M7 Pro test device. `collect-dust` was also confirmed during an
active cleaning run: the robot returned to the station, performed dust
collection, and continued cleaning afterward. These are still PoC results, not
yet public adapter commands.

## Verified Evidence

Private runs against one M7 Pro on 2026-09-10 verified:

- successful login and token acquisition without printing the token;
- enumeration of one `M7_PRO` / `811_LDS` device;
- gateway endpoint discovery without printing the endpoint;
- successful `infoType` 70001 gateway handshake;
- receipt and decryption of three encrypted gateway events;
- event summaries for `infoType` 20001, `20002`, and `30000` without raw
  payloads, serial numbers, gateway data, or map contents.

Later runs during active cleaning, pause, return-to-dock, and docked/charging
states observed repeated `infoType` 20001 status events, plus `infoType` 20002
and `30000`. Observed mode values include `sweep`, `pause`, `backcharge`, and
`charge`. This indicates that the gateway pushes events actively while the
robot is moving and may close the socket after sending a smaller idle/docked
event set.

Later adapter observation found `status.mode` reporting `dormant` even while
the robot was doing other visible work. Therefore `mode` must be treated as a
raw upstream mode candidate and not as a reliable public activity state until
the project identifies the correct app-equivalent state derivation.

The Proscenic app also reported a maintenance warning equivalent to "dust bag
full, please replace". The project has not yet identified which safe upstream
field carries this condition. Candidate sources include derived `errorState`
content, station-related `infoType` 20001 fields, or a separate cloud/app data
source. The adapter now exposes a bounded and redacted
`status.maintenance.details` diagnostic state to speed up this mapping. It must
not publish guessed maintenance messages before the mapping is proven with
redacted private evidence.

Owner-provided screenshots from the main Proscenic app account on 2026-09-14
showed a consumables screen with filter, side brush, main brush, and sensor
remaining-life values, plus a message screen containing repeated dust-bag-full
and dust-collection-station activity messages. These screenshots are visual
evidence that the main account can see these values, but they do not by
themselves prove whether the adapter should read them from gateway events or
from a separate REST/app endpoint.

`infoType` 20002 is also used for safe map metadata. The adapter may publish map
availability, dimensions, resolution, IDs, area count, encoded size, compressed
size, and update timestamp. It must not publish raw base64 maps, decompressed
map bytes, coordinates, paths, charger positions, serial numbers, or complete
20002 payloads. ADR 0016 adds an explicit local-development exception for
`map.live.*`: a bounded rendered PNG data URL for VIS debugging. That rendered
image is private owner data and is not a raw payload or final release contract.

Private map rendering probes on 2026-09-13 compared a long capture with an
owner-provided Proscenic app screenshot. The app view shows a large filled
occupancy-style area with an outline, a no-go zone, and the dock/robot marker.
The map payload required one important transport normalization step: whitespace
inside the base64 map string represents `+` characters. After restoring those
characters, the decoded map length matches `lz4_len`, and raw LZ4 at offset 0
decompresses to exactly `width * height` bytes. The observed occupancy grid
uses three cell values and renders a recognizable floor plan that matches the
app screenshot geometry. The raw occupancy raster orientation and the
coordinate overlay orientation are not the same, so the local renderer emits
explicit orientation variants (`raw`, `flip-x`, `flip-y`, and `flip-xy`) for
comparison. `area.vertexs` and `chargeHandlePos` project into that grid with
`x_min`, `y_min`, and `resolution`, matching the no-go zone and dock position
without changing the coordinate projection. The app-conform orientation for the
observed M7 Pro is `flip-y`. Local file renderings are owner-private
reverse-engineering artifacts and must remain under ignored private paths.

`infoType` 20001 `pos` values use the same coordinate scale and can be
projected with the same `x_min`, `y_min`, and `resolution` metadata. A private
900-second capture projected nearly all observed positions into the map bounds
and can render a coarse robot trail plus latest pose. However, the dense
parallel cleaning lines shown by the Proscenic app are not yet proven to be
available as a ready-made overlay. First-to-last occupancy-grid deltas changed
only a small subset of cells in that capture, so the adapter must treat route
rendering as a separate reconstruction problem until more app-aligned captures
prove the exact path source.

The first deployed read-only adapter with ADR 0011 reconnect behavior was also
validated on CM4-Node-04. After a gateway socket close, the adapter scheduled a
bounded reconnect, re-established the gateway connection, and continued updating
cleaning status values while the robot was active.

This evidence is sufficient to start designing a minimal read-only status
contract and safe map metadata. It is not sufficient for self-emptying status
semantics, raw map rendering/publication, multi-device support, or release
claims.

Candidate read-only status fields are tracked in ADR 0006. They remain proposed
until their value semantics, units, ranges, and enum labels are verified against
real device behavior.

## Remaining Acceptance Gate

Before the PoC can inform production command or release behavior, record
private, redacted evidence for:

1. repeated startup and shutdown without leaked timers or sockets;
2. timeout-driven reconnect behavior;
3. token refresh behavior after authentication/session failure;
4. stable interpretation of candidate `infoType` 20001 status fields,
   including an app-equivalent activity state instead of relying blindly on
   upstream `mode`;
5. authentication and gateway failure behavior with redacted errors;
6. maintenance and warning conditions such as a full dust bag, without
   exposing raw vendor error payloads;
7. adapter-level command acknowledgement and failure semantics.

Only after the candidate status fields are interpreted should the project
freeze the first public ioBroker status contract in a new ADR.
