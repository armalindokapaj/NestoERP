# Native authentication (MOB-08 §20-§26, §36, §96)

The app signs in against the same Auth.js credentials flow as the browser. There
is no `MobileUser`, `MobilePassword` or `MobileSession`.

- **Session** — the Auth.js JWT cookie plus the server `Session` row, held in the WebView's persistent cookie store. Because the WebView's document *is* the NESTO origin the cookie is first-party and works unchanged. Lifetime is the server's 8 h `SESSION_TTL_MS`; reopening the app inside that window needs no login.
- **Revocation** — unchanged: ending the session deletes the row, `requireModule()` reads live permissions, the next request is rejected and the client's existing session-ended handling clears state and returns to `/login`. Nothing in the shell caches authorisation.
- **Biometrics = app lock, not a credential.** Settings → Notifications → *This device* → App lock. After the app has been in the background for 60 s, resume shows a native-backed lock cover and asks Face ID / Touch ID / Android biometrics (device passcode allowed). Success reveals the existing session. Failure, cancel or unavailable leaves the lock up with a **Sign in with password** button, which runs the normal logout → `/login`. No password or token is stored. The only thing in secure storage is the `applock.enabled` flag (and the push token), in the Keychain (iOS) / Keystore-backed encrypted preferences (Android) via `@aparajita/capacitor-secure-storage`.
- **Turning the lock on** requires passing it once, so nobody can enable a lock they cannot open.
- **Logout** (`logout()` in `lib/auth/client-lifecycle.ts`): the existing local termination and server session end run as before; on native it additionally unregisters the OS push token and clears secure storage. The server deletes the session, which cascades to the `DeviceRegistration` rows it created.
- **Demo user switch** remains logout + login (C-01). Because logout clears the push token and local secrets and the registration belongs to the session, a switch cannot leave the previous person's identity on the device.
- **Open decision** — phones use the 8 h session like every client. A longer mobile session is a server policy change, not a native one.
