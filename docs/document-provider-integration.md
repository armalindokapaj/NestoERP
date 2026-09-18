# Document storage providers and OneDrive

E-02 §3-§5, §58, §160-§170, §175, §228, §239; PRD #29. What a future
OneDrive / SharePoint integration must honour. **Nothing of Microsoft 365 is
built**: no authentication, no sync, no picker (§239). What exists is the
identity a synced file will carry, and the rules below.

## Today

Files are stored through the storage provider abstraction of PRD #29
(`lib/core/storage/`, chosen by `STORAGE_DRIVER`): local disk in development,
an S3-compatible bucket in production; every download through a short-lived grant that is
authorised and audited at the moment it is issued. No provider URL is ever
shown or stored as a way in.

## The identity columns

On `documents`:

| Column | Holds |
| --- | --- |
| `externalProvider` | which provider holds the file (`onedrive`, `sharepoint`, …); null for NESTO's own storage |
| `externalDriveId` | the drive or library |
| `externalItemId` | the item's stable id at the provider — **the identity** |
| `externalVersionId` | the provider's current version |
| `externalParentId` | the folder item, for display only |
| `providerPath` | the path, for display only |
| `webUrl` | the provider's link — never handed to a reader who has not passed NESTO's own check |
| `etag` | for change detection |
| `lastProviderSyncAt` | when NESTO last read it |

On `document_versions`: `externalVersionId`.

Unique per company: `(companyId, externalProvider, externalDriveId,
externalItemId)` — one canonical document per external item, so a sync can
never create a second (§168). A check keeps `externalProvider` and
`externalItemId` both set or both empty.

## Rules for an integration

1. **The external item id is the identity, never the path** (§162-§163). A file
   moved at the provider keeps its item id and every NESTO reference stays
   valid (§165).
2. **A rename is not a new document** (§166), and never silently changes the
   business title HR gave it (§228): the link's title is NESTO's.
3. **A new provider version is a new `DocumentVersion`** of the same document
   (§167), with its `externalVersionId`; a verified file then shows "new file
   since verification".
4. **A sync never creates or duplicates a link** (§168). Links are made by
   people filing a file; a sync updates the file's own columns.
5. **Business metadata survives the provider** (§169-§170): category, dates,
   verification and history live in NESTO. When the provider cannot be reached
   the row still lists, with "File temporarily unavailable".
6. **Access stays NESTO's** (§164, §175). A folder structure at the provider
   may mirror NESTO for convenience; who may open a file is decided by NESTO's
   rules and a NESTO-issued grant, never by the provider's sharing.
7. **Company and group isolation hold at the provider** — one drive per company
   or per group, never a shared one that mixes tenants.

## The adapter an integration implements

The shape §160 recommends, beside the existing storage provider:

```ts
interface DocumentStorageProvider {
  upload(input): Promise<{ externalItemId: string; externalVersionId: string; etag: string }>;
  getMetadata(ref): Promise<{ name: string; sizeBytes: number; mimeType: string; etag: string; externalVersionId: string; path: string }>;
  createDownloadGrant(ref, options): Promise<{ url: string; expiresAt: Date }>; // only after NESTO authorised the reader
  listVersions(ref): Promise<Array<{ externalVersionId: string; createdAt: Date; sizeBytes: number }>>;
  move(ref, parent): Promise<void>;
  rename(ref, name): Promise<void>;
  deleteOrArchive(ref): Promise<void>;
}
```

A sync worker registers in the job registry like every other (PRD #51): per
company, idempotent per item and version, leased, with a contract test.
