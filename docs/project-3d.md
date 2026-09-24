# Project 3D architecture

Project 3D is a NESTO-owned premium capability with separate Platform authoring
and Company viewing boundaries. The database, storage provider, durable worker,
permissions, and canonical Project/Unit records remain the system of record.

## End-to-end flow

```text
Platform entitlement
        │
        ▼
Project3DConfig ── authoring Experience revisions
        │
        ├── Project3DModelSlot
        │        │
        │        └── immutable source upload
        │                 │
        │                 ▼
        │       project-3d.process-models
        │                 │
        │                 └── private runtime GLB + scene manifest
        │
        ├── mesh bindings ──► canonical ProjectUnit
        │
        ▼
immutable Project3DRelease
        │
        └── activeReleaseId ──► Company bootstrap ──► shared renderer
```

Draft edits never alter what Company users see. Publishing snapshots the typed
Experience, selected runtime model versions, slot transforms, scene manifests,
node overrides, and canonical unit bindings. Rollback moves only
`activeReleaseId` to an earlier immutable release.

## Ownership and authorization

Platform APIs live under `/api/platform/3d` and resolve `PlatformContext` before
parsing or looking up domain data. The five permissions are:

- `platform.3d.view`
- `platform.3d.configure`
- `platform.3d.model.manage`
- `platform.3d.binding.manage`
- `platform.3d.publish`

These permissions are never part of a Company role. The Platform page tree is
guarded by the Platform layout; the Experience Editor tab, which that layout
does not wrap, is guarded by its own (see below).

The Company route and bootstrap use normal NESTO `UserContext`, the Projects
module gate, `project.view`, and the existing Project scope builder. A viewer is
available only when the entitlement is active, viewer access is enabled, its
dates are valid, and an active published release exists. `project.structure.view`
separately controls links from a selected mesh to the canonical Unit page.

## Persistence

`Project3DEntitlement` controls access. `Project3DConfig` owns one versioned JSON
Experience document and the active release pointer. Semantic
`Project3DModelSlot` rows hold BUILDING, UNITS, SURROUNDINGS, CONTEXT, or CUSTOM
roles. `Project3DModelVersion` separates immutable source and optimized runtime
objects and records validation/processing state. `Project3DUnitMeshBinding`
links detected mesh names to `ProjectUnit`. `Project3DRelease` stores the
immutable viewer manifest and hash.

Composite `(id, projectId, companyId)` relationships prevent a model or binding
from crossing Project or Company boundaries. Service validation also rejects
invented nodes, inactive Units, duplicate bindings, and mismatched release
identity.

The earlier `ThreeDProjectConfiguration` and `ThreeDModelVersion` tables remain
in the schema only to preserve historical installations. No current runtime,
route, component, or test reads or writes them.

## Storage and processing

Source and runtime objects are private and use opaque keys below:

```text
companies/{companyId}/projects/{projectId}/3d/source/{opaque}.glb
companies/{companyId}/projects/{projectId}/3d/runtime/{opaque}.glb
```

Platform upload grants expire after 15 minutes. The local storage endpoint
accepts bytes only while the matching native version is `UPLOADED`; verification
moves the version to `PROCESSING` and prevents replay. Completion verifies the
actual size and GLB header before queuing work.

`project-3d.process-models` reads source bytes through `StorageProvider`, checks
manifest and complexity limits, optimizes with glTF Transform, writes a distinct
runtime GLB, and records deterministic scene metadata. It is a singleton durable
job and can resume from the immutable source object.

The Company bootstrap never returns source keys, storage credentials, draft
configuration, diagnostics, processing state, or Platform capabilities. It
signs only runtime objects from the active release for five minutes.

## Browser boundaries

`lib/3d/runtime/**` is browser-safe and has no Prisma, authentication, storage,
processing, or Platform service dependency. `components/3d/company/**` consumes
only the strict bootstrap DTO and shared renderer. Platform editor components
are outside the Company import graph. Architecture tests enforce both rules.

