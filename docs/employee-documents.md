# Employee documents

Enhancement E-02 — [ADR 0007](adr/0007-e02-employee-documents-qualifications.md)
records why. This is the contract for the employee file: what is stored, who
may read and change it, how it moves, and what the gates and tests hold true.
Qualifications are in [employee-qualifications.md](employee-qualifications.md);
how a file is referenced without being copied is in
[document-reference-model.md](document-reference-model.md).

```
EmployeeProfile (company) ── Document (entityType "employee", entityId = the employment)   documents
                              └─ EmployeeDocumentLink   what the file is to HR             hr
                                   category, title, issuer, number, dates, visibility,
                                   verification, current or not, renews → / amends →
PersonQualification ── supportingDocumentId → the same Document                            hr
```

## The rows

| Table | One row is | Never |
| --- | --- | --- |
| `documents` (entityType `employee`) | the canonical file, filed on one employment of its company, with its versions | copied to show it elsewhere |
| `employee_document_links` | what one file is: a category, a business title (not the file name), issuer, number, issue/expiry/in-effect dates, visibility, verification, current or not, what it renews (`supersededById` on the old one) or amends (`amendsId`) | two for one document; a link to a document of another employment or company; its own replacement |

A document uploaded on an employment and **not yet filed** has no link. It is
listed under "Not filed yet" to HR readers of the private file and to whoever
uploaded it, and to nobody else.

**Database guarantees:** composite keys hold a link to its company's employment
and document, and a renewal or amendment to the same employment; one link per
document; expiry on or after issue, in-effect end on or after start; a link
never replaces itself; dates are `date` columns.

## Categories

Twenty-three, in seven groups; the class decides who reads it.

| Group | Categories | Class |
| --- | --- | --- |
| Employment | Working contract, Contract amendment, Employment letter, Position change, Other HR document | EMPLOYMENT |
| Compensation | Salary change document, Salary history supporting document, Compensation statement | COMPENSATION |
| Education | Diploma, Degree, Transcript | PROFESSIONAL |
| Certificates & skills | Professional certificate, Skills certificate, Language certificate | PROFESSIONAL |
| Licences | Professional licence, Driving licence, Equipment licence, Work permit | PROFESSIONAL |
| Training | Safety certificate, Training certificate | PROFESSIONAL |
| Other | CV, Other professional document; Identity document | PROFESSIONAL; IDENTITY |

`CATEGORY_RULES` (`lib/modules/hr/documents/employee-document.types.ts`) gives
each its default and allowed visibilities, whether the employee may upload it
(professional kinds and a CV), whether it is verified at all (HR's own papers —
a contract, a pay letter — are not evidence to check), and whether it usually
expires.

## Visibility

| Value | Who, besides HR of that class |
| --- | --- |
| `PRIVATE_EMPLOYEE` | the employee only — HR does not read it |
| `EMPLOYEE_AND_HR` | the employee |
| `HR_ONLY` | nobody else |
| `EMPLOYEE_HR_FINANCE` | the employee, and Finance with `hr.document.finance.view` (pay documents) |
| `RESTRICTED_MANAGEMENT` | management with `hr.document.restricted.view` |
| `GROUP_SUMMARY` | the employee; colleagues see a summary once it is verified and while current |

A salary document is never a group summary; an identity document never leaves
HR and its holder.

## Who may do what

Every reader first needs the HR module on and to be in the document's company.

| Door | Reads | Needs |
| --- | --- | --- |
| HR | files of employments in their HR scope, **not their own**, any visibility but `PRIVATE_EMPLOYEE`, by class | `hr.document.view`; employment and identity papers also `hr.document.private.view`; pay evidence also `hr.compensation.view` |
| The employee | their own file, every visibility but `HR_ONLY` and `RESTRICTED_MANAGEMENT`, not archived | `hr.self.documents` |
| Finance | pay documents shared with Finance | `hr.document.finance.view` (explicit; the Owner holds it) |
| Management | restricted documents | `hr.document.restricted.view` (explicit; the Owner holds it) |
| A colleague | the summary: category, title, issuer, dates — no file, number or note | `people.profile.view`; verified, current, `GROUP_SUMMARY` |

| Action | Needs |
| --- | --- |
| File (HR) | professional: `hr.document.create`; employment and identity: `hr.document.private.manage`; pay: `hr.compensation.update` |
| File (the employee) | `hr.self.documents.upload`; professional kinds and CV only |
| Edit details, visibility | HR with the filing grant for its class; the employee their own upload while unverified or rejected |
| Verify, reject | `hr.document.verify`, HR's door, a category that is verified at all, never one's own |
| Resubmit | after a rejection: HR with the filing grant, or the employee for their own upload |
| Renew | HR with the filing grant, or the employee for their own upload |
| Supersede, archive | HR with the filing grant for its class |
| New version of the file | `document.update`, and HR with the filing grant or the employee for their own upload not yet verified |

