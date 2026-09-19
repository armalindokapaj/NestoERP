# Rozaris 3D source dependency audit

This audit defines the copy boundary for the PRD 52 port from Rozaris commit `944a4c97114af442ae03ce7ff5665e5362b8274e`. The source repository is read-only. NESTO remains the application, identity, authorization, storage, Project, ProjectUnit, and publication system of record.

The dependency closure was traced recursively from the runtime, viewer, Experience Editor, processing utilities, and 3D APIs. A source module listed as **keep** still requires path, type, framework, ownership, and security adaptation before it enters NESTO. No Rozaris database, auth, marketplace, Publisher, Listing, Project, Unit, or public publishing domain is accepted by this audit.

## Classification and destination

| Rozaris file/module | Classification | NESTO destination | Adaptation required | Decision |
| --- | --- | --- | --- | --- |
| `src/lib/render-engine/RenderEngine.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/RenderEngine.ts` | Replace source type imports; retain explicit disposal; read Mapbox token through NESTO client config; retain runtime-only behavior | Keep and adapt |
| `src/lib/render-engine/StudioBasemapLayer.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/StudioBasemapLayer.ts` | Adapt paths and Mapbox/Three types | Keep and adapt |
| `src/lib/render-engine/artificialLights.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/artificialLights.ts` | Adapt shared runtime types | Keep and adapt |
| `src/lib/render-engine/basemapCameraSync.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/basemapCameraSync.ts` | Adapt paths only | Keep and adapt |
| `src/lib/render-engine/clouds.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/clouds.ts` | Adapt paths and asset resolution | Keep and adapt |
| `src/lib/render-engine/fog.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/fog.ts` | Adapt shared runtime types | Keep and adapt |
| `src/lib/render-engine/idleDroneCamera.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/idleDroneCamera.ts` | Adapt shared runtime types | Keep and adapt |
| `src/lib/render-engine/lut.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/lut.ts` | Serve only allow-listed bundled LUT assets | Keep and adapt |
| `src/lib/render-engine/postProcessing.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/postProcessing.ts` | Adapt Three WebGPU imports to installed compatible version | Keep and adapt |
| `src/lib/render-engine/sectionScope.ts`, `sections.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/` | Replace Rozaris unit references with release manifest mesh bindings | Keep and adapt |
| `src/lib/render-engine/shadows.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/shadows.ts` | Adapt paths only | Keep and adapt |
| `src/lib/render-engine/siteTerrain.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/siteTerrain.ts` | Mapbox remains optional; handle missing token without blocking the viewer | Keep and adapt |
| `src/lib/render-engine/unitRegistry.ts` | A — pure 3D runtime | `lib/3d/runtime/render-engine/unitRegistry.ts` | Store only NESTO `ProjectUnit.id` and mesh-safe runtime metadata | Keep and adapt |
| `src/components/project/ThreeProjectViewer.tsx` | B — Company viewer UI | `components/3d/company/ThreeProjectViewer.tsx` | Use the NESTO release DTO and lazy client boundary; preserve engine cleanup | Keep and adapt |
| `src/components/project/viewerTypes.ts` | B — Company viewer UI | `lib/3d/company/viewer.types.ts` | Remove Rozaris Project/Unit and marketplace concepts | Keep and adapt |
| `src/components/viewer-runtime/ProjectViewerRuntime.tsx` | B/F — viewer UI with Rozaris domain coupling | NESTO-native `components/3d/company/Project3DViewer.tsx` | Rebuild shell around the shared engine; remove store, mock data, account APIs, Publisher cards, public listing navigation, and Rozaris unit workspace | Replace |
| `src/components/viewer-runtime/*` controls with no marketplace imports | B — Company viewer UI | `components/3d/company/controls/` | Port only controls needed by the published release contract; use NESTO design tokens and accessibility patterns | Selectively keep |
| `src/lib/gltfDecoder.ts` | C — shared 3D utility | `lib/3d/runtime/gltf-decoder.ts` | Configure decoder path centrally; do not let manifests supply arbitrary decoder URLs | Keep and adapt |
| `src/lib/glbNodeName.ts` | C — shared 3D utility | `lib/3d/shared/node-name.ts` | Rename Rozaris-specific identifiers to neutral stable node IDs | Keep and adapt |
| `src/lib/sunPosition.ts` | C — shared 3D utility | `lib/3d/runtime/sun-position.ts` | Path adaptation only | Keep |
| `src/lib/unitStatusVisuals.ts` | C — shared 3D utility | `lib/3d/runtime/unit-status-visuals.ts` | Map from a Company-safe status projection; do not import Sales or Finance services into client code | Keep and adapt |
| `src/lib/viewerPresets.ts` | C — shared 3D utility | `lib/3d/shared/viewer-presets.ts` | Validate all persisted preset values with the NESTO Experience schema | Keep and adapt |
| runtime portions of `src/lib/types.ts` | C — shared 3D utility | `lib/3d/shared/experience.schema.ts`, `lib/3d/company/bootstrap.types.ts` | Split the 1,157-line mixed type file into authoring and Company-safe contracts | Selectively keep |
| `src/components/dashboard/experience-editor/ExperienceEditor.tsx` | D — Platform Admin UI | `components/3d/platform/ExperienceEditor.tsx` | Use NESTO Platform APIs and canonical project/unit DTOs; remove session repair and marketplace state | Keep and adapt |
| editor scene navigator, viewport, camera, environment, lighting, rendering, material, section, shot, and model panels | D — Platform Admin UI | `components/3d/platform/editor/` | Import shared runtime only; use NESTO components/tokens; enforce per-action Platform permissions in APIs | Keep and adapt |
| editor upload and publish panels | D — Platform Admin UI | `components/3d/platform/models/`, `components/3d/platform/releases/` | Replace Vercel Blob upload and Rozaris release calls with signed NESTO storage and `/api/platform/3d` | Keep UI behavior; replace adapters |
| `src/hooks/useProject3DConfig.ts`, `useProjectConfigEditor.ts`, `useModelEditor.ts` | D/F — editor hooks with source APIs/types | `components/3d/platform/hooks/` | Target NESTO Platform routes; use versioned Experience document and conflict handling | Replace adapters |
| `src/hooks/useDetailModelSlots.ts` | D/F — editor hook with Vercel Blob/source APIs | `components/3d/platform/hooks/use-model-slots.ts` | Remove `@vercel/blob/client`; perform signed PUT then completion through NESTO | Replace |
| `src/hooks/useEnvironmentPresets.ts` | D/F — editor hook with source API | `components/3d/platform/hooks/use-environment-presets.ts` | Use Platform context and NESTO preset service | Replace adapter |
| `src/hooks/useProjectUnits.ts` | D/F — editor hook with duplicate source Unit API | `components/3d/platform/hooks/use-project-units.ts` | Read canonical `ProjectUnit` projection through the Project 3D domain | Replace |
| `src/hooks/useAdminSessionRepair.ts` | F — Rozaris auth | None | Platform context already provides authenticated Platform identity | Drop |
| `src/lib/glbValidate.ts` | E — Platform processing/service | `lib/modules/project-3d/processing/glb.validate.ts` | Validate bytes read from NESTO storage; neutral stable node IDs; preserve triangle and unit-node diagnostics | Keep and adapt |
| `src/lib/glbOptimize.ts` | E — Platform processing/service | `lib/modules/project-3d/processing/glb.optimize.ts` | Process source into a distinct runtime key; never overwrite source; run through durable worker path | Keep and adapt |
| `src/lib/glbUnitNodes.ts` | C/E — shared matching and client loader | split between `lib/3d/shared/unit-matching.ts` and Platform UI | Keep deterministic match helpers; replace Rozaris Unit types; avoid a second GLTF load when the editor engine has a manifest | Selectively keep |
| `src/lib/experienceDocument.ts` | E — Platform processing/service | `lib/modules/project-3d/releases/experience-document.ts` | Build from the validated NESTO authoring document and selected slot versions | Keep and adapt |
| `src/lib/publishing/compile.ts`, `validate.ts` | E/F — release algorithms coupled to source Prisma/domain | `lib/modules/project-3d/releases/` | Retain deterministic manifest/readiness algorithms; replace direct source Prisma, URLs, publish targets, and Rozaris models | Replace service boundary |
| `src/app/api/project-3d-config/[projectId]/route.ts` | E/F — source API | `/api/platform/3d/projects/[projectId]/experience` | `withPlatformContext`; `platform.3d.configure`; Zod versioned document; audit | Replace |
| `src/app/api/detail-models/**` | E/F — source API | `/api/platform/3d/projects/[projectId]/slots/**` | Platform context, NESTO storage, canonical project/unit checks, processing lifecycle and audit | Replace |
| source unit-link API | E/F — binding behavior with source Unit | `/api/platform/3d/projects/[projectId]/versions/[versionId]/bindings` | Validate Project, Company, version, mesh, and canonical `ProjectUnit` scope transactionally | Replace |
| source publish/unpublish/rollback routes | E/F — source publication | `/api/platform/3d/projects/[projectId]/releases` and rollback action | Create immutable release snapshots; rollback changes the active pointer and preserves every release | Replace |
| `src/app/api/viewer/v1/t/[publicKey]/**` | F — anonymous/public Rozaris publishing | `/api/projects/[projectId]/3d/bootstrap` | Require NESTO Company session and project access; return only active release with short-lived runtime URLs | Drop and replace |
| Rozaris Prisma schema and generated client | F — Rozaris domain | NESTO Prisma additions owned by `project-3d` | Add entitlements, config, slots, versions, bindings, releases, and optional presets without duplicate Project/Unit identity | Do not copy |
| Rozaris admin auth, NextAuth, users and memberships | F — Rozaris domain | `PlatformContext` / existing Company context | Use NESTO authorization at service and route boundaries | Drop |
| Publisher, Listing, CRM, buyer, transaction, saved/search and marketplace modules | F/G — unrelated domain | None | Outside PRD 52 and forbidden as parallel business identity | Drop |
| source root layout, middleware, Next config, package manifest, lockfile, global application shell | G — not required | Existing NESTO equivalents | Preserve NESTO Next 15.5.25, React 19.1.0 and application shell | Drop |

