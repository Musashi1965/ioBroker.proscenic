# ioBroker.proscenic

Development-stage ioBroker adapter for supported Proscenic vacuum robots,
initially the Proscenic M7 Pro (`M7_PRO`, model `811_LDS`) through the legacy
Proscenic cloud/gateway path.

## Project status

This repository contains a TypeScript ioBroker adapter that can authenticate
against the verified legacy European Proscenic cloud, enumerate one real M7 Pro,
connect to the cloud gateway, project normalized runtime states, and expose the
first real-device-validated control and maintenance objects.

Verified on one owner-local Proscenic M7 Pro so far:

- cloud login, token acquisition, device discovery, gateway discovery, framed
  socket reception, decryption, bounded reconnect, and adapter unload cleanup;
- status projection for battery, cleaning mode, fan, mop/water candidates,
  features, safe map metadata, and redacted maintenance diagnostics;
- writable command buttons for start, pause, continue, return to station, fan
  modes, deep cleaning, and dust collection;
- consumable counters for filter, side brush, main brush, and sensors;
- recent maintenance/message history, including dust-bag messages;
- experimental local-development live-map rendering for VIS debugging, including
  app-oriented map colors, no-go areas, room-zone candidates, charger marker,
  and an interpolated pose trail.

The adapter is not a public release yet. The supported hardware claim is limited
to the tested M7 Pro (`M7_PRO` / `811_LDS`) and the legacy cloud backend. Other
models, accounts, regions, firmware versions, Tuya-local control, room-cleaning
commands, final map storage/retention policy, and production release readiness
still require separate evidence.

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

## Independence

This is an independent interoperability project and is not affiliated with,
endorsed by, or sponsored by Proscenic. Product and company names belong to
their respective owners.
