# Skills and qualifications

Enhancement E-02 — [ADR 0007](adr/0007-e02-employee-documents-qualifications.md)
records why. A qualification is the **person's**, held across the group: a
skill, a degree, a licence, a certificate, a permit. The file it rests on is an
employee document, filed on the person's employment in the company that
recorded it — see [employee-documents.md](employee-documents.md).

```
PersonProfile (group) ── PersonQualification[]                                   hr
                           type, title, issuer, number, issue/expiry, level,
                           visibility, verification, current or not, renewed by →
                           companyId: where it was recorded
                           supportingDocumentId → Document on the person's employment there
```

## The row

`person_qualifications` — one qualification of one person: its type, a title,
issuer, number, issue and expiry dates, a level for a skill or a language, a
visibility, a verification, whether it is current and what renewed it, who
checked it and against which version of its file.

**Database guarantees:** composite keys hold the row to its person's group, its
recording company to that group and its evidence to that company; a renewal is
of the same person; expiry on or after issue; a row never renews itself.

## Types

| Section | Types |
| --- | --- |
| Skills | Skill (a level, no issuer or dates) |
| Education | Diploma, Degree |
| Certificates | Professional certificate, Skills certificate, Language certificate (with a level) |
| Licences | Professional licence, Driving licence, Equipment licence, Work permit |
| Training | Safety certificate, Training certificate |
| Other | Other qualification |

## Visibility

| Value | Who sees the full record, besides the person |
| --- | --- |
| `PRIVATE` | nobody — not even HR |
| `EMPLOYEE_AND_HR` | HR that employs and reaches the person |
| `HR_ONLY` | HR; the person does not see it (HR sets it) |
| `GROUP_SUMMARY` | HR; everybody in the group sees the **summary** once verified and while current |
| `RESTRICTED` | HR with `hr.document.private.view`; not the person (HR sets it) |

The person chooses among `EMPLOYEE_AND_HR`, `GROUP_SUMMARY` and `PRIVATE`.

## Who may do what

| Reader | Sees | Needs |
| --- | --- | --- |
| A colleague | the summary: type, title, issuer, dates, level — no number, note or file | `people.profile.view`; verified, current, `GROUP_SUMMARY` |
| The person | all theirs but `HR_ONLY` and `RESTRICTED` | their own login's person |
| HR | people employed in the reader's company inside their HR scope, not themselves; all but `PRIVATE`; `RESTRICTED` with `hr.document.private.view` | `hr.document.view` |

| Action | Needs |
| --- | --- |
| Add, for oneself | `people.qualification.add_self` |
| Add, for somebody | `hr.qualification.manage` and HR's reach |
| Edit | HR as above; the person their own while unverified or rejected |
| Verify, reject (with a reason) | `hr.qualification.verify` and HR's reach — never one's own |
| Resubmit | after a rejection: HR, or the person for their own, with a new file if that was the reason |
| Renew | HR, or the person — even for one HR recorded |
| Archive (with a reason) | HR; the person their own not yet verified |

A supporting file is uploaded onto the person's employment in the reader's
company and filed as the matching employee-document category; whether it
opens is the file's own rule. Sharing a qualification with the group never
shares its file.

## How it moves

`person_qualification_verification`, the same as a document's: `UNVERIFIED` →
`VERIFIED` or `REJECTED`; `REJECTED` → resubmitted; `VERIFIED` → `EXPIRED` by
the job; any → `SUPERSEDED` by a renewal. Every change names its
`expectedVersion`. A renewal is a new current qualification, verified afresh;
the old one is kept, superseded, with its link to the new.

## Expiry and attention

The same job as documents, `hr.credential-expiry`: each company that employs
the person reminds its own verifiers and — where the person may see it — the
person, at 90, 60, 30 and 7 days and when the date passes, once per company.
Attention: `QUALIFICATION_EXPIRING`, `_EXPIRED`, `_UNVERIFIED`. Notifications:
`QUALIFICATION_VERIFIED`, `_REJECTED`, `_EXPIRING`, `_EXPIRED`.

## Where it is

- **The person's profile → Skills & qualifications**: sections by type; the
  full records for the person and HR, with their actions; summaries for
  everybody else; "Show earlier and archived".
- **HR → Documents → To verify / Expiring in 30 days / Expired**, with the
  employee documents.
- **HR → Reports → Qualifications**: coverage by type among the people HR looks
  after — holders, share, to verify, expiring, expired — and the qualifications
  most held.
- **Global search** finds a person by a qualification they share, once
  verified: "Ethan Cole — AutoCAD · Skill · Advanced".
- **Profile activity**: "Safety certificate verified: Working at height", for
  shared ones only.
- **Calendar**: "Professional licence expires" for the person; with the
  person's name for HR.

## API

| Method and path | Does |
| --- | --- |
| `GET /api/people/:personId/qualifications` | the tab: full records this reader may see, summaries, what they may add |
| `POST /api/people/:personId/qualifications` | add (`type`, `title`, metadata, `visibility?`, `documentId?`, `renewsId?`) |
| `GET`, `PATCH /api/people/:personId/qualifications/:qualificationId` | one; edit (`expectedVersion`) |
| `POST …/:qualificationId/verify` · `reject` · `resubmit` · `archive` · `renew` | the semantic actions |

## Holding it true

`tests/api/hr/qualifications.test.ts` (readers, summaries, self-checking,
evidence and its reach, renewal, stale pages), the worklist, surfaces and job
tests, the E2E spec, the cross-company sweep and `verify:employee-integrity`
(self-checked, unnamed verification, superseded still current, evidence on
another person's record).

## Demo data

ARMAAR only: seventeen qualifications of seven people — shared degrees and
skills, licences running out, a renewed safety certificate, a crane
signaller's card waiting for HR, a technician's card sent back with a reason,
a language kept private, and two site workers' licences.
