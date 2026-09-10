# Proscenic Protocol PoC

This is a read-only proof of concept for the legacy Proscenic cloud and gateway
protocol. It is not the ioBroker adapter skeleton and it must not send robot
commands.

The tool verifies:

- account login against the legacy cloud endpoint;
- device enumeration;
- gateway address discovery;
- socket handshake with `infoType` 70001;
- framed gateway message reception;
- AES-ECB decryption of encrypted gateway payloads;
- redacted, bounded status summaries;
- candidate status-field summaries for `infoType` 20001 without live values.

The tool never prints the password, token, serial number, gateway address, map
payload, or raw upstream payload.

## Usage

Use environment variables for the account identifier and optionally the region:

```sh
export PROSCENIC_EMAIL='user@example.com'
export PROSCENIC_REGION='eu'
npm install
npm start
```

The password is read through a hidden prompt when `PROSCENIC_PASSWORD` is not
set. Do not put real credentials in shell history, documentation, fixtures, or
issue reports.

Optional settings:

- `PROSCENIC_DEVICE_INDEX`: zero-based device index, default `0`.
- `PROSCENIC_LISTEN_SECONDS`: gateway listen duration, default `30`.
- `PROSCENIC_MAX_EVENTS`: maximum encrypted gateway events to summarize,
  default `3`.
- `PROSCENIC_TIMEOUT_MS`: REST/socket timeout, default `10000`.

When a decrypted `infoType` 20001 event is received, the tool prints candidate
ioBroker status fields with upstream field name, candidate state ID, value
type, role, optional unit, and confidence. It does not print the live value.

The gateway result also prints a completion reason and elapsed time. This makes
it visible whether the listen window elapsed normally, the maximum event count
was reached, the socket timed out, or the gateway closed the connection.

## Safety Boundaries

This PoC is intentionally read-only. Command endpoints, maps, persistent
credentials, ioBroker object projection, and deployment are out of scope.