## Dependency closure findings

The shared renderer closure contains 22 local source files. It is acceptably cohesive once its imports of the mixed Rozaris `types.ts` are replaced by NESTO runtime contracts. The existing `ProjectViewerRuntime` closure expands to 81 files because it reaches marketplace state, account APIs, mock data and public-site components; that wrapper is therefore replaced.

The Experience Editor closure also reaches 81 local files. Its panels and interaction behavior are useful, but the hooks are adapters to Rozaris auth, APIs, Prisma-shaped DTOs, and Vercel Blob. The Platform UI may be ported after the NESTO service contract exists; those source hooks are not a valid server boundary.

The GLB/release processing closure contains 11 local files. Validation, manifest extraction, deterministic unit-node matching, optimization, and release compilation are retained as algorithms. Direct URL fetching, source Prisma calls, public asset URLs, publish targets, and Rozaris audit/auth calls are replaced.

## npm package audit

| npm package | Runtime/Admin | Required? | Reason |
| --- | --- | --- | --- |
| `three` `^0.185.1` | Shared runtime and Platform preview | Yes | RenderEngine uses WebGPU/TSL, GLTF/DRACO loaders, controls, post-processing and scene primitives from this version's module surface |
| `@types/three` `^0.185.4` | Build | Yes | TypeScript declarations for the ported engine |
| `mapbox-gl` `^3.27.0` | Shared runtime, optional site context | Yes | Source engine provides basemap and site-terrain modes; behavior degrades safely when no token is configured |
| `@gltf-transform/core` `^4.4.2` | Platform processing | Yes | Reads and writes server-side GLB documents |
| `@gltf-transform/extensions` `^4.4.2` | Platform processing | Yes | Preserves supported GLTF extensions during processing |
| `@gltf-transform/functions` `^4.4.2` | Platform processing | Yes | Deduplication, welding and pruning for runtime delivery assets |
| `sharp` | Platform processing | Already present | NESTO already uses `0.35.4`; optional texture conversion can reuse it |
| `lucide-react` | Platform/Company UI | Already present | NESTO already has its icon system dependency; use existing conventions |
| `clsx` | UI | Already present | Existing NESTO dependency |
| `tailwind-merge` | UI | Already present | Existing NESTO dependency |
| `zod` | Server/shared validation | Already present | Defines Experience, mutation, and bootstrap contracts |
| `@vercel/blob` | Source upload/storage | No | Conflicts with NESTO's private provider and signed capability model |
| `next-auth` / `@auth/prisma-adapter` | Source auth | No | NESTO contexts and sessions are canonical |
| source `@prisma/client` / `prisma` versions | Source database | No new install | Preserve NESTO's Prisma 6 strategy and generate from the NESTO schema only |
| `zustand` | Source marketplace state | No | The renderer does not require it; editor state can use React and NESTO data hooks |
| `gsap` | Source UI animation | No initially | Not in the renderer dependency closure; avoid enlarging the Company bundle |
| `three-mesh-bvh` | Source optional geometry acceleration | No initially | Not reached by the audited renderer/editor entries used in V0.1 |
| `xatlas-web` | Source optional UV tooling | No initially | Not reached by the audited processing closure required for upload/validation/optimization |
| `@mapbox/mapbox-gl-draw` | Source map authoring | No initially | Not required by the published viewer or audited Experience controls selected for V0.1 |
| `@google/model-viewer` | Existing transitional NESTO viewer | Remove after replacement | The PRD requires the Rozaris RenderEngine behavior rather than the scaffold viewer |

