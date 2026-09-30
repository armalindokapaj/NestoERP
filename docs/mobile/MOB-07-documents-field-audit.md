# MOB-07 audit — documents, storage, uploads and field work

Phase A of MOB-07. Read-only findings; no code has been changed. Items marked
**unverified** were seen in a file listing or grep but not read end to end.

## 1. What already exists (canonical, reuse)

| Area | Where | Notes |
| --- | --- | --- |
| Canonical record | `Document` (prisma/schema.prisma ~3728) | One row per file. Holds `storageProvider`, `storageBucket`, `storageKey`, `currentVersionId`, `latestVersionNumber`, `storageStatus`, `scanStatus`, `previewStatus`, `thumbnailStorageKey`, `projectId`, `clientId`, `module`, `entityType`, `entityId`, `status`. |
| Versions | `DocumentVersion`, `lib/modules/documents/versions/*`, `app/api/documents/[documentId]/versions` | Immutable revisions, atomic version numbers, review machine. Version history UI: `components/documents/document-versions.tsx`. |
| Upload pipeline | `lib/modules/documents/storage/upload.service.ts`, `DocumentUploadSession`, `app/api/documents/uploads` | Authorise, PUT to storage, server verifies (magic bytes, scan, quota). **Idempotency key already exists** (`@@unique([companyId, memberId, idempotencyKey])`; a retry returns the same session or `UPLOAD_ALREADY_COMPLETED`). `multipartUploadId` is reserved but V0.1 is a single PUT. |
| Browser upload client | `components/documents/upload-client.ts`, `upload-queue.tsx`, `document-uploader.tsx` | One upload key per chosen file, reused on retry. Queue has waiting/uploading/checking/failed with Retry and Remove. Client pre-check uses the server's own registry (`lib/core/storage/file-type.registry.ts`). |
| Storage abstraction | `lib/core/storage/storage-provider.ts` and `.factory.ts`; `local` and `s3` providers | Provider-neutral. Downloads and previews go through signed, short-lived grants (`download.service.ts`, `preview.service.ts`, `url-signing.ts`). The storage key is never shown to the UI. |
| Preview | `preview.service.ts`, `app/api/documents/[documentId]/preview` | Inline-safe types only: PDF, JPEG, PNG, WEBP. The original is served inline; Office files are download-only. |
| Thumbnails | `thumbnail.service.ts` | Images only, 600x800 webp, derived key, same authorisation as the original. PDF thumbnails do **not** exist. |
| Parent access | `document.parent-access.ts` | A document follows its parent record's permissions (module + record access), not just project membership. This already satisfies MOB-07 §73 and §75. |
| Sensitive data | Same | HR, Finance and Legal documents are gated by parent module. **unverified**: whether `/documents` listing filters server-side per parent for every module. |
| Daily log (the Site Diary) | `DailyLog`, `DailyLogDocumentLink`, `lib/modules/daily-logs/*`, `components/daily-logs/*`, `app/api/daily-logs` | Status: DRAFT, SUBMITTED, REVIEWED, LOCKED, CORRECTION_REQUIRED, VOID. Photos are canonical `Document` rows linked with category, caption, takenAt and sortOrder. `evidence-gallery.tsx` already has a camera button, a file picker, per-file rows, and EXIF/GPS stripping for JPEG (`daily-log.exif.ts`). |
| Routes | `app/(nesto)/documents/*`, `tasks/[taskId]/documents`, `contracts/[contractId]/documents`, `clients/[clientId]/documents`, `hr/documents` | Desktop document pages exist. Project-scoped documents are **unverified** (likely via record documents / `record-documents.tsx`). |
| Mobile foundation | MOB-01..06 docs and components (`bottom-sheet`, `mobile-*`, `quick-create`, list/detail/form patterns) | MOB-03 list pattern and MOB-04 detail/form patterns are the ones MOB-07 must reuse. |

## 2. Gaps against the PRD

