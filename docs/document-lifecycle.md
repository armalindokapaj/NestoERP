# Document lifecycle

How a file gets into NESTO, who may read it, what happens when it is replaced,
and what can never be taken away. PRD #13, PRD #29 §162, §233, §270, §319-§322,
§335; PRD #38 §65; PRD #47 §98; PRD #49 §9-§53, §295.

## A document is never authorised by its id

```text
Document permission
+ parent permission
+ parent record access
+ company isolation
+ document state
= document access
```

Every one of those, every time — on upload, on view, on download, on review,
and on a sharing change. A file id that reaches a handler proves the row
exists, not whose it is.

The parent is what most of that hangs off. `classifyDocumentParent` sorts a
document into one of four kinds — a module record, a project, a client, or the
company — and a module record wins over a project id: a hazard photo filed with
the hazard's project attached is reachable through the hazard, with HSE's
permissions and HSE's scope, not through project membership. Deciding it the
other way round is how an incident photograph became readable by anyone on the
project who could open the HSE module at all.

**An unregistered parent is refused.** `classifyDocumentParent` answers
`unregistered` for an entity type the record registry does not know or that
does not take documents, and nothing downstream treats that as permission. The
registry covers every parent type V0.1 has.

## The storage states

`lib/core/storage/storage-state.ts` holds one table that every writer consults,
so no service invents a transition of its own:

```text
PENDING_UPLOAD → UPLOADED → VERIFYING → SCANNING → AVAILABLE → ARCHIVED
                                     ↘ REJECTED  ↘ FAILED
```

Two of those edges matter more than the rest:

- **Nothing reaches `AVAILABLE` except through `VERIFYING` or `SCANNING`.** A
  document is never downloadable on the strength of a metadata row.
- **Nothing leaves `ARCHIVED` except a restore.** A scan or preview worker
  that finishes after somebody archived the file must not resurrect it — which
  is why the workers' writes bind `storageStatus` in the `where` rather than
  writing by id. That is the same guard the state machines generalise; the
  storage worker had it first.

Verification can reject outright: an executable wearing a `.pdf` name never
reaches the scanner. `REJECTED` and `FAILED` are terminal — a failed upload is
replaced by a new one, never nudged into life.

## Versions are immutable

A finalised version's file is never overwritten. Uploading a replacement
creates a new `DocumentVersion` with its own number, its own storage key and
its own SHA-256 checksum; the previous version keeps its file and its review
history.

Approving a version supersedes the older approved ones rather than deleting
them: `reviewState` becomes `SUPERSEDED` with a `supersededAt`, so the file,
its reviews and its decisions all stay. A rejected version stays too — it is
part of how the current version came to be approved.

The review states are `DRAFT → IN_REVIEW → APPROVED | REJECTED`, with
`SUPERSEDED` reached only by a later approval.

## Signed URLs carry no authority of their own

A signed URL is minted only after the same access check the viewer would face,
and it is short-lived: 15 minutes to upload, 3 minutes to download or preview.
It is a delivery mechanism, not a grant — nothing about holding one makes a
document readable that was not readable when it was issued.

Sharing classification is metadata. Marking a document shareable records an
intention and changes no access; there is no external reader in V0.1, and the
classification does not create one.

## What cannot be taken away

- A finalised file, by overwriting it.
- An approved version, by a later approval — it is superseded, and superseded
  versions keep their files.
- A rejected version, or the review round that rejected it.
- A document's attachment to its parent, by archiving that parent: the
  document stays historically attached and its access follows the parent's
  archival policy.

A broken parent link is an integrity error, not a document with no parent.
Nothing falls back to showing the file.
