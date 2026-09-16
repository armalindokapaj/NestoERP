# Document scanning runbook

Per PRD #29 §54-§63, PRD #38 §99-§101, §175, PRD #51 §35, §176, §193.

## How the gate works

With a scanner configured, an uploaded file stays `SCANNING` until the scanner
returns `CLEAN`. `INFECTED` moves the object to the quarantine prefix, deletes it
from the business key space and marks the file `REJECTED` with an audit event.
Anything else — an unreachable scanner, a timeout, an error reply, a reply that is
not understood — is `ERROR`: the file stays unavailable and is retried, a minute
later, then doubling up to six hours between attempts. After 12 attempts (about 20
hours) the file becomes `FAILED` with `FILE_SCAN_FAILED`, audited as
`DOCUMENT_SCAN_FAILED`: it was never checked, so it is never made available, and
the uploader is told to upload it again. The object is kept. There is no override
(PRD #29 §279).

A scan is claimed before it runs (`scanStatus` `SCANNING`, `scanStartedAt`,
`scanAttempts`), and every verdict is written only over that claim. A worker or
request that dies mid-scan leaves a claim the sweep takes back after 15 minutes, so
no file stays `SCANNING` forever, and two sweeps never both decide one file.

A later version of a document is scanned the same way; the document keeps serving
its current version until the new one is clean (PRD #38 §58). A version is never
made current over a newer one: an older version whose scan finishes late stays in
the history.

## Configuration

| Variable | Meaning |
|---|---|
| `STORAGE_SCANNER` | `none` (development), `eicar` (tests only — refused in production), `clamav` |
| `CLAMAV_HOST`, `CLAMAV_PORT` (3310), `CLAMAV_TIMEOUT_MS` (30000) | The clamd service, reached over TCP with `INSTREAM` |
| `STORAGE_SCANNER_REQUIRED` | Staging and production refuse to start with no scanner unless this is `false` |
| `SCAN_BATCH_SIZE` | Files read per query by `documents.scan` (default 25); each run drains everything due |

`STORAGE_SCANNER=clamav` without `CLAMAV_HOST` is refused at startup in deployed
environments; anywhere it slips through, every verdict is `ERROR`, so files wait
rather than skipping the scan.

clamd must accept files at least as large as the upload limit: set `StreamMaxLength`
in `clamd.conf` above the largest allowed upload, or those files come back
`INSTREAM size limit exceeded` → `ERROR` and never become available.

Keep signatures current (`freshclam`) and monitor the clamd container like any
other dependency.

## Scan queue growing

```sql
SELECT "scanStatus", max("scanAttempts"), count(*), min(coalesce("uploadedAt", "createdAt")) FROM documents
WHERE "storageStatus" = 'SCANNING' GROUP BY 1;
```

Metrics: `scan_queue_size`, `scan_queue_age_seconds`, `scan_retrying`,
`scan_claims_abandoned`, `scan_failed_last_hour` — each counting documents and
document versions.

1. `pnpm worker --status` — is `documents.scan` running and succeeding?
2. Logs: `storage.scan.failed` (the scanner threw), `storage.scan.error` (it answered
   ERROR), `storage.scan.gave_up` (a file reached its last attempt).
3. Can the worker reach clamd? From the worker host: `nc -z $CLAMAV_HOST $CLAMAV_PORT`.
4. `scan_claims_abandoned` above zero for more than a few minutes means scans are
   claimed and never finished — workers or upload requests dying mid-scan. They are
   taken back after 15 minutes; find out why they die
   (`docs/worker-operations.md#workers-keep-dying-mid-run`).
5. Each run drains every file that is due, so a growing queue with a healthy
   scanner is a slow scanner: look at clamd's CPU before anything else. Another
   `documents` worker adds failover, not speed — the scan job runs on one worker at
   a time.

## Infected file reported

The file is already quarantined and rejected. The signature name is in the audit
event `DOCUMENT_REJECTED_MALWARE` and the `storage.scan.infected` log line, never in
the interface. Follow the security incident process; do not restore the object to
the business key space.

## Scanner outage

Uploads keep succeeding and wait in `SCANNING`. Nothing becomes downloadable until
clamd is back; the sweep then drains the queue oldest first. Tell users their files
are "being checked" — that is exactly what the interface already says.

An outage longer than about 20 hours fails the files that waited through all their
attempts. Find them, and ask their uploaders to upload again:

```sql
SELECT "companyId", count(*), min("scanCompletedAt") FROM documents
WHERE "storageStatus" = 'FAILED' AND "rejectionReason" = 'FILE_SCAN_FAILED'
GROUP BY 1;
```

## Quarantine move owed

An infected file is rejected and audited first, then its object is moved to the
quarantine prefix. If that move fails, the file stays `REJECTED` with
`scanStartedAt` still set, the run fails (`PARTIAL_FAILURE`), and the sweep retries
the move every 15 minutes. `scan_quarantine_owed` counts them; a number that does
not fall is a storage permissions problem on the quarantine prefix.