Dependencies will be added individually. The source package manifest and lockfile will never replace NESTO's files.

## API and domain replacement

| Rozaris API/domain dependency | NESTO replacement |
| --- | --- |
| Rozaris `Project` | Canonical NESTO `Project` |
| Rozaris `Unit` and unit APIs | Canonical NESTO `ProjectUnit`, reached through a project-scoped 3D service projection |
| Publisher, project membership, public key and anonymous tenant | NESTO Company/project access context |
| `requireAdmin` / `requireSuperAdmin` | `withPlatformContext` in APIs, `requirePlatformContext` in pages, and exact `platform.3d.*` checks in services |
| NextAuth session repair | Existing NESTO session/context handling |
| Rozaris Prisma calls | Project 3D repository/service using NESTO Prisma and ownership rules |
| `@vercel/blob` public uploads and URLs | NESTO `StorageProvider`: opaque company/project-prefixed source and runtime keys, signed PUT/GET capabilities |
| Direct remote URL validation | `StorageProvider.getObject` after signed upload completion and metadata verification |
| mutable version publication status as viewer truth | Immutable `Project3DRelease` manifest plus `Project3DConfig.activeReleaseId` |
| public viewer bootstrap/manifest routes | authenticated `/api/projects/[projectId]/3d/bootstrap` after project access, entitlement, and active-release checks |
| Rozaris audit logger | NESTO canonical audit service and action catalogue |
| source model/unit ids | NESTO slot/version ids and canonical `ProjectUnit.id` bindings |
| public delivery URL persisted in a version | private runtime storage key; a short-lived signed URL is minted only in the Company-safe bootstrap |

