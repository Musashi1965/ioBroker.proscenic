# Architecture Decision Records

Use ADRs for decisions that are expensive to reverse or affect public behavior.
Number them sequentially as `NNNN-short-title.md`.

Current decisions:

- [ADR 0001](0001-project-identity.md): project identity and initial scope
- [ADR 0002](0002-legacy-cloud-protocol-strategy.md): initial protocol strategy
- [ADR 0003](0003-project-license.md): license and source provenance
- [ADR 0004](0004-credential-and-session-handling.md): credentials and sessions
- [ADR 0005](0005-semantic-versioning.md): release classification
- [ADR 0006](0006-initial-read-only-status-candidates.md): proposed initial
  read-only status candidates
- [ADR 0007](0007-initial-adapter-skeleton.md): initial adapter skeleton

Required future decisions include accepting the first public object contract,
stable device identity, gateway reconnect and command confirmation behavior,
and map privacy/storage.

## Template

```markdown
# ADR NNNN: Title

- Status: proposed | accepted | superseded | rejected
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences

## Alternatives Considered

## Validation
```
