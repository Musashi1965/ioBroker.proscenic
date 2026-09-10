# Legacy Protocol Proof Of Concept

Status: initial read-only tool, real gateway verification pending

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
- print redacted event summaries.

The PoC must not:

- send robot commands;
- persist credentials, tokens, serial numbers, gateway endpoints, maps, or raw
  payloads;
- print passwords, tokens, serial numbers, gateway addresses, map payloads, or
  full upstream payloads;
- create ioBroker objects or claim adapter support;
- run as public CI because it requires a private account and a live vendor
  service.

## Acceptance Gate

Before the PoC can inform production adapter behavior, record private,
redacted evidence for:

1. successful login and token acquisition;
2. device enumeration of the M7 Pro;
3. gateway endpoint discovery;
4. successful gateway connection and handshake;
5. at least one decrypted status event, preferably `infoType` 20001;
6. timeout and clean shutdown without leaked timers or sockets;
7. authentication and gateway failure behavior with redacted errors.

Only after that evidence exists should the project freeze a first public
ioBroker status contract in a new ADR.
