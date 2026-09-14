# ADR 0018: Single Publication Mandate

- Status: accepted
- Date: 2026-09-14

## Context

The first npm and GitHub publication exposed too much friction in the agent
workflow. The project rules correctly required explicit authorization for
version changes, pushes, tags, GitHub releases, npm publication, and ioBroker
repository submission, but treating each normal release sub-step as a separate
approval created unnecessary waiting and context switching.

The project still needs strong guardrails because releases are externally
visible and immutable.

## Decision

A single explicit user instruction can authorize one complete standard
publication run. Accepted examples include:

- `Release und Veröffentlichung für vMAJOR.MINOR.PATCH komplett durchführen.`
- `Nächste Patch-Version vorbereiten, veröffentlichen und den
  ioBroker-latest-PR anstoßen.`

Within that mandate the agent may, without asking again for each normal
sub-step:

- classify the release according to SemVer and ADR 0005;
- update version files, `common.news`, changelog/release notes, and publication
  documentation;
- run `npm run release:preflight -- VERSION` and any required release checks;
- commit and normally push `main`;
- create and push the immutable release tag;
- monitor the tag-triggered GitHub Actions release workflow;
- verify npm Trusted Publishing, npm provenance, GitHub Release, and repository
  synchronization;
- create or update the ioBroker `latest` repository pull request when included
  in the mandate.

The mandate does not authorize force-pushes, tag deletion or movement,
published-version replacement, repository visibility changes, long-lived npm
tokens, privacy-rule weakening, private-data publication, project identity
changes, or ioBroker `stable` submission before the documented criteria are
met.

Live browser authentication, OTP/2FA, npm owner changes, and manual ioBroker
review comments can still require user action. These are treated as external
blockers, not as new policy approvals.

## Consequences

Future releases are faster: the user can issue one release instruction and the
agent can execute the standard chain end-to-end. The safety boundary remains
explicit because any action outside the standard chain still requires a fresh
instruction.

## Alternatives Considered

- Keep per-step approvals for every externally visible action. This was safer
  on paper but too slow and caused avoidable interruptions.
- Fully automate release and repository publication without human release
  intent. This was rejected because releases are immutable and externally
  visible.

## Validation

`docs/PUBLICATION_CHECKLIST.md` defines the exact standard chain and stop
conditions. `scripts/publication-preflight.sh` provides a repeatable local gate
before any immutable tag is created.
