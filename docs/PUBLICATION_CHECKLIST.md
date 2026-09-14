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

### npm first-publish and Trusted Publishing runbook

Use this project-specific sequence so the npm bootstrap does not depend on chat
memory.

1. Verify the package does not already exist:

   ```sh
   npm view iobroker.proscenic version dist-tags --json
   ```

   For the first publication only, `E404` is the expected result.

2. Prepare and push the release commit on `main`; wait until the full GitHub
   Actions matrix is green. Then create the immutable tag:

   ```sh
   git tag --list 'vMAJOR.MINOR.PATCH'
   git ls-remote --tags origin 'vMAJOR.MINOR.PATCH'
   git tag -a vMAJOR.MINOR.PATCH -m 'Release vMAJOR.MINOR.PATCH'
   git push origin vMAJOR.MINOR.PATCH
   ```

3. For normal releases after the first package publication, the tag-triggered
   GitHub Actions `deploy` job is the only npm publication path. It uses npm
   Trusted Publishing through GitHub Actions OIDC, so no long-lived npm token is
   required.

4. For the first package publication only, npm cannot create the GitHub trusted
   publisher while the package endpoint does not exist. If
   `npm trust github ...` fails with `404` on
   `/-/package/iobroker.proscenic/trust`, publish the exact already-tagged
   commit once from the maintainer machine:

   ```sh
   git status --short
   git rev-parse HEAD
   git rev-parse vMAJOR.MINOR.PATCH^{}
   npm whoami
   npm publish --access public
   ```

   `HEAD` and the tag commit must match before running `npm publish`. If npm
   requests browser authentication, keep the publish command running, press
   Enter to let npm open the current authentication URL, approve it in the
   browser, and let the same command finish. Do not reuse URLs from old npm log
   files; they expire and lead to npm `404` pages.

5. Immediately after the first manual bootstrap publish, configure Trusted
   Publishing for all future releases:

   ```sh
   npm trust github iobroker.proscenic \
     --repo Musashi1965/ioBroker.proscenic \
     --file test-and-release.yml \
     --allow-publish \
     -y
   ```

   The expected trusted publisher is:

   - type: `github`
   - repository: `Musashi1965/ioBroker.proscenic`
   - workflow file: `test-and-release.yml`
   - permissions: `publish` and staged publish

   `npm trust list iobroker.proscenic` may be used as an additional
   verification step, but it can require another browser/OTP proof-of-presence
   even after the trust relationship has been created.

6. If a tag-triggered deploy fails before npm publication, do not move or reuse
   the tag. Fix the cause on `main`, bump to a new patch version, and release a
   new immutable tag. If npm publication succeeds but GitHub Release creation is
   skipped, create the GitHub Release manually for the existing tag and record
   the reason in the release notes or follow-up documentation.

7. Verify the released package and GitHub Release:

   ```sh
   npm view iobroker.proscenic version dist-tags repository dist --json
   gh release view vMAJOR.MINOR.PATCH
   npx @iobroker/repochecker Musashi1965/ioBroker.proscenic --success
   ```

References: npm Trusted Publishing documentation and `npm trust` CLI
documentation describe the OIDC requirements, the GitHub workflow filename
matching, the `id-token: write` permission, and the `--allow-publish` flag.

## ioBroker repositories

- Submission to `latest` is separately authorized after npm/GitHub verification
  and representative user testing.
- Repository checker and review requirements are satisfied.
- Stable inclusion is requested only after the current ioBroker stability
  criteria, sufficient user feedback, migration behavior, and supported-device
  evidence are met.

## Prohibited shortcuts

- No manual npm publication as an undocumented alternative to the workflow.
  The only accepted manual npm publication exception is the documented
  first-publish bootstrap above, and only when `HEAD` exactly matches the
  already authorized immutable release tag.
- No moving/reusing tags or replacing published versions.
- No force-push to repair a release.
- No deployment from a dirty tree or unrecorded source snapshot.
- No claim that a private PoC result proves support for other models, regions,
  accounts, firmware, or current Tuya-based devices.
