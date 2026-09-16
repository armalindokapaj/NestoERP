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
PENDING_UPLOAD → UPLOADED | FAILED
UPLOADED       → VERIFYING | FAILED
VERIFYING      → SCANNING | AVAILABLE | REJECTED | FAILED   (AVAILABLE when no scan is required)
SCANNING       → AVAILABLE | REJECTED | FAILED
AVAILABLE      → ARCHIVED
ARCHIVED       → AVAILABLE                                  (restore only)
REJECTED, FAILED                                            (terminal)
```

Two of those edges matter more than the rest:

- **Nothing reaches `AVAILABLE` except through `VERIFYING` or `SCANNING`.** A
  document is never downloadable on the strength of a metadata row.
- **Nothing leaves `ARCHIVED` except a restore.** A scan or preview worker
  that finishes after somebody archived the file must not resurrect it — which
  is why the workers' writes bind `storageStatus` in the `where` rather than
  writing by id. That is the same guard the state machines generalise; the
  storage worker had it first.

These states are not a `*.machine.ts` machine: workers drive most of them under
a system context rather than as a person, and the table above is their
declaration. They are held to the same rule — **every write binds the state it
read** (PRD #49 §64):

- **Completing, cancelling and failing an upload each claim its session
  first**, conditional on the session state they read, and only the winner
  writes anything else. A double-submitted completion counts the bytes against
  the quota once and records the upload once; the second submit finds the
  session completed and is answered with the result.
- **The file is deleted only after that claim commits.** A cancel or a failure
  that loses to a completion leaves the completed upload's file alone. The cost
  is the other direction: a crash between the claim and the delete leaves an
  orphaned object, which the cleanup worker is there to find.
- **Promoting a version locks the document row** and writes conditional on the
  storage state it read, so a promotion cannot make an archived document's
  file downloadable again.
- **Mirroring a scan verdict onto the current version** writes only to a
  version still `SCANNING`: it never archives a version, and never rolls back
  one that has already settled.
- **A scan is claimed before it runs** (`scanStatus` `SCANNING`, with
  `scanStartedAt` and `scanAttempts`), and its verdict is written only over that
  claim. A claim whose worker or request died is taken back after 15 minutes, so
  nothing stays `SCANNING` for ever; a scanner that gives no verdict is retried
  with a growing delay, and after 12 attempts the file is `FAILED`
  (`FILE_SCAN_FAILED`) — never made available unchecked (PRD #51 §35, §176, §193).
- **A version is never promoted over a newer one.** Under the document row
  lock, a version whose scan finishes after a later version became current stays
  in the history, available but not current.

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

The review states are declared by the `document_version_review` machine, and
each reviewer's request by `document_review` (see `docs/state-machines.md`):

```text
DRAFT ──request──→ IN_REVIEW ──approve──→ APPROVED ──supersede──→ SUPERSEDED
REJECTED ──request──↗    │  ↺ request (another reviewer joins the round)
                         └──reject──→ REJECTED
```

A version is approved when its last pending request is approved, and rejected
by the first rejection, which cancels the requests still open. **Decisions on
one version queue behind a row lock on that version.** Completion is a count
of the requests still pending, and a count cannot see another reviewer's
uncommitted decision: two reviewers approving the last two requests at once
would each have seen the other outstanding, and the version would have stayed
in review with every request approved. Under the lock the second count follows
the first commit, the round finishes exactly once, and a decision that arrives
after it has finished finds its request no longer pending.

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
