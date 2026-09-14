# ADR 0005: Semantic Versioning And Release Classification

- Status: accepted
- Date: 2026-09-10

## Context

The public adapter contract includes more than code APIs: ioBroker objects,
state metadata and acknowledgements, Admin configuration, messages, persisted
formats, runtime requirements, and documented device behavior affect users.

## Decision

Use Semantic Versioning 2.0.0.

After `1.0.0`:

- `MAJOR` for backward-incompatible public-contract changes;
- `MINOR` for backward-compatible functionality or deprecation;
- `PATCH` only for backward-compatible fixes.

During `0.y.z`:

- `0.MINOR.0` marks a feature milestone and may contain an explicitly approved
  compatibility break;
- `0.y.PATCH` remains backward compatible;
- every break is labeled `BREAKING`, requires an accepted ADR, and includes
  migration and rollback impact;
- prefer deprecation and transparent migration.

Published npm versions and Git tags are immutable. Version selection, version
file changes, tag creation, npm publication, GitHub release creation, and
ioBroker repository submission require explicit user authorization. A single
clear publication mandate may authorize the complete standard chain for one
release, as defined in `docs/PUBLICATION_CHECKLIST.md`; the agent must not stop
for repeated per-step confirmation while staying inside that mandate.

The normal npm publication path is npm Trusted Publishing from the reviewed
GitHub Actions tag workflow. The first publication of a new npm package may
require a one-time maintainer-machine bootstrap publish because the npm trusted
publisher endpoint can be unavailable before the package exists. That exception
is allowed only when the release tag already exists, `HEAD` resolves to the
same commit as the tag, the full release gate has passed, and the exact process
is documented in `docs/PUBLICATION_CHECKLIST.md`. After the bootstrap, configure
npm Trusted Publishing for the package and return to the tag-triggered workflow
for all later releases.

An authorized release keeps `package.json`, the root lockfile entry,
`io-package.json`, `common.news`, release notes/changelog, and
`vMAJOR.MINOR.PATCH` tag consistent. Do not bump versions speculatively during
ordinary work.

The standard release gate includes `npm run release:preflight -- VERSION`,
which verifies version consistency, clean working tree, absent release tag,
`git diff --check`, `npm run check:full`, package contents, and the current npm
registry state before the immutable tag is created.

## Consequences

Consumers can reason about upgrade risk, including state-tree and configuration
changes. Release preparation becomes a coordinated, tested operation rather
than an incidental commit.

## Validation

`docs/PUBLICATION_CHECKLIST.md` enforces the release boundary.
