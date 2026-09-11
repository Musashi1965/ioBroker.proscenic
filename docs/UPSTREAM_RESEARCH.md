# Upstream Research

Status: initial review, 2026-09-10

## Legacy Proscenic sources

`andker87/Proscenic-M7-PRO` documents concrete M7 Pro REST command endpoints.
It was archived in 2026 and has no identified license. It is a behavioral
reference only.

`Fluepke/proscenic` documents the legacy login/device/gateway flow, gateway
message delimiter, token-based handshake, AES behavior, and robot map upload.
It has no identified license. Its source and bundled firmware must not be
copied or distributed.

`JuliusBlueTek/Proscenic-Home-Assistant` demonstrates a broader status and map
implementation, including message types and candidate status fields. It has no
identified license and is a behavioral reference only.

Behavioral map/status findings from these sources and our own probes:

- `infoType` 20001 carries status-like values and an `errorState` array that is
  a candidate source for maintenance warnings.
- `infoType` 20002 carries map metadata such as map/path IDs, dimensions,
  resolution, area list, compressed length, and an encoded map body.
- Known map renderers treat the encoded map body as private robot map data and
  combine it with coordinate fields and path/charger positions. The MIT adapter
  therefore exposes only safe metadata until a separate local-only map rendering
  decision is accepted.

Independent implementation rule: derive project requirements from observable
requests/responses, public documentation, independently written tests, and our
own real-device probes. Do not translate or mechanically port reference code.

## Tuya-local sources

`edenhaus/ha-prosenic` and the maintained `PhilippThaler/ha-proscenic` fork use
local Tuya protocols and are GPL-3.0. They are not an implementation source for
this MIT project. Their confirmed devices differ from the tested M7 Pro.

`blakadder/tuya-uncover` is CC0-1.0 and supports several OEM apps, including a
Proscenic vendor profile. Authentication failed against the tested legacy
Proscenic Home account, so it does not establish a Tuya backend for this device.

## Verified project evidence

The private legacy API probes used independently written code and printed no
password, token, serial number, gateway endpoint, or raw payload. They verified
authentication, token issuance, one M7 Pro device record, gateway discovery,
`infoType` 70001 socket handshake, and decryption of three gateway events:
`infoType` 20001, `20002`, and `30000`. This result is sufficient to design a
minimal read-only status contract. It is not sufficient to claim command, map,
multi-device, reconnect, or release readiness.

## ioBroker baseline

Use the official current `@iobroker/create-adapter` when creating the adapter
skeleton. Public readiness requires repository/npm naming, an English README,
license, valid roles, Admin configuration, package/integration tests, GitHub
Actions, npm publication, Adapter Checker, `latest` testing, and later `stable`
acceptance.

Relevant primary sources:

- https://github.com/ioBroker/create-adapter
- https://github.com/ioBroker/ioBroker.repositories
- https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adaptersecurity.md

## Required proofs before production protocol adoption

1. Authenticate and enumerate devices with bounded HTTPS and redacted errors.
2. Discover the gateway and reject malformed/unsafe endpoint data.
3. Connect, frame, decrypt, validate, and normalize status without private
   payload logging.
4. Reauthenticate and reconnect across token, cloud, gateway, and network
   failure.
5. Terminate every socket, timer, listener, and pending request on unload.
6. Verify each proposed public status field on the real M7 Pro.
7. Verify every command separately, including confirmation and failure cases.
8. Confirm Node.js and ioBroker runtime compatibility after skeleton generation.
