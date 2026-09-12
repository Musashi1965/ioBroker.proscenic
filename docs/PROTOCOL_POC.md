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

`infoType` 20002 is also used for safe map metadata. The adapter may publish map
availability, dimensions, resolution, IDs, area count, encoded size, compressed
size, and update timestamp. It must not publish raw base64 maps, decompressed
map images, coordinates, paths, charger positions, serial numbers, or complete
20002 payloads.

The first deployed read-only adapter with ADR 0011 reconnect behavior was also
validated on CM4-Node4. After a gateway socket close, the adapter scheduled a
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
