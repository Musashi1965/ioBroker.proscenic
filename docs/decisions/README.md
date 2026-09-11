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
- [ADR 0008](0008-initial-read-only-object-structure.md): initial read-only
  object structure
- [ADR 0009](0009-read-only-legacy-backend-integration.md): read-only legacy
  backend integration
- [ADR 0010](0010-reviewed-test-host-deployment.md): reviewed test-host
  deployment path
- [ADR 0011](0011-gateway-reconnect-policy.md): gateway reconnect policy
- [ADR 0012](0012-command-proof-of-concept.md): command proof of concept before
  public controls
- [ADR 0013](0013-initial-command-object-structure.md): initial command object
  structure

Required future decisions include accepting the first public object contract,
stable device identity, token renewal, command confirmation behavior, public
command failure semantics, and map privacy/storage.

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
