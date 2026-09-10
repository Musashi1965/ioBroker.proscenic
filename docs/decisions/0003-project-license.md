# ADR 0003: Project License And Source Provenance

- Status: accepted
- Date: 2026-09-10

## Context

The adapter is intended for public GitHub, npm, and ioBroker distribution.
Relevant protocol references include unlicensed and GPL-3.0 repositories, so an
explicit boundary is needed to prevent accidental license contamination.

## Decision

Release original software, documentation, and neutral examples under MIT with
copyright attributed to `C@ptain Ch@os`.

Use a provenance-first policy:

- prefer normal reviewed package dependencies over vendored source;
- record source, version/commit, license, intended use, and runtime assumptions;
- preserve all required third-party notices;
- do not copy, adapt, translate, or vendor source without an identified license;
- do not copy, adapt, translate, or vendor GPL-3.0 source into this MIT project;
- use incompatible or unlicensed projects only as behavioral references and
  implement independently;
- keep service terms, firmware, trademarks, and user content outside the
  project license.

Maintain `THIRD_PARTY_NOTICES.md` as the reviewed source record and verify the
complete dependency license inventory before release.

## Consequences

The project remains permissively licensed, but protocol work must be demonstrably
independent. Dependency and source review are release gates.

## Validation

The root license and current source-reference inventory implement this decision.
