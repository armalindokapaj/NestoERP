# Notification testing

## Automated (run)

| File | Covers |
|---|---|
| `tests/unit/notifications/push.test.ts` | privacy classes and lock-screen text (HR/finance/legal generic; mention bodies withheld), push policy (category, LOW, project mute/important, direct exceptions, critical), Android channels, quiet hours (zone, overnight, end instant, bad zone), retry backoff, APNs JWT signature/payload keys/classification/host/collapse id, FCM body/classification/token reuse |
| `tests/api/notifications/push-delivery.test.ts` | real outbox → queued per device; id-only payload with canonical badge; replay does not double-queue; no device / category off → no rows while the in-app row exists; quiet hours delay; session ended; sign-out keeps history unsent; device changes hands; already read; provider outage retries; retry budget → FAILED; invalid token disables the device; two devices; two workers never double-send |
| `tests/api/notifications/notification-settings.test.ts` | quiet-hours storage and validation, project preferences (own projects only), push preference and mandatory lock, archive (list/count, owner only, row kept) |
| `tests/api/notifications/push-events.test.ts` | real domain actions: one comment with a mention gives the mentioned person one notification and one push (no duplicate generic comment); a later plain comment is inbox-only; a critical hazard is pushed immediately through quiet hours, and held for someone who turned the critical override off |
| `tests/api/sync/sync.test.ts` (added case) | a critical incident reported through the offline sync raises no event before the server has it, exactly one once applied, and none on a retry even after a lost ledger row |
| `tests/e2e/responsive/aud04-mob10-notifications.spec.ts` | Settings → Notifications at 320/390/768/1280: quiet hours saved and read back, override line, Push switch stored, mandatory category locked, no sideways overflow, axe |
| existing `tests/api/notifications/*`, `tests/api/jobs/notifications.*` | dispatch, dedupe, authorization, withdrawn records, due events |

Run API tests against a scratch database that has the demo users (for example a copy of the audit database), after `prisma migrate deploy`, with `DATABASE_URL` pointing at it: `npx vitest run tests/api/notifications`.

## Not run (needs hardware or credentials)

iOS and Android real-device checklists (ios-push.md, android-push.md); a full Web Notification Center regression. Spot checks run: the Activity Center renders and lists notifications at 390px; `aud04-mob06-daily-work`'s notification-centre test fails on a stale selector (`notification-center-list`) left by the Activity Center redesign, not on behaviour. Two other existing specs fail (`collaboration/workflows` Legal review: navigation aborted; `modules/announcements`: `isValidTimeZone is not a function` when the Playwright worker imports the reconcile job) and were not investigated further.
