# ADR 0001 — Root-level app/, lib/ and config/ rather than /src

- **Status:** Accepted
- **Date:** 2026-09-11
- **Affected PRDs:** #36 §14 (FND-02)

## Context

PRD #36 §14 recommends a `/src` root containing `app`, `components`, `core`,
`modules`, `lib`, `config`, `server`, `workers`, `types` and `tests`.

This repository was built with those directories at the repository root:
`app/`, `lib/`, `components/`, `config/`, `prisma/`, `tests/`. By the time the
tracker PRD arrived, eight modules and roughly 97,000 lines were in place, along
with a `@/*` path alias resolving from the root.

## Decision

Keep the root-level layout. Do not move the tree under `/src`.

Platform code introduced from PRD #23 onward lives under `lib/core/*`
(`lib/core/audit`, `lib/core/observability`, `lib/core/security`,
`lib/core/notifications`, `lib/core/search`, `lib/core/reporting`,
`lib/core/cache`, `lib/core/retention`, `lib/core/integrations`,
`lib/core/numbering`), which preserves #36's *distinction* between platform
core and module code without the move.

## Alternatives

- **Move everything under `/src`.** A repository-wide path change touching every
  import, for no behavioural gain, during active module development. The cost is
  real and the benefit is conformance to a plan document rather than to an
  architectural requirement.
- **Split: new code under `/src`, old at root.** Two conventions is worse than
  either one.

## Consequences

- `#36 §14` is not satisfied literally; this ADR is the documented deviation
  required by #36 §180-§182.
- `@/*` continues to resolve from the repository root.
- The platform/module boundary #36 cares about is expressed by `lib/core/` vs
  `lib/modules/`.
