# Secure storage

Keychain (iOS) and Keystore-backed preferences (Android) hold: the install id, the app-lock flag, the last biometry kind, the cached security state, the push token and per-user offline keys. Nothing long-lived sits in `localStorage`.

The install id is random per install, kept across sign-out, and not a secret. The app-lock flag is a UI gate; the keys are not bound to biometric enrolment (binding would make sealed offline data unrecoverable after an enrolment change). An enrolment change is detected and forces NESTO re-authentication.

Android backup is disabled (`allowBackup=false`, `data_extraction_rules.xml`, `backup_rules.xml`). Open: confirm iOS keychain accessibility on hardware (iOS-K1). Accessibility settings apply only to keys written after this change.
