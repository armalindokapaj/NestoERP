# Mobile uploads (MOB-07 §35-§45, §83-§89)

There is one upload engine: `components/documents/upload-queue.tsx` + `upload-client.ts` (PRD #29, AUD-09). MOB-07 adds no
second one.

- **Steps:** authorise (signed URL) -> PUT bytes to storage -> server completes and scans. A file is "done" only when the
  server says AVAILABLE; "pending" / "unknown" are never shown as ready.
- **States:** queued, authorising, uploading (with %), verifying, processing, pending, linking, done, failed, cancelled.
- **Retry without reselecting:** a failed row keeps its `File`; Retry resumes at the failed step under the same upload key.
- **Duplicate protection:** one chosen file = one `Idempotency-Key` for all retries; a retry returns the same session or
  `UPLOAD_ALREADY_COMPLETED` with the document it made. Save buttons disable while pending.
- **Immutable context:** `enqueue` copies `parent` (`{context, projectId | entityType+entityId}`) at the moment of "Use photo",
  so switching Project mid-upload cannot redirect the file. The server revalidates every relationship. Covered by
  `aud04-mob07-field.spec.ts` (authorise body carries the original project).
- **Survives navigation:** `persistKey` keeps the queue in module memory for the tab; files still moving continue, failed
  ones return as "Select this file again". Nothing is written to browser storage.
- **Validation:** client pre-check uses the server's registry; the server re-checks type, size, magic bytes, scan, quota.
- **Large files:** single PUT only. Resumable/chunked upload is not built (`DocumentUploadSession.multipartUploadId` is reserved).
  Files are never read into React state; the `File` is handed to `XMLHttpRequest`.
- **Native readiness:** upload state is observable through the queue store (for a logout warning); OS background upload is
  a MOB-08 adapter.