1. **No embedded PDF viewer.** There is no PDF library in `package.json` and no `<iframe>`/`<object>` viewer component found. Required: page navigation, zoom/pan, fit width, page count, lazy page rendering (§16-19). This is new work and needs a dependency decision (pdf.js vs native embed, which is unreliable on iOS Safari).
2. **No image viewer or gallery component** (pinch zoom, next/previous). `evidence-gallery.tsx` has a large preview for daily logs only.
3. **No `CaptureService` / `FilePickerService` abstraction.** Camera and file inputs are hand-built per component (`evidence-gallery.tsx`, `document-uploader.tsx`). Needed before MOB-08.
4. **No photo preview with Retake / Use Photo step**, and no multi-photo capture strip.
5. **No client-side image compression**; the only pre-upload transform is JPEG metadata stripping.
6. **Upload queue is per-component** (`useUploadQueue`) and is not app-wide, so it does not survive navigation, and there is no immutable upload context object (company, project, entity, intent) carried by the item. **Unverified** whether the queue captures the target at selection time or at upload time; this decides the project-switch scenario (§87-§89, §101).
7. **No resumable/chunked upload**; single PUT only. Acceptable for V0.1 limits; note as a documented limitation rather than building it.
8. **No mobile Documents library, document card, or detail page.** Desktop pages only.
9. **No HSE evidence or task evidence flow found.** `grep` found no evidence linkage for tasks; HSE has `requiresEvidenceOnFail` on inspection template items only. Whether `Document.entityType = task/hse*` is accepted depends on `recordDefinition(...).documents` in the records registry (**unverified**).
10. **Task completion requiring evidence** is not in the task state machine (**unverified**); §47 says it must live there if wanted, so this is a product decision, not a mobile task.
11. **No QR/scan/annotation hooks**; readiness only, so interface stubs at most.
12. **No "previous version" banner on opening an old version** (**unverified** in `document-versions.tsx`).

## 3. Decisions the PRD leaves open

- Which PDF renderer (pdf.js bundle cost vs platform embed).
- Whether "Site Diary" means the existing DailyLog (assumed yes; no separate model should be made).
- Whether a mobile HSE "Report Issue" maps to `HseIncident`, `HseHazard`, or both, and which fields are required.
- Whether Task evidence is a plain document attachment or a new relationship.
- Whether to add PDF thumbnails (would need server-side rendering; out of scope unless wanted).

## 4. Proposed scope if MOB-07 proceeds

Reuse first. The work is mostly a mobile layer and three shared services over what exists:

- Phase B: mobile Documents list/detail using MOB-03/04 patterns and existing document APIs.
- Phase C: `DocumentViewer` (PDF + image) with full-screen mode.
- Phase D/E: `CaptureService` and `FilePickerService` interfaces with a web adapter, a shared app-level `UploadService` wrapping the existing `upload-client` with immutable context, the preview/retake/multi-photo UI, and compression.
- Phase F-H: Task evidence, daily log mobile form polish (most exists), HSE capture, each only after the open decisions above are answered.
- Phase I-K: service boundary doc, tests, desktop regression.

## 5. Risks

- iOS Safari cannot be tested here; camera behaviour can only be checked via Playwright emulation.
- pdf.js adds bundle weight; it must be loaded lazily on the viewer route only.
- Changing the shared upload queue touches desktop uploaders; any change needs the existing upload tests and a desktop regression pass.

## 6. Decisions taken (2026-09-30) and what was built

Decisions: pdf.js; Site Diary = Daily log; HSE "Report issue" offers hazard or incident; Task evidence = a document or a text
comment; tests via Playwright emulation. Built: see mobile-documents, mobile-viewers, mobile-capture, mobile-uploads,
mobile-site-diary and native-service-boundaries. Gaps closed: items 1-6 above. Left: PDF thumbnails, resumable upload,
"previous version" banner review, task-completion evidence rule (product decision), annotation/scan/QR (readiness only).
