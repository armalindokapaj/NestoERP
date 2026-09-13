# Document scanning runbook

Per PRD #29 §54-§63, PRD #38 §99-§101, §175.

## How the gate works

With a scanner configured, an uploaded file stays `SCANNING` until the scanner
returns `CLEAN`. `INFECTED` moves the object to the quarantine prefix, deletes it
from the business key space and marks the file `REJECTED` with an audit event.
Anything else — an unreachable scanner, a timeout, an error reply, a reply that is
not understood — is `ERROR`: the file stays unavailable and the next sweep retries
it. There is no override (PRD #29 §279).

A later version of a document is scanned the same way; the document keeps serving
its current version until the new one is clean (PRD #38 §58).

## Configuration

| Variable | Meaning |
|---|---|
| `STORAGE_SCANNER` | `none` (development), `eicar` (tests only — refused in production), `clamav` |
| `CLAMAV_HOST`, `CLAMAV_PORT` (3310), `CLAMAV_TIMEOUT_MS` (30000) | The clamd service, reached over TCP with `INSTREAM` |
| `STORAGE_SCANNER_REQUIRED` | Staging and production refuse to start with no scanner unless this is `false` |
| `SCAN_BATCH_SIZE` | Files per `documents.scan` run (default 25) |

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
SELECT "scanStatus", count(*), min("updatedAt") FROM documents
WHERE "storageStatus" = 'SCANNING' GROUP BY 1;
```

1. `pnpm worker --status` — is `documents.scan` running and succeeding?
2. Logs: `storage.scan.failed` (the scanner threw) and `storage.scan.error` (it answered ERROR).
3. Can the worker reach clamd? From the worker host: `nc -z $CLAMAV_HOST $CLAMAV_PORT`.
4. Raise `SCAN_BATCH_SIZE` or run another `documents` worker — leases keep it safe.

## Infected file reported

The file is already quarantined and rejected. The signature name is in the audit
event `DOCUMENT_REJECTED_MALWARE` and the `storage.scan.infected` log line, never in
the interface. Follow the security incident process; do not restore the object to
the business key space.

## Scanner outage

Uploads keep succeeding and wait in `SCANNING`. Nothing becomes downloadable until
clamd is back; the sweep then drains the queue oldest first. Tell users their files
are "being checked" — that is exactly what the interface already says.
