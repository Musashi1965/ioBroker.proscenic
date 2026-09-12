# ADR 0015: Private captures for owner-local reverse engineering

- Status: accepted
- Date: 2026-09-12

## Context

The Proscenic M7 Pro legacy cloud and gateway protocol is undocumented. Public
behavioral references exist, but several are unlicensed or GPL-licensed and
therefore cannot be copied, adapted, translated, or vendored into this MIT
project.

Efficient adapter development requires observing real-device behavior,
including raw payloads, maps, positions, warning payloads, command effects, and
gateway edge cases. Those private observations can contain account data,
tokens, serial numbers, gateway addresses, device names, map bytes, room
layout, robot position, paths, charger position, private ioBroker IDs, and
other installation-specific data.

## Decision

Use owner-local private captures as a normal and intentional reverse-engineering
input for this project.

Private data may be collected, inspected, compared, and analyzed locally to
understand protocol behavior, derive safe state mappings, validate command
semantics, investigate warnings, and design future map support.

Private data must remain outside the public repository and outside public
artifacts:

- store private captures only below ignored owner-local paths such as
  `.poc-private/` or the configured private test-host capture area;
- never stage, commit, push, package, publish, release, paste into GitHub
  issues, or include private captures in public CI;
- never use raw private payloads as test fixtures;
- never mirror raw upstream payloads, maps, positions, serials, account data,
  tokens, endpoints, or private ioBroker IDs into adapter states or logs;
- share only redacted or derived results, such as field names, types, counts,
  safe enum labels, dimensions, sizes, timing, and behavioral conclusions.

When a raw private payload is required to answer a development question, inspect
it locally and then write only the sanitized conclusion back into tracked docs,
tests, and code.

This decision does not authorize firmware modification, certificate-validation
bypass, credential interception, DRM/security circumvention, or collection from
devices/accounts not owned or explicitly placed in scope by the user.

## Consequences

The project can move faster: private captures are a first-class research tool
instead of an exceptional last resort. At the same time, the public repository
remains safe for later ioBroker, GitHub, and npm publication.

Every feature derived from private captures still needs a public-safe
implementation, synthetic tests, documentation of the redacted evidence, and an
explicit statement of remaining uncertainty.

## Alternatives Considered

Avoid raw private captures entirely. Rejected because it would make status,
warning, command, reconnect, and map work unnecessarily slow and speculative.

Commit sanitized excerpts of raw payloads as fixtures. Rejected for now because
even heavily sanitized vendor payloads can accidentally preserve private layout
or identifier structure. Prefer synthetic fixtures that encode only the
behavior under test.

## Validation

Before commits and pushes, run the applicable quality gate plus a privacy
review of tracked and staged files. Private capture directories must stay
ignored. Any new diagnostic tool that reads private captures must default to
redacted output unless its output path is explicitly private and ignored.
