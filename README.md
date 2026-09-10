# ioBroker.proscenic

Planned ioBroker adapter for supported Proscenic vacuum robots, initially the
Proscenic M7 Pro (`M7_PRO`, model `811_LDS`).

## Project status

This repository is in the protocol-validation and adapter-skeleton phase. It
contains an official ioBroker TypeScript adapter skeleton, but the production
protocol implementation is not wired into the adapter runtime yet.

A private real-device probe has verified the legacy European Proscenic cloud
login, token acquisition, and device enumeration for one M7 Pro. Gateway status
events, reconnect behavior, commands, map handling, and other models are not yet
accepted as working.

The initial implementation was generated with the official ioBroker adapter
creator. Public ioBroker objects and writable controls will be added only with
contract tests and real-device evidence.

## Planned identity

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
