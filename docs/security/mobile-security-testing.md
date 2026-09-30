# Mobile security testing

## Automated
`tests/unit/mobile-security` (policy merge, compliance, versions); `tests/api/mobile-security` (device lifecycle, revocation, data-removal probe, recent auth, policy scope); `tests/api/notifications` (send-time re-check); security sweeps via `pnpm test:security`.

## Physical-device plan (not yet run)
| ID | Device | Check |
| --- | --- | --- |
| iOS-K1 | iPhone | Keychain items are this-device-only and not in iCloud Keychain |
| iOS-S1 | iPhone | App switcher shows the overlay, not content |
| iOS-B1 | iPhone | Enrolment change forces NESTO password |
| AND-F1 | Android 13+ | Sensitive surface blocks screenshot (FLAG_SECURE); recents preview blank |
| AND-B1 | Android | `adb backup` yields nothing |
| ALL-R1 | both | Revoke from Admin: next request refused; airplane mode then online: removal runs |
| ALL-L1 | both | Lost: FULL removal, local database gone |
| ALL-O1 | both | Offline past the window: protected content closes |
