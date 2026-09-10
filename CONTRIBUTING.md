# Contributing to ioBroker.proscenic

Contributions are welcome once public collaboration begins. Keep changes
focused and describe observable behavior, compatibility impact, validation,
and real-device evidence.

## Development baseline

The adapter skeleton must be generated from the then-current official
`@iobroker/create-adapter`; do not copy another adapter as a template. Until
that milestone, documentation and protocol PoCs are the only accepted project
content.

After generation, the repository will provide:

```bash
npm install
npm run check:quick
npm run check:full
```

Use the full gate for protocol behavior, dependencies, credentials,
persistence, object contracts, runtime compatibility, packaging, deployment,
release behavior, and changes spanning multiple layers.

## Public adapter contract

Object/state IDs, hierarchy, types, roles, read/write flags, acknowledgement
semantics, configuration, messages, persisted formats, runtime requirements,
and documented device behavior are public interfaces. Compatibility changes
require an ADR, migration notes, and the release classification from ADR 0005.

Only capabilities proven by the active backend may expose writable controls.
Do not claim hardware support without a recorded device/model/firmware test.

## Security and privacy

Do not include real accounts, passwords, tokens, serial numbers, device IDs,
device names, IPs, gateway addresses, maps/home layouts, packet captures, logs,
or installation-specific ioBroker IDs. Use neutral fixtures and reserved
example addresses.

Identify the origin and license of every dependency or adapted source. Source
with no license and GPL-licensed implementations may be used only as behavioral
references in this MIT project. See `THIRD_PARTY_NOTICES.md` and ADR 0003.

## Pull requests

Open focused pull requests against `main`. Include relevant tests and update
documentation, ADRs, or release notes when public behavior changes. GitHub
Actions and the applicable local gate must pass before release.
