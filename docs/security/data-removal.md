# NESTO Data Removal

This removes NESTO's own data and access from the install. It is not a wipe of the phone.

- Revoke: CACHE_ONLY. Unsynced work stays sealed and cannot be sent.
- Lost / blocked: FULL. The local database and its key are destroyed.
- The app learns of it from `POST /api/app/device-state` (unauthenticated, keyed by install id + user ids, rate limited, status and instruction only) or the security refresh, then calls `confirmDataRemoval`.
- A disabled account also yields removal (reason ACCOUNT).
- A device that never calls in again keeps what it holds, which is why the offline authorization expires (`offlineAuthorizationHours`, server time).
- A project whose access changed has its offline copy emptied and marked "Your access to this project has changed" (`handleRevokedProject`).
