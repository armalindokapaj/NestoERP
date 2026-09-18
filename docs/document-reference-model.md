# The document reference model

E-02 §2-§6, §11, §59, §186-§189; PRD #13, PRD #29. How one file is shown in
many places without ever being copied, and how a business record says what a
file *is* without owning it. The lifecycle of the file itself — upload, scan,
versions, download grants — is [document-lifecycle.md](document-lifecycle.md).

```text
ONE LOGICAL DOCUMENT
+ ONE CANONICAL DOCUMENT RECORD
+ ONE CURRENT FILE / VERSION CHAIN
+ MULTIPLE NESTO REFERENCES
= ZERO DUPLICATION
```

## Three layers

| Layer | Row | Owner | Says |
| --- | --- | --- | --- |
| The file | `Document`, `DocumentVersion` | documents | its bytes, versions, scan, storage, name, the one record it is filed on (`entityType`, `entityId`, or a project or client), its storage provider's identity |
| What it is to a domain | a **link**: `EmployeeDocumentLink`, `UnitDocumentLink` | that domain (hr, project-structure) | its business category, title, dates, visibility, verification, what it replaces — whatever that domain decides about it |
| What rests on it | a **reference column**: `PersonQualification.supportingDocumentId`, and the like | the referring domain | "this fact is evidenced by that file" |

The file answers to its own reader rules wherever it is shown. A link may narrow
them (decision 8 of [ADR 0007](adr/0007-e02-employee-documents-qualifications.md));
a reference never widens them: a colleague who sees a qualification's summary
does not thereby open its file.

## Rules

1. **A file is filed once.** A document has one parent record. A link is unique
   per document (`EmployeeDocumentLink.documentId`), so a file cannot be two
   kinds of thing on one record, or filed on two records.
2. **Showing is referencing.** The employee's profile, HR's record, the
   Documents module and a qualification all read the same `Document` row. There
   is no copy to fall out of date and nothing to delete twice.
3. **A new file is a new version**, not a new document: the same logical
   document, a new `DocumentVersion`. A **renewal** is a different logical
   document (a new licence, a new certificate): a new `Document` with a new link
   that supersedes the old link, which stays.
4. **Business identity is NESTO's, not the file's.** The link's title is what HR
   calls it; the file name is what was uploaded. Renaming the file changes
   neither the link nor any reference (§166, §228).
5. **Deleting is archiving.** A link is archived with a reason; a document is
   archived through the Documents module. Keys restrict deletion of a file a
   link or a reference still names.
6. **Company first.** A link, its document and the record it is filed on are of
   one company (composite keys); a qualification's evidence is of the company
   that recorded the qualification.

## Access through the registry

The Documents module resolves a document's readers through the record registry
(`lib/core/records/record.registry.ts`): the parent record's door, and — where
the record type declares one — its `documents.policy`:

```ts
policy: {
  readable(context): Promise<Prisma.DocumentWhereInput | null>; // the files this reader may open, as a clause
  changeable(context, documentId): Promise<boolean>;            // rename, archive, restore, new version
}
```

`buildDocumentAccessWhere` (lists, search), `findReadableDocument` (open,
download, preview) and `documentChangeAllowed` / `canChangeDocumentFile`
(changes) apply it, so a record type whose files have different readers — the
employee file — cannot be reached around its own rules through the generic
Documents screens.

## Adding a link for another domain

1. A table in the owning domain with `documentId` and `companyId` as a composite
   key to `Document(id, companyId)`, unique on `documentId` if a file may be
   only one thing.
2. Upload through `/api/documents/uploads` with the parent record; file the
   link only once the file is `AVAILABLE`.
3. If the file's readers differ from the record's, a `documents.policy` on the
   record type; if not, nothing — the record's door is the file's.
4. The ownership registry names the table's owner; the integrity gate checks
   that the file's parent is the link's record.
