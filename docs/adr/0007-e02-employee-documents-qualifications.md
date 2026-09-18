# ADR 0007 — E-02: employee documents on the employment, qualifications on the person

- **Status:** Accepted
- **Date:** 2026-09-19
- **Affected PRDs:** Enhancement E-02 (Employee Documents & Qualifications);
  PRD #13 (Documents), PRD #16 (HR), PRD #25 (notifications and attention),
  PRD #26 (search), PRD #27 (reporting), PRD #29 (storage), PRD #39 (calendar),
  PRD #47-#49 (authorization, ownership, state), PRD #51 (workers); E-01 (the
  person, ADR 0002), E-03 (employment history, ADR 0004), E-04 (employees
  without a login, ADR 0006), D-01 (the ARMAAR tenant, ADR 0005)

## Context

E-02 asks for a Documents and a Qualifications area on every employee's
profile: contracts, amendments, salary documents, diplomas, licences,
certificates, permits and a CV, each with a category, dates, a visibility, a
verification and a history — one canonical file however many places show it,
reminders before anything runs out, and room for OneDrive later.

The code had:

- the canonical `Document` and `DocumentVersion` with upload sessions, scan,
  audited download grants and no public URLs (PRD #13, #29) — and employee
  files as documents with `entityType = "employee"` and the employment's id
  (E-04 re-keyed them), read through the record registry's `employee` entry:
  any HR reader in scope read every file, the employee read all of theirs;
- a precedent for a business link over a canonical file
  (`UnitDocumentLink`, E-05D) and for expiry reminders (the contractor
  compliance job, PRD #46);
- the person (E-01) and the employment (E-03, E-04), and no place for a skill
  or a qualification at all.

The PRD's own sketch — an employee-document entity, qualifications "of the
employee", `/team/[memberId]` — predates the person/employment split.

## Decisions

1. **Files belong to the employment; qualifications to the person** (the
   owner's decision before E-02 began). A contract, an amendment, a salary
   document, a licence scan: filed on the employment, in its company. A skill,
   a degree, a licence as a fact: held by the person across the group,
   recorded in the company that entered it, with its evidence filed there.
2. **One canonical `Document`, one `EmployeeDocumentLink`.** The link carries
   what the file is to HR — category, title (not the file name), issuer,
   number, dates, visibility, verification, current or not, what it renews or
   amends — and is unique per document, so a file is filed once. A
   qualification points at its evidence (`supportingDocumentId`); the Documents
   module lists the same row. Nothing is copied (§2, §189).
3. **A file between upload and filing is "unfiled"**: it has no category, so it
   is treated as the most private kind — HR readers of the private file and
   whoever uploaded it — until it is filed or put away.
4. **Four doors onto an employee file**, each a query clause
   (`employee-document.access.ts`):
   - HR — `hr.document.view`, the employment in the reader's HR scope and not
     their own, any visibility but the employee's private one, by class:
     professional with the base grant, employment and identity papers with
     `hr.document.private.view`, pay evidence with `hr.compensation.view`;
   - the employee — their own employment, `hr.self.documents`, every visibility
     but HR's own;
   - Finance — `hr.document.finance.view`, pay documents shared with Finance;
   - management — `hr.document.restricted.view`, what HR restricted to it.
   The last two are explicit grants no ladder rung carries; the Owner holds
   them by default. A colleague sees a **summary** of a verified, current file
   the employee shares with the group — never the file, its number or a note.
5. **Three readers of a qualification**: a colleague (the verified, current
   summary the person shares with the group), the person (all theirs but what
   HR keeps to itself), HR (people it employs and reaches, not itself;
   restricted ones with `hr.document.private.view`).
6. **Permissions are HR's**, plus eight: `hr.document.private.view`,
   `hr.document.private.manage`, `hr.document.verify`,
   `hr.document.finance.view`, `hr.document.restricted.view`,
   `hr.qualification.manage`, `hr.qualification.verify`,
   `hr.self.documents.upload`; and `people.qualification.add_self` for the
   person's own. An employee uploads only professional kinds and a CV.
7. **Verification is a state machine** (`employee_document_verification`,
   `person_qualification_verification`): verify and reject (with a reason),
   resubmit, expire, supersede. Nobody verifies their own evidence. Every
   change names the version it was made against; a stale page is told
   `CONFLICT`, not obeyed. A renewal is a new current row; the old one is kept,
   superseded. A new file version is a new `DocumentVersion` of the same
   document, and the row says "new file since verification".
8. **The registry's document policy.** `RecordDefinition.documents.policy`
   (`readable`, `changeable`) lets a record type narrow its files beyond the
   record's own door. The Documents module's lists, reads, downloads, renames,
   archives and new versions all ask it, so the Documents module is no side
   door onto a contract (§119, §138). Global search does not find employee
   files at all — HR searches them on the employee's record (§138-§141).
9. **Expiry is one job**, `hr.credential-expiry`, daily per company in the
   company's own day: reminders at 90, 60, 30 and 7 days and once more when the
   date passes, each claimed in the idempotency ledger with its notice; a
   verified one becomes `EXPIRED`, bound to the status, date and version read.
   Attention items for expiring, expired and unverified end on renewal or
   decision. The worklists, the calendar and the reports read the same
   conditions.
10. **Surfaces say only what their reader may know.** The calendar names the
    kind that runs out ("Driving licence expires"; an HR-private kind is "HR
    document"), never a title or number. Profile activity says only that a
    shared qualification was verified. HR's reports count, and count only what
    HR's own lists would show; a pay document is counted only for pay readers.
11. **External provider identity on `Document`**: provider, drive, item,
    version, parent, path, web URL, etag and last sync, unique per company and
    item — a stable external id, never a path, as identity (§160-§170). No
    Microsoft integration is built.
12. **The existing files were backfilled**: every employee document got a link,
    `POSITION_CHANGE` where an E-03 row cites it, else `OTHER_HR`, visible to
    employee and HR as before, archived where the file was.
13. **Where it lives in the interface**: the person's profile has *Skills &
    qualifications* and *Documents* tabs (the PRD's `/team/[memberId]` is
    `/people/[personId]`, ADR 0002); HR's employee record shows the same list;
    HR's worklists are views of HR → Documents; its reports are two tabs of HR
    → Reports.

## Section classification

| PRD sections | Outcome |
|---|---|
| §1-§16 principles, categories, qualification types | Built: 23 categories in seven groups and four access classes; 13 qualification types in six sections |
| §17-§37 visibility, access, summaries | Built as decisions 4-6 |
| §38-§58 upload, filing, self-upload | Built through the Documents pipeline; self-upload for professional kinds and CV |
| §59-§79 verification, self-verification | Built as decision 7 |
| §80-§91 expiry, reminders, renewal | Built as decision 9 |
| §92-§93 calendar | Built as decision 10 |
| §94-§111 profile tabs, HR record, drawer, filters, counts | Built |
| §112-§137 API, validation, server-owned fields | Built; 19 endpoints in 15 route files, every one under `withContext`, company isolation first |
| §138-§141 search | Built: employee files out of global search; people found by shared, verified qualifications |
| §142-§146 audit, activity | Built: 10 document and 8 qualification audit actions without sensitive payload; safe profile activity |
| §147-§150 notifications, attention | Built |
| §151-§152 required documents | **Not built**: needs company policy configuration (which roles need what) that does not exist; no `REQUIRED_DOCUMENT_MISSING` |
| §153-§156 worklists, dashboards | Worklists built; the optional dashboard widgets not built |
| §157-§159 reporting | Built as two HR report tabs |
| §160-§170 provider integration | Identity fields and the contract documented; no integration |
| §171-§199 security and tests | Tests per door, isolation sweep, integrity gate |
| Profile photo (E-01 deferred it here) | **Not in E-02's text**; not built |

## Consequences

- A file's readers depend on what it is, not only on whose record it is on;
  anything that reads documents through the registry gets that for free, and
  anything that reads `documents` rows directly must go through
  `buildDocumentAccessWhere`.
- The Finance and management doors are empty until an owner grants them.
- `verify:employee-integrity` now also checks the employee file and
  qualifications: a file on somebody else's record, self-checked evidence, a
  verification that names nobody, a superseded row still current, an
  amendment of a non-contract, a visibility its category forbids, evidence on
  another person's record.
