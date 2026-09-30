# Sync testing (MOB-09 §128-§136, §157-§160)

## Automated

| Suite | File | Covers |
| --- | --- | --- |
| Local database | `tests/unit/offline/database.test.ts` | persistence across close/reopen (app restart), sealing (no plaintext content), per-user isolation, key destruction, cache clearing keeps local-only records, photo bytes round-trip |
| Engine | `tests/unit/offline/engine.test.ts` (with `fake-server.ts`) | a full field day in order, dependency ordering, local→server id mapping, lost response + retry = one record, same operation id every attempt, conflict without overwrite, foreign change detection, permission refusal stays visible, temporary failure back-off then attention, no hammering before back-off, per-photo retry, session ended, identity mismatch, protocol too old, other company / Group workspace, interrupted send recovery, single pass for concurrent triggers, discard cascade, claim refused, duplicate taps |
| Server | `tests/api/sync/sync.test.ts` (real database) | idempotency (ledger and `clientOperationId`, including the crash window), same-day diary, create→edit→row→submit with carried versions, submit retried after a lost record, stale version conflict naming the server state, submission rules, task complete/conflict/non-queueable, permission, company mismatch, removed project, batch isolation, protocol minimum, snapshot contents and window, package contents, incremental refresh (changed/removed), foreign project |
| Browser | `tests/e2e/offline/mob09-offline.spec.ts` (production build, real service worker, `context.setOffline`) | take a project offline, work with the network cut, reload/restart, reconnect and land once; lost response; conflict; claim; revoked access; sign-out guard; workspace opens from the address bar offline |

Run the browser suite against a production build on the demo database:

```bash
createdb -T nesto_aud nesto_mob && DATABASE_URL=…/nesto_mob npx prisma migrate deploy
DATABASE_URL=…/nesto_mob NEXT_DIST_DIR=.next-mob09 npx next build --turbopack
DATABASE_URL=…/nesto_mob NEXT_DIST_DIR=.next-mob09 npx next start -p 3211
DATABASE_URL=…/nesto_mob E2E_PORT=3211 npx playwright test tests/e2e/offline --project=chromium
```

A development server is not a valid target: the service worker caches build files by URL, and a dev build's are not content-hashed.

## Manual — required before calling MOB-09 production-ready (cannot be run from CI here)

| # | Device | Scenario |
| --- | --- | --- |
| 1 | real iPhone | airplane mode; background/resume; force-kill with pending photos; camera; database persistence across restart; Keychain key survives sign-out; low-storage warning; app update with pending work |
| 2 | real iPhone | confirm whether the service worker is available; if App-Bound Domains are adopted, check framed PDF previews and Mapbox |
| 3 | mid-range Android | airplane mode; process kill; background restrictions; camera; Keystore; storage pressure; upload retry; app update |
| 4 | any | Wi-Fi ↔ cellular switch mid-upload; slow and intermittent connection (Network Link Conditioner / Android throttling) |
| 5 | any | long offline period (beyond the window): workspace locks, pending work kept, sync after sign-in |
| 6 | two devices | conflict: A edits offline, B changes online, A reconnects |
| 7 | admin | revoke a project while a device is offline with a diary; confirm the device's message and that nothing is submitted |

## Accessibility

The indicator and sync states always carry text and an icon, never colour alone; the status pill is a polite live region; the conflict and logout dialogs use the same dialog primitive as the rest of NESTO (focus trap, Escape, focus return). Screen reader wording: *"Offline · 3 changes waiting"*, *"1 item needs attention"*.
