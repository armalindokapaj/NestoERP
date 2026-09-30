# App lock, biometrics and app-switcher privacy

- **App lock** asks for biometrics or the device credential when the app returns from the background after the policy's timeout (0 = immediately). The person may turn it on; policy may require it, never forbid it.
- `biometricRequired` demands a biometric where the device has one; the device passcode alone is then not enough.
- A changed, removed or unavailable biometry forces the NESTO password.
- Turning lock on or off is reported to the server as an informational event, never relied upon.
- **App switcher:** iOS uses the privacy-screen plugin overlay (`preventScreenshots:false`); Android 13+ uses `setRecentsScreenshotEnabled(false)`.
- **Sensitive surfaces** (HR, contracts, finance when `sensitiveScreenProtection` is on): Android sets FLAG_SECURE; iOS cannot prevent screenshots.
