# Native release process (MOB-08 §63-§73)

## Versioning

`native/version.json` holds the release: `version` (semver, shared by iOS and Android, matches the NESTO release where semantics allow) and per-platform build numbers (`iosBuild`, `androidBuild`, each strictly increasing). `pnpm native:sync` writes them into Xcode (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`), Gradle (`versionName`, `versionCode`) and the user-agent suffix `NESTOApp/<version> (<platform>; build <n>)` the server reads.

## What needs a store release

| Change | Ship by |
| --- | --- |
| Pages, components, actions, APIs, queries, copy, styles, backend fixes | **Web deploy** — reaches web, iOS, Android at once |
| New/updated native plugin, permission string, entitlement, `capacitor.config.ts`, allowed origin, deep-link domain, icon/splash, native SDK | **Binary release** (TestFlight → App Store, Internal → Production) |
| Web code that needs a native capability older binaries lack | Binary release first, then a web deploy that feature-detects via `hasCapability`; raise the minimum version only if old binaries would break |

## Compatibility levers (server env, no binary needed)

- `NESTO_MIN_APP_VERSION` — below it: blocking **Update** screen, and `426` on any non-GET.
- `NESTO_RECOMMENDED_APP_VERSION` — below it: a dismissible "newer version" prompt.
- `NEXT_PUBLIC_IOS_STORE_URL`, `NEXT_PUBLIC_ANDROID_STORE_URL` — where **Update** goes.

Force an update only when continuing would be unsafe or incompatible; never for cosmetic releases.

## Release steps

1. Web gates green on the commit (`ci.yml`): lint, typecheck, unit, integration, security, responsive.
2. Bump `native/version.json`, `pnpm native:sync`, commit.
3. Tag `vX.Y.Z`. `native.yml` builds the Android debug + iOS simulator shells, then — after approval on the `store-release` environment — signs and uploads to **TestFlight** and the Play **internal** track.
4. Test on real devices (the scenarios in MOB-08 §92-§97). Promote in App Store Connect / Play Console.
5. Keep the previous binary supported until `NESTO_MIN_APP_VERSION` is deliberately raised.

## Secrets (CI `store-release` environment only)

`IOS_DISTRIBUTION_CERT_P12_BASE64`, `IOS_DISTRIBUTION_CERT_PASSWORD`, `IOS_APPSTORE_PROFILE_BASE64`, `IOS_TEAM_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_P8`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Nothing signing-related is committed.

## Privacy declarations for the stores

Permissions used: camera, photo library/files, notifications, biometrics (Face ID / fingerprint). Collected data: what a signed-in user already puts in NESTO; the app adds device platform, app version and a push token (no advertising ID, no tracking, no location).
