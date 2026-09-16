# Mail delivery runbook

Per PRD #38 §10-§16, §21, §173.

## How mail leaves NESTO

Business code calls `sendMail` in `lib/mail/mail.service.ts` with a template key
and variables. The service renders the template, records a `MailDelivery` row,
and hands the rendered message to the configured provider. Nothing outside
`lib/mail` knows which provider that is.

| `MAIL_PROVIDER` | What it does | Where it is allowed |
|---|---|---|
| `memory` (default) | Captures the message in process memory | development, tests |
| `console` | Prints the message to the log | development |
| `resend` | Resend HTTPS API | staging (with allowlist), production |
| `postmark` | Postmark HTTPS API | staging (with allowlist), production |

A deployment with `APP_ENV=production` and a sink provider records every
delivery as `FAILED` with `MAIL_PROVIDER_NOT_CONFIGURED`, and
`lib/config/env.ts` refuses that configuration outright.

Required with a real provider: `MAIL_FROM` (for example
`NESTO <no-reply@mail.example.com>`) and `MAIL_API_KEY`. Staging additionally
requires `MAIL_ALLOWED_RECIPIENTS` — a comma-separated list of exact addresses
and `@domain` entries. A staging message to anyone else is recorded as
`SUPPRESSED` and never sent.

## Running without email

`MAIL_DELIVERY=disabled` is a deployment that sends no email, on purpose (PRD #51
§212, §215). It lifts the production requirement for a provider and credentials,
every message is recorded `SUPPRESSED` with `MAIL_DELIVERY_DISABLED`, and the
notification dispatcher writes in-app notifications without attempting email.
Nothing people need arrives by email then: an administrator resets a password
and hands over the temporary one (`docs/account-administration.md`), and an
invitation link works without its email but has to be passed on by hand.

Use it during a long provider outage too: in-app notifications keep flowing
instead of every dispatch waiting on a provider timeout. Unset it and restart the
web and worker processes to send again; nothing suppressed is replayed.

## What is recorded, and what is not

`mail_deliveries` holds the recipient, template key, provider, provider message
id, status, error code, attempt count and the record the message was about
(`entityType` / `entityId`, for example `CompanyInvite`). **The body is never
stored**: an invitation or reset link is a credential. The same is true of the
logs — `mail.send.failed` carries the delivery id, template and error code,
never the address or the link.

Rows are purged after 180 days (`mail-deliveries.settled`).

## Statuses

- `SENT` — the provider accepted the message. Not proof of inbox delivery;
  check the provider's dashboard with `providerMessageId`.
- `FAILED` — the provider refused it or could not be reached after three
  attempts (250 ms and 1 s apart for retryable errors).
- `SUPPRESSED` — deliberately not sent: the staging allowlist, or
  `MAIL_DELIVERY_DISABLED` on a deployment that sends no email.
- `QUEUED` — recorded, send in progress. A row that stays `QUEUED` means the
  process died mid-send.

## Finding failures

```sql
SELECT "templateKey", "errorCode", count(*)
FROM mail_deliveries
WHERE status = 'FAILED' AND "createdAt" > now() - interval '1 hour'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

Metrics: `mail_send_failure_count`, `mail_send_success_count`,
`mail_retry_count`, `mail_suppressed_count` on `/api/internal/metrics`.
Alert when failures exceed successes over 15 minutes.

The invitation list under Team shows "The email could not be delivered" on any
open invitation whose latest delivery failed.

## Provider outage

1. Confirm on the provider's status page, and in the error codes above
   (`NETWORK_ERROR`, `HTTP_5xx`).
2. Nothing needs replaying. Failed messages are recovered by issuing new ones,
   because the old link cannot be rebuilt from metadata:
   - **Invitations**: once the provider is back, resend from Team → Invitations.
     Resend issues a new token and retires the old one.
   - **Password resets**: the person requests another link.
   - **Notification emails**: the notification itself is in NESTO; the email is
     a convenience and is not retried after the outage.
3. If the outage is long, consider switching provider (below).

## Failed sends that are not an outage

| Error code | Meaning | Action |
|---|---|---|
| `MAIL_PROVIDER_NOT_CONFIGURED` | Production is on a sink | Set `MAIL_PROVIDER` |
| `MAIL_CREDENTIALS_MISSING` | Provider set, key or from missing | Set `MAIL_API_KEY`, `MAIL_FROM` |
| `HTTP_401` / `HTTP_403` | Key revoked or wrong | Rotate the key (below) |
| `VALIDATION_ERROR`, `POSTMARK_300` | Rejected message (often the from address) | Verify the sending domain |
| `POSTMARK_406` | Recipient inactive (bounced before) | Ask for a corrected address |

## Rotating the API key

1. Create a new key in the provider console, scoped to sending only.
2. Update `MAIL_API_KEY` in the deployment's secret store.
3. Restart the web and worker processes — the provider is built once per process.
4. Send a password reset to an operator address and confirm a `SENT` row.
5. Revoke the old key.

## Switching provider

Set `MAIL_PROVIDER`, `MAIL_API_KEY` and `MAIL_FROM` for the new provider,
verify the sending domain there first (SPF, DKIM), restart, and send a test
reset. No code changes.

## Sandbox and production mismatch

Symptoms: production deliveries are `SUPPRESSED`, or staging mail reaches real
customers.

- `SUPPRESSED` in production means `APP_ENV` is not `production` on that
  deployment. Fix `APP_ENV`; the allowlist is ignored in production.
- A staging deployment reaching customers means it is running with
  `APP_ENV=production` or with a production key. Treat as an incident: rotate
  the production key, correct `APP_ENV`, and review `mail_deliveries` on the
  staging database for recipients outside the allowlist.
