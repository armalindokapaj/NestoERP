# Native architecture (MOB-08)

One NESTO product, three ways to open it. The iOS and Android apps are a thin
Capacitor shell whose WebView loads the canonical NESTO origin (hosted shell,
see [the audit](MOB-08-native-readiness-audit.md) §2). There is no second UI, no
second API and no second identity system.

```
Business UI ── lib/device (services) ──┬─ web adapter     lib/device/web.ts
                                         └─ native adapter  lib/device/native/index.ts (Capacitor)
```

## Where things live

| Concern | File |
| --- | --- |
| Shell config, environment → origin | `capacitor.config.ts`, `native/origins.ts` |
| Offline fallback page (the only bundled web asset) | `native/www/offline.html` |
| Version numbers (web-independent) | `native/version.json` |
| Project configuration `cap sync` does not own | `scripts/native/configure.ts` |
| Icons and splash | `scripts/native/make-assets.ts` → `native/assets/` → `pnpm native:assets` |
| Platform detection + capability flags | `lib/device/platform.ts` |
| Service interfaces | `lib/device/types.ts` |
| Link classification, deep-link resolution | `lib/device/links.ts` |
| Version compatibility contract | `lib/device/compatibility.ts`, `GET /api/app/compatibility`, `middleware.ts` |
| Startup wiring (links, Back, resume, lock, update prompt) | `components/platform/native-bootstrap.tsx` |
| Device registration | `lib/auth/device.service.ts`, `/api/me/devices`, `DeviceRegistration` |

## Rules

1. Business code imports `getPlatformServices()`; it never imports Capacitor and never tests for iOS/Android. Platform differences are a row in `hasCapability()` and in the [capability matrix](native-capability-matrix.md).
2. The native adapter is loaded by dynamic import only inside the shell, so no plugin code is in a browser bundle.
3. Before adding native-specific UI, ask whether the platform service can carry the difference (PRD §100). Nothing in a module is forked.
4. A change ships by **web deploy** unless it touches the binary: plugins, permissions, entitlements, `capacitor.config.ts`, icons/splash, allowed origins, the deep-link domain, native SDKs. Those need a store release (`native-release-process.md`).
5. Environments: `NESTO_NATIVE_ENV=development|staging|production` selects the origin at `cap sync` time. Production and staging refuse localhost, private addresses and plain http (`native/origins.ts`, unit-tested).

## What the shell deliberately does not do

No Projects, Tasks, Sales, Finance, Unit or HR logic. No offline data store — that is MOB-09. The only bundled page is `offline.html`, shown when the origin cannot be reached.

## Shared scenario (PRD §91)

Changing `TaskCard` changes one file; web, iOS and Android all render it, because the WebView is running the same deployed application.