The Company viewer provides model loading/failure state, reset, fullscreen,
signed-access refresh, unit search, live commercial-status colors, selection,
and canonical Unit navigation when authorized. It has no upload, editor,
binding, version, publish, rollback, entitlement, or debug action.

## Experience Editor tab

Authoring happens in a dedicated browser tab, not inside Platform Admin.
Experience detail (`/platform-admin/3d/projects/{projectId}`) keeps the
management tabs — Overview, Project Structure, Models, Unit Binding, Releases —
and offers **Open Experience Editor ↗**, a plain `target="_blank"` link, only to
a session holding `platform.3d.view` and `platform.3d.configure`.

The editor lives at `/platform-admin/3d/projects/{projectId}/editor`, the same
address the embedded tab used, so old links now open it. The route sits in the
`app/(experience-editor)` route group: its layouts never pass through the
Platform Admin layout, so no admin sidebar, top bar, search or account controls
render and none of their data loads. Because the admin layout's guard is not
inherited there, the group runs it itself:

```text
(experience-editor)/platform-admin/3d/projects/[projectId]/
├── layout.tsx       requirePlatformContext(); full-window dark frame, no scroll
├── not-found.tsx    404 inside the frame
└── editor/
    ├── layout.tsx   authorizeProject3DEditor(): permission, then existence —
    │                before anything streams, so a missing Experience is a 404
    ├── loading.tsx  the editor's shape while the payload is read
    ├── error.tsx    "The 3D editor encountered an error" + Reload
    └── page.tsx     openProject3DEditor() → <ExperienceEditor />
```

`components/3d/platform/ExperienceEditor.tsx` is the only editor; architecture
tests keep it that way, keep it imported only by the editor page, and keep the
renderer (`three`, `lib/3d/runtime/render-engine`) unreachable from every page
under `app/platform-admin`. Inside the editor the renderer itself loads through
`next/dynamic`, after the editor chrome is interactive.

**Save is not Publish.** Save writes the authoring document through
`PUT /api/platform/3d/projects/{id}/config` (optimistic `expectedRevision`) and
each edited model version through `PATCH …/versions/{versionId}`
(`expectedUpdatedAt`), both with the reason for the change and audited. Only a
release changes what Company users see. The top bar says which release is live.

Unsaved work is protected: the save state reads Saved, Unsaved changes, Saving…
or Save failed; closing or reloading a tab with unsaved changes (including
unsaved unit links) asks first; Reset defaults asks first and only changes the
tab's draft. Ctrl/Cmd+S saves. Model settings are kept per version, so
switching models loses nothing.

Tabs stay in step without sending the scene anywhere. A save broadcasts
`{ projectId, revision }` on the `nesto-3d-experience-editor` channel
(`lib/3d/platform/editor-sync.ts`): the Experience detail tab re-reads itself,
and another editor tab on an older revision says so and offers Reload latest.
Returning to an editor tab re-reads `GET …/config` to catch a newer revision,
an ended session (sign in again in a new tab, then Save) or changed access.

Panel widths, collapsed panels and the last tool are remembered in this
browser's storage; nothing of the Experience is. The editor warns below
1280 × 720.

Not in V0.1: an audit entry for merely opening the editor, editor telemetry
events, merge or review of a concurrent change (the choice is reload), and
read-only authoring for a view-only Platform role (none exists).

## Mapbox

Mapbox powers optional basemap and site-terrain modes. Configure the public
browser token as `NEXT_PUBLIC_MAPBOX_TOKEN` and restrict it to the NESTO origins.
The CSP permits Mapbox API, tile, event, image, and blob-worker access only when
the token is configured. Without a token, bootstrap advertises no Mapbox
capability and the viewer disables map-backed modes while retaining 3D models.

## Operations

Platform diagnostics at `/platform-admin/3d/diagnostics` show workspaces with
missing models, failed or blocked versions, and active entitlements without an
active release. Worker status and failures remain in the existing Platform
operations surfaces.

For deployment, apply the additive Project 3D migrations, configure private
storage and the normal worker, optionally configure Mapbox, then publish through
Platform Admin. Never copy source GLBs to a public path. A rollback selects a
previous release in Platform Admin; it does not rewrite assets or manifests.
