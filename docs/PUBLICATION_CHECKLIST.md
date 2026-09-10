# Publication Checklist

This checklist is binding for GitHub, npm, and ioBroker publication. Each
externally visible step requires explicit user authorization.

## Repository foundation

- Canonical name is `ioBroker.proscenic`; npm name is `iobroker.proscenic`.
- GitHub default and only permanent branch is `main`.
- Repository-local Git identity matches the approved maintainer identity.
- Public history contains no credentials, tokens, serials, private addresses,
  device names, maps, captures, logs, or private test configuration.
- License, source provenance, security policy, contribution guide, issue/PR
  templates, and English README are current.
- GitHub repository creation, remote setup, visibility, topics, and settings are
  explicitly authorized and then verified.

## Adapter baseline

- Skeleton generated from the current official ioBroker creator and the exact
  generator version/options recorded.
- `package.json`, lockfile, `io-package.json`, Admin UI, icon, translations, and
  npm package contents satisfy current ioBroker requirements.
- Minimum Node.js, js-controller, and Admin versions are documented and tested.
- `check:quick` and `check:full` exist and cover their documented quality gates.
- Routine CI covers Linux Node.js 22/24/26; manual/tag/release-candidate CI adds
  Windows and macOS.

## Security and privacy

- Password fields are both `protectedNative` and `encryptedNative`.
- Tokens are memory-only and redacted unless a later ADR authorizes persistence.
- Logs, errors, diagnostics, tests, screenshots, and CI artifacts contain no
  installation-specific data.
- Dependency licenses and distributed notices are reviewed.
- Git history and `npm pack --dry-run` contents pass a secret/privacy review.

## Release candidate

- Explicit release authorization and SemVer classification recorded.
- Version agrees in `package.json`, lockfile, `io-package.json`, `common.news`,
  release notes, and proposed Git tag.
- `npm run check:full`, Adapter Checker, and GitHub Actions are green.
- Installation, upgrade, uninstall, restart, unload, and compact mode pass.
- Relevant real-device matrix passes on the supported M7 Pro/firmware/backend.
- Cloud failure, authentication failure, token renewal, reconnect, and command
  error behavior are verified without leaking secrets.
- Exact package tarball and checksum are reviewed.

## npm and GitHub release

- npm Trusted Publishing is configured for the reviewed GitHub Actions
  workflow; no long-lived npm token is introduced by default.
- Authorized immutable `vMAJOR.MINOR.PATCH` tag triggers the full matrix and
  deploy workflow.
- Published npm version, Git tag, GitHub release, release notes, and artifact
  checksum refer to the same commit and contents.
- Local `main`, `origin/main`, and GitHub default branch are synchronized and
  clean after publication.

## ioBroker repositories

- Submission to `latest` is separately authorized after npm/GitHub verification
  and representative user testing.
- Repository checker and review requirements are satisfied.
- Stable inclusion is requested only after the current ioBroker stability
  criteria, sufficient user feedback, migration behavior, and supported-device
  evidence are met.

## Prohibited shortcuts

- No manual npm publication as an undocumented alternative to the workflow.
- No moving/reusing tags or replacing published versions.
- No force-push to repair a release.
- No deployment from a dirty tree or unrecorded source snapshot.
- No claim that a private PoC result proves support for other models, regions,
  accounts, firmware, or current Tuya-based devices.
