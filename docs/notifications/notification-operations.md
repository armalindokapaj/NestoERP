# Notification operations

Extends `docs/runbooks/notification-worker.md`.

## Configuration

`PUSH_PROVIDER=off|log|live` (default off: no delivery rows are written, nothing queues). `PUSH_BATCH_SIZE` (default 100 deliveries per tick). Credentials: see push-security.md. Push drains at the end of each `notifications.dispatch` run (every 10 s); a failure of the push drain is logged (`notification.push.drain_failed`) and never fails the dispatch job.

## Gauges and counters

| Name | Meaning |
|---|---|
| `push_queue_due`, `push_queue_oldest_due_age_seconds` | deliveries past their send time not yet sent; alert if the age grows |
| `push_attempted_last_hour`, `push_accepted_last_hour` | provider acceptance (accepted ≠ delivered ≠ read) |
| `push_failed_last_hour` | exhausted retries |
| `push_token_invalid_last_hour` | dead tokens the provider rejected |
| `push_attempted_count{platform}`, `push_accepted_count`, `push_failed_count{platform,final}`, `push_token_invalid_count` | process counters |

Suggested alerts: queue age > 5 min; failed or invalid-token rate > an agreed fraction of attempts; outbox backlog (existing).

## Investigating "I did not get the push"

```sql
SELECT d."state", d."attemptCount", d."lastErrorCode", d."sendAfter", d."settledAt", d."platform"
FROM push_deliveries d JOIN notifications n ON n.id = d."notificationId"
WHERE n.id = '<notification id>';
```

- no row → push off, category/project preference, no device, LOW priority, or provider not configured at dispatch time;
- `QUEUED` with future `sendAfter` → backoff or quiet hours;
- `SUPPRESSED` (`DEVICE_GONE`, `NOT_ACTIONABLE`, `PROVIDER_NOT_CONFIGURED`) → signed out / read already / provider off at send time;
- `TOKEN_INVALID` → the device was switched off; it re-enables when the app re-registers;
- `PROVIDER_ACCEPTED` → the provider took it; OS delivery and display are outside NESTO's knowledge.

Rows hold no message text; the notification row does not hold push content either.

## Retention

Read notifications are purged after twelve months by the existing retention policy (`notifications.read`). Users can archive older notifications out of the inbox (`POST /api/notifications/{id}/archive`); archiving keeps the row and never changes the business record. `push_deliveries` cascade with their notification.

## Admin page

Platform admin → System → Notifications (`/admin/system/notifications`, permission `platform.operations.view`) shows the last 24 hours: push mode and whether APNs/FCM credentials are set (never their values), registered devices, attempted/accepted/failed/invalid/suppressed, queue waiting, events processed, notifications created, outbox backlog and failures. No recipients, tokens, message text or per-person read times.
