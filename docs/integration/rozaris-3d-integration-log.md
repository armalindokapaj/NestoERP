# Rozaris 3D integration log

This log records the controlled port of Rozaris 3D technology into NESTO under PRD 52. Rozaris remains a read-only source. NESTO remains the application, database, identity, authorization, storage, project, and unit system of record.

## Source and destination baseline

| Item | Value |
| --- | --- |
| Date | 2026-09-19 |
| Rozaris repository | `/Users/mnrv/Desktop/Rozaris/Web3D` |
| Rozaris branch | `chore/slim-platform-and-strip-comments` |
| Rozaris commit | `944a4c97114af442ae03ce7ff5665e5362b8274e` |
| Rozaris worktree | Clean |
| NESTO repository | `/Users/mnrv/Desktop/NestoERP` |
| NESTO branch | `feature/rozaris-3d-integration` |
| NESTO baseline commit | `be3a77d9523b9a5c55be557362b1a1315e11b588` |
| Safety tag | `before-rozaris-3d` |

The source `AGENTS.md` and the bundled Next.js 16 documentation for Server and Client Components, route handlers, lazy loading, package bundling, third-party libraries, and data security were read before interpreting source implementation details. Destination code will remain compatible with Next.js 15.5.25 and React 19.1.0.

## Baseline verification

The NESTO baseline was verified before PRD 52 implementation:

- `pnpm typecheck`: passed.
- focused ESLint over the existing Platform control-plane change: passed.
- Prisma schema validation and migration status: passed; 67 migrations and the local database was current.
- architecture, ownership, state, and audit coverage: passed; the combined architecture/audit run contained 1,004 passing assertions.
- focused Platform control-plane API suites: 18 passed.
- focused tenant security suites: passed, including module, session, project, sibling-company, and Platform-route isolation.
- Platform Admin Playwright flow: 2 passed.
- `pnpm build`: passed; 410 routes generated.
- `pnpm test`: 3,939 passed, 11 skipped, and 5 baseline fixture-state assertions failed. Four failures are in `tests/api/hr/employment-history.test.ts` because expected historical seed rows are absent. One is in `tests/integration/auth/demo-user-switch.test.ts` because the seeded Edvin session cannot switch to the expected company. These failures predate the native PRD 52 port and are retained as baseline evidence; no 3D phase may add a new relevant failure.

## Phase record

### Phase 0 — Baseline and integration log

- Verified the Rozaris branch, commit, and clean worktree.
- Verified the NESTO branch and baseline commit.
- Reused the dedicated `feature/rozaris-3d-integration` branch.
- Created the `before-rozaris-3d` safety tag at the NESTO baseline commit.
- Confirmed that no Rozaris Git history, authentication, marketplace domain, or framework configuration will be imported.

### Phase 1 — Source dependency audit

- Traced the shared RenderEngine closure, Company viewer wrapper, Experience Editor, GLB processing/release utilities, source APIs, packages, environment variables, static assets, and CSS assumptions.
- Classified every retained boundary under the PRD categories in `docs/integration/rozaris-3d-source-audit.md`.
- Chose a NESTO-native Company viewer shell because the Rozaris wrapper reaches marketplace state, account APIs, mock data, Publisher UI, and public listing navigation.
- Chose NESTO Platform/API adapters for the editor because the source hooks depend on NextAuth, Vercel Blob, Rozaris Prisma-shaped DTOs, and source routes.
- Confirmed that NESTO's private `StorageProvider` supports signed upload/download, metadata verification, server reads/writes, copies, and opaque Company-prefixed keys.
- Confirmed that NESTO's durable job runner can host GLB processing without keeping expensive work in a request lifecycle.
- Kept NESTO on Next.js 15.5.25, React 19.1.0, and its existing Prisma strategy.

### Phase 2 — Runtime dependency preparation

- Added the audited renderer dependencies `three` and `mapbox-gl`, the server processing dependencies `@gltf-transform/core`, `@gltf-transform/extensions`, and `@gltf-transform/functions`, and matching Three.js types.
- Added browser-safe shared release types, the Company bootstrap validation contract, allow-listed runtime asset paths, and explicit Platform/client and server-domain boundaries.
- Kept editor components and server processors out of the Company boundary.
- `pnpm typecheck`, focused ESLint, and `pnpm build` passed; the build generated all 410 existing routes.

### Phase 3 — Shared render engine