These doors are query clauses in `employee-document.access.ts`, applied where
the rows are read — the tab, the drawer, the Documents module's lists, reads
and downloads through the registry's `documents.policy`, the worklists, the
calendar and the reports — never a list loaded and filtered afterwards. Global
search does not find employee files for anybody.

## How it moves

`employee_document_verification` (`lib/core/state/registry.ts`):

```
UNVERIFIED ─verify→ VERIFIED ─expire (job)→ EXPIRED
     │ reject (reason)            │
     ↓                            ↓
 REJECTED ─resubmit→ UNVERIFIED   supersede → SUPERSEDED (terminal, not current)
```

- **Verify** records who and when, and the file version checked; a later new
  version shows "new file since it was verified".
- **Renew** files a new document as current and supersedes the old one, kept.
- **Supersede** marks one no longer in force, optionally naming what replaced
  it; **archive** (with a reason) takes it off the file.
- Every change names the `expectedVersion` the page was rendered from; a stale
  one is refused with `CONFLICT`.
- A new version of the file goes through the Documents module's version upload:
  the same logical document, never a second one.

## Expiry and attention

Job `hr.credential-expiry` (daily, per company, in the company's day; see
[worker-matrix.md](worker-matrix.md)) reminds at 90, 60, 30 and 7 days and once
the date passes — the employee where they may see it, and the company's
verifiers — and moves a verified one to `EXPIRED`. Each reminder is claimed in
the idempotency ledger in the same transaction as its notice. Attention items
`EMPLOYEE_DOCUMENT_EXPIRING`, `_EXPIRED` and `_UNVERIFIED` end on renewal or on
a decision. Notifications: `EMPLOYEE_DOCUMENT_ADDED`, `_VERIFIED`, `_REJECTED`,
`_EXPIRING`, `_EXPIRED`; a label names the category, never the title, and an
HR-private kind only as "HR document".

## Where it is

- **The person's profile → Documents**: their files in this company, as this
  reader may see them; files another company keeps are read there.
- **HR → Employees → an employee → Documents**: the same list (`?document=`
  opens one).
- **HR → Documents**: the Documents module filtered to HR, and HR's worklists —
  *To verify*, *Expiring in 30 days*, *Expired* (documents and qualifications
  together, through the HR door only; a reader whose HR scope is only
  themselves has none).
- **HR → Reports → Employee documents**: counts by category.
- **Calendar**: "Driving licence expires" for the employee; "Ethan Cole —
  Driving licence expires" for HR.

## API

| Method and path | Does |
| --- | --- |
| `GET /api/hr/employees/:employeeId/documents` | the tab: documents, summaries, unfiled files, group counts, what may be added |
| `POST /api/hr/employees/:employeeId/documents` | file an uploaded document (`documentId`, `category`, metadata, `visibility?`, `amendsId?`, `replacesId?`) |
| `GET`, `PATCH /api/hr/employees/:employeeId/documents/:linkId` | one; edit details and visibility (`expectedVersion`) |
| `POST …/:linkId/verify` · `reject` · `resubmit` · `supersede` · `archive` · `renew` | the semantic actions; reject and archive need a reason |

The bytes go through `POST /api/documents/uploads` with the employment as the
parent (`context: "record"`, `entityType: "employee"`), then the file is filed.
The company, the employment's ownership, verifier and status are the server's
and absent from every request schema.

## Holding it true

- `tests/api/hr/employee-documents.test.ts` — every door and class, unfiled
  files, the Documents module as no side door, verification and self-checking,
  renewal and amendment, stale pages, isolation.
- `tests/api/hr/credential-worklist.test.ts`, `credential-surfaces.test.ts`,
  `tests/api/jobs/hr.credential-expiry.test.ts` — worklists, calendar, search,
  activity, reports, integrity, the job's contract.
- `tests/e2e/modules/employee-files.spec.ts` — HR files and verifies a licence,
  the employee and a colleague, the worklist, a phone.
- The cross-company sweep covers every route; `pnpm verify:employee-integrity`
  checks a file on somebody else's record, self-checked evidence, a
  verification naming nobody, a superseded row still current, an amendment of a
  non-contract and a visibility its category forbids.

## Demo data

ARMAAR only (`prisma/seed/armaar/credentials.ts`): eighteen files on seven
employments of ARLIS - NDERTIM and BUILDING CONSTRUCTION INVEST — contracts and
an amendment, a salary review shared with Finance, degrees, licences running
out and one past its date, a renewed safety certificate with its predecessor
kept, one waiting for HR, one sent back, and two site workers without a login.

## Not here

- **Required documents** per role and the "missing" attention item: no company
  policy configuration exists to say what is required.
- A **profile photo**.
- **OneDrive / SharePoint**: identity fields only — see
  [document-provider-integration.md](document-provider-integration.md).
- The optional **dashboard widgets** of §155-§156.
