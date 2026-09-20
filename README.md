# ioBroker.proscenic

<img width="147" height="139" alt="image" src="https://github.com/user-attachments/assets/c5d6a8c4-e6e4-42d6-be61-2c79e37f5a60" />

Development-stage ioBroker adapter for supported Proscenic vacuum robots,
initially the Proscenic M7 Pro (`M7_PRO`, model `811_LDS`) through the legacy
Proscenic cloud/gateway path.

Manufacturer/product information: [Proscenic robot vacuums](https://www.proscenic.com/collections/robot-vacuums).

## Project status

This repository contains a TypeScript ioBroker adapter that can authenticate
against the verified legacy European Proscenic cloud, enumerate one real M7 Pro,
connect to the cloud gateway, project normalized runtime states, and expose the
first real-device-validated control and maintenance objects.

Verified on Proscenic M7 Pro so far:

<img width="1136" height="378" alt="image" src="https://github.com/user-attachments/assets/8a53c100-3ec4-41a0-8254-29cdf28c7000" />

- cloud login, token acquisition, device discovery, gateway discovery, framed
  socket reception, decryption, bounded reconnect, and adapter unload cleanup;
- status projection for battery, cleaning mode, fan, mop/water candidates,
  features, safe map metadata, and redacted maintenance diagnostics;
- writable command buttons for start, pause, continue, return to station, fan
  modes, deep cleaning, and dust collection;
- consumable counters for filter, side brush, main brush, and sensors;
- recent maintenance/message history, including dust-bag messages;
- local-development live-map rendering for VIS, including
  app-oriented map colors, saved zones, no-go areas, charger marker,
  a task-scoped pose trail, and SVG animation between gateway positions. A
  static PNG fallback and a same-origin iframe viewer URL remain available for
  other visualization modes.

The adapter is an early public beta. The supported hardware claim is limited to
the tested M7 Pro (`M7_PRO` / `811_LDS`) and the legacy cloud backend. Other
models, accounts, regions, firmware versions, Tuya-local control, room-cleaning
commands, and final map storage/retention policy still require separate
evidence.

Raw payloads, serial numbers, gateway endpoints, device addresses, credentials,
packet captures, private maps, and home-layout data are not committed or exposed
as public fixtures. The current live-map object is explicitly experimental and
intended for local VIS/debug use.

## Project identity

- GitHub repository: `ioBroker.proscenic`
- npm package: `iobroker.proscenic`
- adapter ID: `proscenic`
- namespace: `proscenic.<instance>`
- license: MIT

## Security and privacy

Never publish Proscenic credentials, session tokens, serial numbers, device or
gateway addresses, private network data, maps, packet captures, or logs.
Security policy and contribution requirements are documented in
[SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- [Project definition](docs/PROJECT_DEFINITION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Upstream research and provenance](docs/UPSTREAM_RESEARCH.md)
- [Publication checklist](docs/PUBLICATION_CHECKLIST.md)
- [Architecture decisions](docs/decisions/README.md)

## Changelog

### Unreleased

- Changed the primary experimental live-map image to an animated SVG while
  retaining an explicit static PNG fallback.
- Prevented transient charging status reports during active cleaning from
  erasing the current task's accumulated pose trail.
- Added `map.live.viewerUrl` with an interactive, same-origin live-map viewer
  that updates without reloading its iframe, uses the configured canvas color,
  and presents the centered map without an internal title bar.
- Added guarded consumable-reset button candidates with a fresh read before the
  write, `21016` gateway confirmation, exact non-target counter validation, and
  a persistent `21015` readback. Real-device reset validation is still pending.

### 0.2.0 (2026-09-16)

- Added writable live-map color controls for the white background and blue map
  area used by the rendered PNG.
- Preserved the live-map cleaning trail across room-to-room path changes during
  the same cleaning task.
- Clarified device availability diagnostics and the distinction between cloud,
  gateway, and last-known robot online states.

### 0.1.4 (2026-09-15)

- Refresh existing ioBroker object metadata during adapter startup so role,
  read, and write corrections also reach already installed instances.

### 0.1.3 (2026-09-14)

- Fixed ioBroker object role metadata for command buttons and the water level
  state.

### 0.1.2 (2026-09-14)

- Updated public maintainer/contact metadata for ioBroker latest review.

### 0.1.1 (2026-09-14)

- Documented the npm first-publish bootstrap path and the Trusted Publishing
  setup for future tag-triggered releases.
- Normalized the npm repository URL metadata.

### 0.1.0 (2026-09-14)

- Added the first real-device-validated command object tree for the M7 Pro:
  start, pause, continue, return, fan modes, deep cleaning, and dust collection.
- Added status projection for the verified legacy Proscenic cloud/gateway path.
- Added consumable runtime objects with derived remaining percentage and overdue
  hours.
- Added bounded maintenance/message history objects for recent device messages.
- Added experimental local live-map rendering for VIS debugging with app-oriented
  colors, no-go overlays, saved-zone overlays, charger marker, and pose trail.
- Added the M7 Pro product image and a display-prefixed device code.
- Improved command value normalization for visualization tools.

### 0.0.1 (2026-09-10)

- Initial adapter skeleton and project foundation.

## Independence

This is an independent interoperability project and is not affiliated with,
endorsed by, or sponsored by Proscenic. Product and company names belong to
their respective owners.

## License

MIT License. See [LICENSE](LICENSE).

Copyright (c) 2026 C@ptain Ch@os <butan_akrobat1t@icloud.com>
