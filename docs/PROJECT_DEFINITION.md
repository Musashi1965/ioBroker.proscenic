# General Project Definition

Status: first local-development adapter milestone, 2026-09-14

## Identity

| Item | Definition |
| --- | --- |
| Product name | Proscenic |
| GitHub repository | `ioBroker.proscenic` |
| npm package | `iobroker.proscenic` |
| ioBroker adapter ID | `proscenic` |
| Instance namespace | `proscenic.<instance>` |
| Implementation | TypeScript / Node.js |
| Project license | MIT |
| Initial hardware | Proscenic M7 Pro (`M7_PRO`, `811_LDS`) |
| Initial backend | Legacy Proscenic cloud |
| Initial test platform | Local Linux aarch64 ioBroker installation |

## Evidence baseline

Private real-device probes on 2026-09-10 verified against the European legacy
endpoint and gateway:

- successful account authentication;
- successful token acquisition without printing the token;
- enumeration of exactly one M7 Pro;
- product code `M7_PRO`, model `811_LDS`, and reported availability;
- gateway endpoint discovery without printing the endpoint;
- read-only gateway handshake with `infoType` 70001;
- receipt and decryption of three gateway events, including `infoType` 20001,
  `20002`, and `30000`, with only redacted shape summaries printed.

This proved authentication, device enumeration, gateway discovery, socket
handshake, framing, and AES decryption on one real M7 Pro. Later owner-local
adapter validation added bounded reconnect/unload behavior, the first
real-device-tested command buttons, safe status projection, consumable counters,
maintenance/message history, and experimental live-map rendering for VIS
debugging. The exact public release contract remains under development.

## Initial goals

1. Prove a client for login, device enumeration, gateway discovery, framed
   socket reception, decryption, status normalization, timeout, reconnect, and
   clean shutdown.
2. Keep the official ioBroker TypeScript adapter foundation buildable and
   record its tool/runtime baseline.
3. Define and test a minimal public object contract before projecting device
   data.
4. Add writable commands only after real-device confirmation and safe
   acknowledgement semantics.
5. Prepare the project for GitHub, npm, ioBroker `latest`, and later `stable`
   publication without exposing private installation data.

## Non-goals and boundaries

- No claim of support for M7, M8, M8 Pro, 820T, 830T, 850T, or current
  Tuya-based devices without separate evidence.
- No assumption that the legacy cloud API is stable or officially supported.
- No firmware modification, certificate-validation bypass, credential
  interception, or DRM/security circumvention.
- No raw map or home-layout publication in logs, tests, fixtures, commits, or
  issue reports. ADR 0016 permits an explicitly named local-development
  `map.live.*` rendered image state for VIS debugging; this is private owner
  data and not a final release contract.
- No local-control claim until a separate PoC verifies it on this exact model.
- No full feature set before the lifecycle and status foundation is stable.

## Public contract direction

The first accepted local-development contract uses stable, non-secret technical
identity and separate information, connection, status, capabilities, commands,
consumables, maintenance history, safe map metadata, and an explicit
experimental live-map object. The public release contract is not frozen yet.

All external writes use `ack=false`; adapter-confirmed results use `ack=true`.
Raw upstream payloads and exceptions are never the public contract.

## Reliability and operations

The adapter must bound requests, retries, reconnects, buffers, and map sizes;
renew expired sessions; serialize commands per device; expose stable redacted
errors; and remove sockets, timers, listeners, and pending work on unload. It
must support compact mode or document and justify why it cannot.

## Definition of done

A feature is complete only when behavior and boundaries are documented,
success/error/timeout/restart/unload paths are tested, object metadata and
acknowledgements are verified, no private data is exposed, unsupported behavior
is explicit, quality gates pass, and hardware claims have recorded evidence.

## Release direction

Public releases must satisfy ioBroker naming and repository rules, English
documentation, license/provenance review, valid state roles, package and
integration tests, GitHub Actions, npm Trusted Publishing, Adapter Checker,
`latest` user testing, and later `stable` requirements. See
`docs/PUBLICATION_CHECKLIST.md`, `docs/PROTOCOL_POC.md`, and ADR 0005.
