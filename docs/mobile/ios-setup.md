# iOS setup

Prerequisites: macOS, Xcode 26+ (developed with Xcode 27), Node per `.nvmrc`, `pnpm install`. Capacitor 8 uses Swift Package Manager (no CocoaPods); the first build downloads the plugin packages.

```bash
NESTO_NATIVE_ENV=development pnpm native:ios      # configure + cap sync + open Xcode
```

Run the web app first (`pnpm dev`). Development points the simulator at `http://localhost:3000`; a physical device needs `NESTO_NATIVE_ORIGIN_DEVELOPMENT=http://<your-mac-LAN-ip>:3000` (development builds only may use http; ATS exceptions are not added — use an https dev URL if the device blocks it).

## Once, in Apple's portals

1. Bundle ID `com.nesto.erp` (permanent). Enable **Associated Domains** and **Push Notifications**.
2. Note the Team ID → `NESTO_IOS_TEAM_ID` on the server (Universal Links).
3. App Store Connect: create the app record; create an API key for CI (`APP_STORE_CONNECT_*` secrets).
4. Create an APNs auth key for MOB-10's provider (not needed to build).
5. In Xcode: select the **App** target → Signing & Capabilities → choose your Team (automatic signing for local work). The entitlements file (`ios/App/App/App.entitlements`) is generated; `aps-environment` flips to production automatically for App Store archives.

## Commands

| Task | Command |
| --- | --- |
| Sync config/plugins | `pnpm native:sync` (runs `scripts/native/configure.ts` first) |
| Regenerate icons/splash | `pnpm native:assets` |
| Simulator build from CLI | `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build` |
| Version | edit `native/version.json`, run `pnpm native:sync` |

Do not hand-edit version numbers, the bundle identifier, `Info.plist` permission strings or the entitlements in Xcode — `configure.ts` owns them and will overwrite the change.
