# Recent authentication

`Session.recentAuthAt` is set by the server at sign-in and by a password check (`POST /api/me/security/reauthenticate`, platform equivalent under `/api/platform-admin`). A sensitive action calls `assertRecentAuthentication` (`lib/auth/recent-auth.ts`); outside the policy's `recentAuthMinutes` (default 15, max 240) it answers 403 `REAUTH_REQUIRED`. It fails closed, uses server time and reads nothing from the client.

Required for: revoking or signing out devices and sessions, saving mobile policy, and sensitive surfaces. Wrong passwords are throttled per account (`PASSWORD_CHANGE`). The field does not assume a password; SSO would set the same field.