## Environment, assets, CSS, and framework assumptions

The only renderer environment variable found is `NEXT_PUBLIC_MAPBOX_TOKEN`. It is optional: absent configuration disables Mapbox basemap/site-terrain features without disabling model viewing. Storage configuration remains NESTO's `STORAGE_*` and `DOCUMENT_STORAGE_ROOT`; no Vercel Blob variable is introduced.

The renderer expects `/textures/waternormals.jpg`, `/textures/caustics/Caustic_Free.jpg`, and bundled LUT files under `/luts`. Required assets will be copied into a NESTO-owned `/3d/` public namespace with stable names and recorded provenance. Release manifests cannot choose arbitrary LUT or decoder URLs. Rozaris currently loads the DRACO 1.5.6 decoder from Google's static host; the port will centralize this constant and may self-host it later without changing release data.

Rozaris imports `mapbox-gl/dist/mapbox-gl.css` globally. NESTO will import that vendor CSS only from the 3D runtime boundary or its smallest valid global entry and will retain NESTO layout, tokens, typography, focus, and control styling. No Rozaris global stylesheet or root layout is copied.

Rozaris is Next 16.2.12 and React 19.2.4. NESTO stays on Next 15.5.25 and React 19.1.0. Source route, bundling, client/server, lazy-loading, and third-party component patterns are translated to the destination version. Three.js and GLTF processing libraries are isolated so server processors never enter Company client bundles and editor code never enters the Company route graph.

## Required architecture boundaries

- `lib/3d/runtime/**` is browser-safe and contains no Prisma, auth, storage, processing, or Platform service import.
- `lib/3d/company/**` contains only the bootstrap schema and Company-safe helpers.
- `lib/modules/project-3d/**` owns persistence, Platform mutations, processing, binding and immutable release construction.
- `components/3d/company/**` can import shared runtime and Company DTOs only.
- `components/3d/platform/**` may import shared runtime for preview and call Platform APIs, but cannot be reached by Company route imports.
- `app/api/projects/[projectId]/3d/bootstrap` is read-only and signs runtime assets only after all Company access checks.
- `app/api/platform/3d/**` uses `withPlatformContext`; no Company context is accepted.
- Source object keys, authoring documents, processing diagnostics, draft version data, and Platform permissions are absent from the Company bootstrap.

The large-copy gate is now satisfied. Each subsequent phase still requires its own build/tests and commit before the next product layer is added.
