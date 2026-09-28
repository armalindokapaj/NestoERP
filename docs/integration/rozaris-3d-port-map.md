# Rozaris to NESTO 3D port map

This is the final implementation map for PRD 52. It records where each retained
Rozaris capability now lives and which source concepts were replaced. The source
baseline is Rozaris commit `944a4c97114af442ae03ce7ff5665e5362b8274e`.

NESTO owns identity, authorization, Company and Project scope, `ProjectUnit`,
storage, processing, release publication, and navigation. No source API or
database model is a runtime dependency.

## Runtime and user interface

| Rozaris source area | NESTO destination | Final adaptation |
| --- | --- | --- |
| `src/lib/render-engine/RenderEngine.ts` and helpers | `lib/3d/runtime/render-engine/` | Browser-only shared renderer; neutral `nodeId` identifiers; explicit disposal; no database, auth, storage, or Platform import. |
| GLTF loader and decoder utilities | `lib/3d/runtime/gltf-decoder.ts` | Allow-listed local decoder paths; release-signed model URLs only. |
| Sun, status, section, quality, camera, fog, water, cloud, lighting, and post-processing helpers | `lib/3d/runtime/`, `lib/3d/shared/` | Typed NESTO Experience configuration with validated defaults. |
| Water normals, caustic texture, LUT assets | `public/3d/` | Local immutable assets under the NESTO public namespace. |
| `ThreeProjectViewer` | `components/3d/company/ThreeProjectViewer.tsx` | Shared render host with cleanup and controlled model/WebGL failures. |
| Public/white-label viewer shell | `components/3d/company/Project3DViewer.tsx` | Rebuilt around the Company release DTO; no marketplace, account, Publisher, or editing actions. |
| Experience Editor | `components/3d/platform/ExperienceEditor.tsx` | Platform-only NESTO editor with optimistic revisions and native API adapters, rendered only in its own browser tab at `/admin/3d/projects/{id}/editor` (see `docs/project-3d.md`). |
| Model upload/editor panels | `components/3d/platform/ModelIngestionPanel.tsx` | Private signed NESTO storage, semantic slots, immutable source versions, durable processing. |
| Unit mesh-link editor | `components/3d/platform/UnitBindingEditor.tsx` | Links meshes to canonical `ProjectUnit` rows with Project/Company validation and composite foreign keys. |
| Publish UI | `components/3d/platform/ReleaseManager.tsx` | Immutable release creation and active-release rollback. |

## Server and persistence replacement

| Rozaris concept | NESTO replacement |
| --- | --- |
| Rozaris Project configuration | `Project3DConfig`, keyed to canonical NESTO `Project` and `Company` |
| Rozaris premium/marketplace state | `Project3DEntitlement` with active/expiry/viewer checks |
| Detail/map model records | `Project3DModelSlot` plus immutable `Project3DModelVersion` |
| Rozaris Unit records | Canonical NESTO `ProjectUnit` through `Project3DUnitMeshBinding` |
| Mutable publish state | Immutable `Project3DRelease` plus `Project3DConfig.activeReleaseId` |
| Vercel Blob upload | NESTO `StorageProvider` signed PUT, HEAD/header verification, and private Project-prefixed keys |
| In-request model optimization | `project-3d.process-models` durable singleton job |
| Rozaris session/admin checks | `PlatformContext` with exact `platform.3d.*` permissions |
| Rozaris Company viewer API | `GET /api/projects/[projectId]/3d/bootstrap` through Company `UserContext` and Project scope |
| Rozaris authoring APIs | `/api/platform/3d/projects/**` through `withPlatformContext` |

## Route mapping

| Source behavior | NESTO route |
| --- | --- |
| Cross-project administration | `/admin/3d` |
| Project authoring workspace | `/admin/3d/projects/[projectId]` |
| Publication overview | `/admin/3d/publishing` |
| Processing and release findings | `/admin/3d/diagnostics` |
| Read-only Company viewer | `/projects/[projectId]/3d` |
| Company bootstrap | `/api/projects/[projectId]/3d/bootstrap` |
| Entitlement and workspace | `/api/platform/3d/projects/[projectId]/**` |
| Model slots and uploads | `/api/platform/3d/projects/[projectId]/slots/**` |
| Model completion and binding | `/api/platform/3d/projects/[projectId]/versions/**` |
| Publish and rollback | `/api/platform/3d/projects/[projectId]/releases/**` |

## Deliberately dropped

- Rozaris NextAuth setup, users, accounts, sessions, memberships, and admin repair.
- Publisher, Listing, public marketplace, pricing, purchase, favorites, and public project discovery.
- Source Project, Unit, location taxonomy, and business APIs.
- Source framework configuration, Git history, seeds, Vercel Blob adapter, and source route names.
- The earlier NESTO transitional 3D control-plane commands and `@google/model-viewer` wrapper.

The old NESTO `ThreeDProjectConfiguration` and `ThreeDModelVersion` Prisma tables
remain as inert compatibility history to avoid destroying existing rows during
this integration. Runtime code has no read or write path to them.

## Dependency result

Retained runtime packages are `three` and `mapbox-gl`; server processing uses
`@gltf-transform/core`, `@gltf-transform/extensions`, and
`@gltf-transform/functions`. Mapbox is optional and uses a public,
origin-restricted `NEXT_PUBLIC_MAPBOX_TOKEN`. No Rozaris package, package alias,
or workspace dependency remains.
