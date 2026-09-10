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

The private legacy API probe used independently written code and printed no
password, token, or serial number. It verified authentication, token issuance,
and one M7 Pro device record. This result is sufficient to proceed to a
read-only gateway PoC, not to claim an operational adapter.

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
