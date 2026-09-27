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
parsing or looking up domain data. The six permissions are:

- `platform.3d.view`
- `platform.3d.configure`
- `platform.3d.model.manage`
- `platform.3d.binding.manage`
- `platform.3d.publish`
- `platform.3d.model.delete` (permanent deletion from the Model Library)

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
accepts bytes only while the matching native version is `UPLOADED`; an S3 or
Supabase grant is create-only (`If-None-Match: *`, or a Supabase token signed
without upsert). Verification moves the version to `PROCESSING` and prevents
replay. Completion verifies the actual size and GLB header before preparing it.

Preparing a version reads its source through `StorageProvider`, checks the
manifest and complexity limits, optimizes it with glTF Transform, writes a
distinct runtime GLB (keyed by the version id), and records deterministic scene
metadata. Two things run it:

- the worker's `project-3d.process-models` job, wherever a worker process runs
  the documents group; it drains every version left in `PROCESSING`;
- the request that completed the upload, after its response is sent (`after()`,
  `maxDuration` 300 s), when no live worker runs that group — a serverless
  deployment such as Vercel has none. `PROJECT_3D_PROCESSING=worker|inline`
  forces one or the other. Both are safe together: only a `PROCESSING` row
  moves on, and a second run writes the same object.

A version nothing has touched for six minutes counts as stalled (the request
was cut off, the worker crashed). The editor then offers **Retry preparation**
(`POST …/versions/{id}/process`), which puts it back in line.

### Uploading in the Experience Editor

The Scene panel and the Models page share one upload component. Choose **A new
model** (named from the file unless you type a name, with its purpose) or **New
version of** an existing model, choose a GLB, and upload. The
bytes go straight to the signed private storage grant with measured progress —
never through the app server, never as base64. The browser reads only the
12-byte header first; the server verifies size and header again, then the
complexity and unit names while preparing.

The limit is 200 MB per GLB 2.0 file, or the storage's own limit when that is
lower: a Supabase bucket's file size limit (50 MB on the Free plan) is read from
the bucket and shown in the panel. Larger scenes should be compressed (Draco or
Meshopt, e.g. `gltf-transform optimize`) or split into several models. Other
formats (FBX, OBJ, RVT, standalone glTF) must be exported as GLB first.

A retry reuses the same grant and version; once the bytes arrived it repeats
only the verification, and "already exists" from storage (S3 412, Supabase
409) counts as arrived. A retry after a failed grant request reuses the model it
already created. The editor watches models being prepared (statuses only,
every three seconds, while visible) and refreshes when one is ready, failed or
stalled; a refresh keeps every unsaved edit, and the renderer keeps the model
it already downloaded. A model uploaded in the tab is selected once ready.
Models that are not ready cannot be edited, and their state, validation issues
and actions are in the Properties panel. Uploading never publishes.

**Remove model** (Scene panel or Models page) takes a model out of the
Experience after a simple confirmation: its versions and files stay, the
published viewer keeps showing it until the next release, and publishing no
longer asks for a version of it. Without it, a model created by mistake blocked
every release.

**Delete permanently** (Model Library, `platform.3d.model.delete`) is a separate
action. It first reads where the version is still used and refuses — rather
than cascading — while it is part of any published release (older releases must
stay restorable), is the version its Experience currently shows, or is still
uploading or being prepared. Otherwise a strong confirmation removes the source
and runtime files from storage, drops its unit links and marks the row deleted,
so history still names it.

### No reasons, automatic audit

No 3D authoring action asks for a typed reason: saving, model upload, replace,
remove and delete, unit links, structure, releases and restore, Experience
details and provisioning. Accountability comes from the audit event each
persisted action writes in the same transaction: the server-derived actor and
time, the request id, the target, the Experience's project and, in metadata, a
system-written `operation` (`EXPERIENCE_CONFIGURATION_SAVED`,
`EXPERIENCE_DEFAULTS_RESET`, `MODEL_ATTACHED`, `MODEL_DETACHED`,
`MODEL_REPLACED` with old and new version, `MODEL_FILE_DELETED`,
`UNIT_BINDINGS_UPDATED`, `RELEASE_ACTIVATED`, …) and a `summary` such as
"3 Experience settings changed". The Platform audit shows that summary in its
Details column; events that carried a reason still show it. A `reason` is still
accepted by the APIs and kept, so older clients work. Entitlement changes are
the exception: they decide whether a company sees its viewer at all, and still
ask why. Destructive steps confirm instead: remove model, unbind units, delete a
structure record, restore a release, reset defaults, delete permanently.
Counters: `experience_save_total`, `experience_save_failure_total`,
`model_detach_total`, `model_delete_total`,
`model_delete_blocked_dependency_total`.

Ordinary GLBs get the lossless geometry passes; output larger than the source
is dropped in favour of the source bytes. Draco and Meshopt GLBs keep their
compressed bytes (the server has no codecs; the browser decodes both). A model
that requires KTX2/Basis textures (`KHR_texture_basisu`) is blocked, since the
viewer has no transcoder.

### Hosted storage

- `STORAGE_DRIVER=supabase` uses a private Supabase Storage bucket through its
  REST API with the project URL (`SUPABASE_URL`) and server key
  (`SUPABASE_SECRET_KEY`, or the legacy `SUPABASE_SERVICE_ROLE_KEY`) that the
  Vercel Supabase integration provides, plus `STORAGE_BUCKET`. Create the bucket
  private, with a file size limit. Supabase answers CORS for browsers itself.
  Unlike an S3 presign, it refuses to sign a missing object: the editor then
  shows that version as "File missing" instead of failing.
- `STORAGE_DRIVER=s3` uses any S3-compatible private bucket. Its CORS must allow
  the application origin, PUT and GET, and the signed headers `Content-Type`
  and `If-None-Match`; never drop the immutable-write header to get past CORS.
- The CSP adds the storage origin (`storageOriginForCsp`, HTTPS only in
  production) to `connect-src`, `img-src`, `media-src`, `object-src` and
  `frame-src`. Signed-in documents also allow `blob:` workers and fetches (Draco
  decoding, embedded GLB textures) and `'wasm-unsafe-eval'` (the Draco and
  Meshopt decoders); JavaScript eval stays disallowed. They are on every
  signed-in page because a client-side navigation can reach 3D from any page.
- The Draco decoder is three.js's own, served from `/3d/draco/` (see
  `tests/unit/project-3d/draco-decoder.test.ts` after a three.js upgrade).
- Check a real hosted upload, preparation, editor preview and publish/view flow
  after changing storage. Unit tests cannot verify a deployed bucket.

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
(`expectedUpdatedAt`), both audited automatically — no reason is asked. Only a
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
