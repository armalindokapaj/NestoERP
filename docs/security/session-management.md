# Sessions on mobile

The session is the server row; the cookie carries its id only. Inventory (Settings → Security) shows device name, client, last active and whether it is this session; no IP address is shown.

- "Sign out other sessions" and revoking a single session need recent authentication.
- `lastSeenAt` is written at most every 5 minutes per session.
- Sign-out of the current session releases the push token; the device row stays.
- Password change keeps only the current session; admin reset ends all.
