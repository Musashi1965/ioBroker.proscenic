# ADR 0010: Reviewed test-host deployment path

- Status: accepted
- Date: 2026-09-10

## Context

Deploying to the shared ioBroker test host changes external state and must not
use undocumented one-off shell commands. The project needs a repeatable local
deployment path before the first adapter runtime can be verified on CM4-Node4.

## Decision

Use `scripts/deploy-node4.sh` for explicitly authorized deployments to the
local ioBroker test host.

The script:

- refuses dirty working trees;
- exports the exact `HEAD` commit with `git archive`;
- builds in an isolated temporary directory;
- runs `npm ci`;
- runs `npm run check:full`;
- creates an npm tarball with `npm pack`;
- records and verifies the tarball SHA-256;
- validates the remote hostname and free disk space;
- installs the tarball as the ioBroker runtime user;
- uploads Admin assets;
- restarts `proscenic.0` if it already exists or creates the instance
  otherwise;
- writes deployment evidence on the test host.

The target SSH address remains local-only and is supplied via
`PROSCENIC_DEPLOY_TARGET`.

## Consequences

Deployments are reproducible and tied to a committed source revision. The
script is a test-host deployment path only; it does not authorize GitHub tags,
GitHub releases, npm publication, or ioBroker repository submission.

## Validation

Before running the script, the caller must read the local test-environment
document, confirm the exact commit, and have explicit user authorization for
the deployment.
