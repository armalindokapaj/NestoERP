# Android setup

Prerequisites: Android Studio (or JDK 21 + Android SDK with platform 35/36 and build-tools), Node per `.nvmrc`, `pnpm install`. **This repository's developer machine had no JDK when MOB-08 was written, so the Gradle build is exercised by CI (`native.yml`, job `android`) rather than locally.**

```bash
NESTO_NATIVE_ENV=development pnpm native:android   # configure + cap sync + open Android Studio
```

The emulator reaches the host's dev server at `http://10.0.2.2:3000`:
`NESTO_NATIVE_ORIGIN_DEVELOPMENT=http://10.0.2.2:3000`. Only development builds allow cleartext and WebView remote debugging (`chrome://inspect`).

## Once

1. Package `com.nesto.erp` (permanent).
2. Play Console: create the app, enable **Play App Signing**, create an internal testing track.
3. Release certificate SHA-256 (both the upload key and the Play App Signing key from *App integrity*) → `NESTO_ANDROID_SHA256_CERTS` on the server, so App Links verify.
4. Create a release keystore; store it only in CI secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). `*.jks`/`*.keystore` are git-ignored.
5. A Google service account with Play publishing rights → `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
6. Firebase project for FCM (MOB-10 provider): `google-services.json` stays out of Git.

## Commands

`pnpm native:sync`, `pnpm native:assets`, `cd android && ./gradlew assembleDebug` (debug APK) or `bundleRelease` (store bundle, signing injected by CI). Version: `native/version.json` → `pnpm native:sync`. The manifest's App Links intent filter and permissions are owned by `scripts/native/configure.ts` (between the `nesto:` marker comments).
