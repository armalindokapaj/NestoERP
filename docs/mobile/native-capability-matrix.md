# Native capability matrix (MOB-08 §74-§77)

✓ = built and covered by the shared code path; **device ✓** = exercised on a real device. Nothing is device-verified yet: real-device testing is the open acceptance item, tracked at the bottom. No silent gaps — every cell is an answer.

| Capability | Web | iOS | Android | Notes |
| --- | --- | --- | --- | --- |
| All business modules (Tasks, Projects, Units, Documents…) | ✓ | ✓ | ✓ | One implementation, served to all three |
| Sign-in / session persistence | ✓ | ✓ | ✓ | Same cookie session |
| Camera capture | ✓ (file input) | ✓ | ✓ | `CaptureService`; plugin `@capacitor/camera` |
| Photo library | ✓ | ✓ | ✓ | `@capawesome/capacitor-file-picker` |
| File picker | ✓ | ✓ | ✓ | same; result goes through `UploadService` |
| Uploads | ✓ | ✓ | ✓ | MOB-07 queue unchanged |
| Native share / save | ✓ (Web Share) | ✓ | ✓ | `@capacitor/share` + `@capacitor/filesystem` cache copy |
| Push notifications | — | ✓ registration, tap routing; provider pending (MOB-10) | ✓ same | `@capacitor/push-notifications` |
| Biometric app lock | — | ✓ | ✓ | `@aparajita/capacitor-biometric-auth`; device passcode fallback |
| Secure storage | — | ✓ Keychain | ✓ Keystore-backed | `@aparajita/capacitor-secure-storage` |
| Universal / App Links | ✓ (browser) | ✓ config; needs Team ID | ✓ config; needs cert SHA-256 | `/.well-known/*` |
| Android hardware Back | n/a | n/a (edge swipe = history) | ✓ | `@capacitor/app` |
| App lifecycle, deep-link open | n/a | ✓ | ✓ | `@capacitor/app` |
| Network status | ✓ (online/offline events) | ✓ | ✓ | `@capacitor/network`; deeper offline is MOB-09 |
| Safe areas, status bar, keyboard | ✓ | ✓ | ✓ | CSS `env(safe-area-inset-*)`; `@capacitor/status-bar`, `@capacitor/keyboard` |
| External URLs / tel / mailto | ✓ | ✓ | ✓ | `ExternalLinkService`; `@capacitor/browser` |
| Version gate (required / recommended update) | — | ✓ | ✓ | `/api/app/compatibility`, 426 on mutations |
| PDF viewer | ✓ | to validate | to validate | shared pdf.js viewer |
| Mapbox | ✓ | to validate | to validate | no location permission used |
| Rozaris 3D viewer | ✓ | to validate | to validate | WebGL; existing fallback renderer when WebGPU is absent |
| Share into NESTO (share extension) | — | deferred | deferred | readiness only (PRD §42) |
| Background upload / sync | — | deferred (MOB-09) | deferred (MOB-09) | |

## Native plugins (PRD §74)

| Plugin | Purpose | iOS | Android | Maintenance | Permission / prompt |
| --- | --- | --- | --- | --- | --- |
| `@capacitor/core`, `cli`, `ios`, `android` 8.5.2 | shell runtime | ✓ | ✓ | Ionic, current | — |
| `@capacitor/app` 8.1.1 | lifecycle, deep links, Back, version | ✓ | ✓ | Ionic | — |
| `@capacitor/browser` 8.0.4 | external https links | ✓ | ✓ | Ionic | — |
| `@capacitor/camera` 8.2.4 | take photo | ✓ | ✓ | Ionic | Camera (at tap) |
| `@capawesome/capacitor-file-picker` 8.1.0 | photos and files | ✓ | ✓ | Capawesome | Photos/files (at tap) |
| `@capacitor/filesystem` 8.1.3 | read picked files; cache copy for sharing | ✓ | ✓ | Ionic | — |
| `@capacitor/share` 8.0.2 | share sheet | ✓ | ✓ | Ionic | — |
| `@capacitor/push-notifications` 8.1.2 | APNs / FCM token, tap events | ✓ | ✓ | Ionic | Notifications (at switch) |
| `@aparajita/capacitor-biometric-auth` 10.0.0 | app lock | ✓ | ✓ | community, active | Face ID / biometrics |
| `@aparajita/capacitor-secure-storage` 8.0.1 | Keychain / Keystore | ✓ | ✓ | community, active | — |
| `@capacitor/network` 8.0.1 | connectivity events | ✓ | ✓ | Ionic | — |
| `@capacitor/keyboard` 8.0.5, `status-bar` 8.0.3, `splash-screen` 8.0.2 | keyboard resize, status bar style, launch splash | ✓ | ✓ | Ionic | — |
| `@capacitor/device` 8.0.3 | platform/OS info (diagnostics) | ✓ | ✓ | Ionic | — |
| `@capacitor/assets` 3.0.5 (dev) | icon and splash generation | — | — | Ionic | — |

All versions are pinned exactly in `package.json`.

## Open until a device run

Real-device sessions on a mid-range iPhone and Android phone (cold start, Task → Add Evidence → Camera → Upload → Complete, PDF, Mapbox, 3D incl. fallback, VoiceOver/TalkBack, memory, network loss) and the store builds. The matrix cells marked *to validate* move to **device ✓** only then.