- Ported the audited RenderEngine closure, Three.js viewer host, sun/GLTF/node/status utilities, presets, and explicit runtime types.
- Removed all source business-domain import paths. The runtime has no Prisma, auth, storage, Platform service, or database-fetch dependency.
- Moved required water, caustic, and LUT files into NESTO's `/public/3d` namespace and retained the source bytes unchanged.
- Added utility coverage for loader/server node-name parity, section scope, solar interpolation, and normalized sun vectors.
- `pnpm typecheck`, focused ESLint, 4 runtime utility tests, all 1,019 architecture assertions, and `pnpm build` passed; all 410 routes were generated.

### Phase 4 — NESTO persistence and entitlement

- Added NESTO-owned entitlement, typed authoring configuration, model slot, model version, canonical unit binding, immutable release, and Platform environment-preset models through an additive migration.
- Enforced Company and Project identity with composite foreign keys. A mesh binding can reference only a model version and `ProjectUnit` from the same Project and Company.
- Kept source and runtime object keys separate and made the active release a pointer on the Project configuration.
- Added one entitlement predicate covering status, viewer switch, activation, and expiry boundaries.
- Replayed all 68 migrations from zero in a disposable PostgreSQL database, applied the migration locally, and verified no schema drift.
- `pnpm typecheck`, 5 entitlement assertions, and all 1,019 architecture assertions passed.

### Phase 5 — Platform authorization and workspace services

- Added the five exact `platform.3d.*` permissions for viewing, configuration, model management, binding management, and publishing while leaving them outside Company permissions.
- Added Project 3D-owned permission, validation, workspace query, and entitlement mutation services with required audit evidence.
- Added `/api/platform/3d/projects` workspace routes; every route executes through `withPlatformContext` and every service checks its exact permission.
- Verified that a live Company Owner session resolves as `NOT_PLATFORM`, all Platform 3D routes use the Platform guard, entitlement provisioning creates the authoring workspace atomically, and a read-only Platform context cannot mutate entitlement.
- `pnpm typecheck`, focused ESLint, audit/ownership coverage, and 4 Platform authorization/service assertions passed.

### Phase 6 — Private model ingestion and versioning

- Added Project- and Company-prefixed opaque storage keys for separate immutable source and processed runtime objects.
- Added signed Platform upload intents, server-side size/header verification, model slots and version creation, and a durable `PROCESSING` queue.
- Ported GLB manifest/complexity validation and glTF Transform optimization to server services that read and write only through NESTO's `StorageProvider`.
- Registered the singleton `project-3d.process-models` worker and regenerated the worker matrix. Processing resumes from the source object and writes to a deterministic runtime key.
- Added typed geometry metrics and unit-node names through an additive migration, replayed all 69 migrations from zero, and verified no drift.
- Verified processing success, source/runtime separation, idempotency, blocked models, Project isolation, suspended-Company queue completion, worker contracts, Platform route guards, typecheck, ESLint, and all 1,019 architecture assertions.

### Phase 7 — Scene manifest and canonical unit binding

- Added browser-safe unit-node normalization and automatic matching from the Rozaris `Unit_<code>` convention to NESTO `ProjectUnit.unitCode` values.
- Added a Platform binding workspace and replace operation guarded by `platform.3d.view` and `platform.3d.binding.manage` respectively.
- Validated every requested node against the processed scene manifest and every unit against the active canonical units of the same Project and Company before writing.
- Kept the database composite foreign keys and one-node/one-unit uniqueness constraints as a second line of enforcement.
- Added a NESTO-native binding editor with automatic matching, duplicate-choice prevention, POI visibility, reason capture, and clear unlinked state.
- Verified atomic replacement and audit evidence, exact Platform permission enforcement, duplicate rejection, invented-node rejection, inactive-unit rejection, cross-Project rejection, cross-Company rejection, two pure matcher assertions, typecheck, focused ESLint, and all 1,042 architecture and focused 3D assertions.

### Material decisions

- The existing NESTO control-plane 3D scaffold is treated as transitional code. PRD 52 requires NESTO-native entitlement, model slots and versions, canonical unit bindings, immutable releases, a Company-safe bootstrap DTO, and a ported Rozaris runtime/editor boundary.
- Source and processed model objects will use NESTO's storage provider. The existing scaffold's single-object workflow will be replaced rather than expanded into a parallel model.
- Full-suite baseline fixture failures will be tracked separately from newly relevant 3D failures.
