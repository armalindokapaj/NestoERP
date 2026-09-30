# Device management

A **Device** is a durable install of the app for one user (`DeviceRegistration`). A **Session** points at it (`Session.deviceId`); ending a session never deletes the device.

## States
`ACTIVE`, `REVOKED`, `BLOCKED`; `STALE` is derived (no contact for 60 days). Compliance state/action and trust/managed fields are computed by the server.

## Actions
| Action | Effect |
| --- | --- |
| Sign out | The device's sessions end; it may sign in again |
| Revoke | Sessions ended, push token removed, CACHE_ONLY data removal queued |
| Lost | As revoke, FULL data removal, `lostReportedAt` set |
| Block | As revoke, status BLOCKED, FULL data removal |
| Restore | Status ACTIVE, removal cancelled |
| Rename | Own devices only |

All run in one transaction with the audit row (`revokeDevice`, `restoreDevice`, `signOutDevice` in `lib/auth/device.service.ts`).

## Who can do what
| Surface | Permission | Scope |
| --- | --- | --- |
| Settings → Mobile devices | none beyond sign-in | own devices |
| Company / Group Admin → devices | `security.device.view`, `.revoke`, `.manage` | own company, or each company of the group for group IT |
| Platform Admin | platform commands `device.action` | any |

Reading, revoking and editing policy are separate grants. Security events are listed with `security.events.view`.
