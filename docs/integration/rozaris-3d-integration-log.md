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

### Material decisions

- The existing NESTO control-plane 3D scaffold is treated as transitional code. PRD 52 requires NESTO-native entitlement, model slots and versions, canonical unit bindings, immutable releases, a Company-safe bootstrap DTO, and a ported Rozaris runtime/editor boundary.
- Source and processed model objects will use NESTO's storage provider. The existing scaffold's single-object workflow will be replaced rather than expanded into a parallel model.
- Full-suite baseline fixture failures will be tracked separately from newly relevant 3D failures.
