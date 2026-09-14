# REST endpoint discovery PoC

This owner-local tool probes candidate Proscenic legacy REST endpoints for
maintenance, consumable, notification, and message data.

It is not adapter runtime code and must not be used from public CI.

## Scope

The tool may:

- authenticate against the legacy European Proscenic cloud;
- enumerate devices for the configured account;
- select one device;
- call read-oriented endpoint candidates with bounded timeouts;
- store raw responses only below ignored `.poc-private/rest-poc/`;
- print only redacted shapes and derived keyword hints.

The tool must not:

- print passwords, tokens, serial numbers, device names, endpoint addresses, raw
  response bodies, or complete payloads;
- send robot movement or reset commands;
- create ioBroker objects;
- claim endpoint support before a real-device probe proves it.

## Usage

```sh
cd tools/rest-poc
export PROSCENIC_EMAIL='your-real-proscenic-account@example.invalid'
printf "Proscenic password: "
stty -echo
IFS= read -r PROSCENIC_PASSWORD
stty echo
printf "\n"
export PROSCENIC_PASSWORD
npm start
unset PROSCENIC_EMAIL PROSCENIC_PASSWORD
```

Replace the example address with the real Proscenic account e-mail before
running the tool. Placeholder values such as `<deine-proscenic-mail>` are
rejected before login because the legacy cloud can otherwise return a token for
an account that has no devices.

Optional filters:

```sh
PROSCENIC_REST_GROUP=messages npm start
PROSCENIC_REST_GROUP=maintenance npm start
PROSCENIC_REST_GROUP=device npm start
PROSCENIC_REST_GROUP=map npm start
PROSCENIC_REST_GROUP=rooms npm start
```

Optional host selection:

```sh
PROSCENIC_REGION=tw PROSCENIC_REST_GROUP=device npm start
PROSCENIC_BASE_URL=https://mobile.proscenic.tw PROSCENIC_REST_GROUP=device npm start
```

By default, device enumeration uses the same host as the probe. To enumerate
the known device from the European legacy host while probing another host, keep
`PROSCENIC_DEVICE_REGION=eu`:

```sh
PROSCENIC_REGION=tw PROSCENIC_DEVICE_REGION=eu PROSCENIC_REST_GROUP=messages npm start
```

The REST PoC is a finite endpoint scanner. It sends one bounded request per
candidate endpoint and exits afterwards. It does not use the gateway
`PROSCENIC_CAPTURE_SECONDS` or `PROSCENIC_LISTEN_SECONDS` settings. A longer
polling/monitoring mode should be added separately if endpoint values need to
be observed over time.

The broad scan matrix contains thousands of candidates. Split large scans into
blocks when needed:

```sh
PROSCENIC_REST_GROUP=messages PROSCENIC_REST_START_INDEX=0 PROSCENIC_REST_MAX_CANDIDATES=1000 npm start
PROSCENIC_REST_GROUP=messages PROSCENIC_REST_START_INDEX=1000 PROSCENIC_REST_MAX_CANDIDATES=1000 npm start
```

For broad scans, use `PROSCENIC_REST_LOG_MODE=interesting` to suppress plain
404 probe lines in the terminal while still recording private raw responses:

```sh
PROSCENIC_REST_GROUP=maintenance PROSCENIC_REST_START_INDEX=0 PROSCENIC_REST_MAX_CANDIDATES=1000 PROSCENIC_REST_LOG_MODE=interesting npm start
```

For repeated private scans, prefer the wrapper. It loads
`../../.poc-private/rest-poc/env.sh`, defaults to `LOG_MODE=interesting`, and
keeps the terminal output focused on non-404 responses plus the completion
summary:

```sh
./run-private-scan.sh maintenance 0 1000
./run-private-scan.sh messages 1000 1000
./run-private-scan.sh messages 0 50 tw
```

When running several probes in the same shell, read and export
`PROSCENIC_PASSWORD` once, then run the filtered commands one after another.
`read` alone creates a shell variable; without the explicit `export`, child
processes such as `npm start` cannot see it and the tool will prompt again.

Raw responses are private reverse-engineering artifacts. They can contain
account data, serial numbers, device names, map identifiers, timestamps, and
message contents. Keep them local and ignored.
