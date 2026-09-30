# Offline documents (MOB-09 §13-§18, §125-§126)

## Choosing

- **Available Offline** on a project asks what to keep: *No documents*, *Selected documents* (a list with sizes), or *All documents*. The estimate (project data, documents, total) is shown before anything is stored (§12).
- **Make Available Offline** on one document's page (§14) stores it in the encrypted database. Both use the same call: a fresh download grant after the server re-authorises the document and the version.

## Versions

A downloaded copy stores `documentId`, `versionId`, `versionNumber`, `downloadedAt`, `serverUpdatedAt` and the bytes (§15). Whenever the device is online the engine asks `POST /api/sync/documents` where each copy stands (current version, downloadable, archived). Each copy is then one of:

| State | Shown as |
| --- | --- |
| `CURRENT` | *Available Offline* |
| `UPDATE_AVAILABLE` | **SUPERSEDED** badge, *Downloaded v3 · Current v4*, **Update** (§16, §18) |
| `UNAVAILABLE` | *No longer available to you* (archived, revoked) |
| `UNCHECKED` | *Not checked since it was downloaded* |

**Update** re-downloads the current version and replaces the copy.

## Reading offline

Opening a copy always shows **OFFLINE COPY**, *Last updated {time}* (the last time the server confirmed it), and — for a replaced one — **SUPERSEDED / New version available**. A copy that is not known to be stale still says it may not be current (§17). PDFs and images open inside NESTO from a `blob:` URL (the CSP already allows `blob:` for frames and images); other types say they cannot be previewed.

## Removal

Offline & Storage → *Downloaded documents* lists each copy with its size, version state and **Remove**. Removing a project's download removes its documents. A project whose access is revoked has its documents deleted.

## Limits

- Whole-file download only; no resumable transfer.
- Documents without a project are stored under the key `company`.
- The manifest shown for a project is capped at 100 documents.
