# PRD 53 implementation audit

This audit records the state of NESTO after PRD 52 and the remaining work for
PRD 53. Rozaris at `/Users/mnrv/Desktop/Rozaris/Web3D` was inspected as a
read-only UX and runtime reference. Its authentication, database, publisher,
listing, project and unit domains are not part of NESTO.

## Already implemented by PRD 52

- Platform-only 3D permissions and `withPlatformContext()` API boundaries.
- One `Project3DConfig` and one premium `Project3DEntitlement` per canonical
  NESTO Project.
- Private source GLB upload, processing, runtime artifacts, model slots and
  immutable model versions.
- A Rozaris-derived scene editor with model composition, transforms,
  environment, lighting, rendering, camera, section, material and performance
  controls.
- Canonical `ProjectUnit` mesh binding with project/company composite keys.
- Immutable releases, active-release pointer, publish validation and rollback.
- A Company-safe bootstrap that signs runtime artifacts and never returns
  source storage keys, draft configuration or processing metadata.
- The Company route `/projects/[projectId]/3d` and conditional project action.
- Physical source separation between `components/3d/platform` and
  `components/3d/company`.

## PRD 53 gaps

- Replace the all-project provisioning table with a card-based library of only
  provisioned Experiences, backed by URL filters.
- Add a validated Group → Company → Project creation workflow and Experience
  metadata.
- Split the all-in-one Platform page into Overview, Project Structure, Models,
  Experience Editor, Unit Binding and Releases routes.
- Add Platform-only canonical Building/Floor/Unit provisioning, including
  batch preview and collision checks, without introducing 3D inventory tables.
- Add a platform-wide Model Library.
- Expand the Company bootstrap with live, permission-filtered canonical Unit
  building, floor, type, area, price, status, plan and media information.
- Add Company viewer building/floor/status filters and a richer Unit panel.
- Add architecture/security/integration and browser coverage for the complete
  workflow.

## Implementation rules

- Existing entitlement, config, model, binding and release identifiers remain
  intact.
- Published releases continue to freeze only the scene and bindings. Live Unit
  business data is queried on every Company bootstrap request.
- Platform structure actions write `ProjectBuilding`, `ProjectFloor` and
  `ProjectUnit` directly through a dedicated Platform service using the same
  canonical constraints and validation concepts as the Company structure
  domain.
- Heavy Three.js code is loaded only on editor and Company viewer routes.
