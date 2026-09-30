# Mobile security model (MOB-11)

The server decides. The app reports, caches what it was told and carries out NESTO Data Removal; nothing it sends is trusted as proof.

## Actors and assets
| Asset | Where it lives | Protected by |
| --- | --- | --- |
| Session | Server `Session` row; the cookie carries only its id | Deleting the row ends access on the next request; fixed 8 h expiry |
| Device identity | `DeviceRegistration` (`installId` random per install, not a hardware id) | Server row; survives sign-out |
| Offline data | Per-user AES-GCM database, key in Keychain/Keystore | Offline authorization window; NESTO Data Removal |
| Policy | `MobileSecurityPolicy` (Platform, Group, Company) | `security.policy.manage`, recent authentication, audit |

## Threats and answers
| Threat | Answer |
| --- | --- |
| Lost or stolen phone | Mark lost: sessions ended, push removed, FULL data removal queued; offline window bounds what an unreachable phone keeps |
| Stolen unlocked session | Sensitive actions need recent authentication (server state) |
| Revoked install signs in again | `nesto-install` cookie binds the session to the device row; the resolver refuses revoked/blocked devices |
| Obsolete or vulnerable build | Compliance engine: minimum/secure version, blocked builds, OS floor |
| Shoulder surfing / app switcher | Privacy overlay (iOS), recents screenshot off (Android 13+), FLAG_SECURE on sensitive surfaces |
| Cloud backup of app data | Android `allowBackup=false` plus exclusion rules |
| Cross-tenant admin access | Scope rules per permission; a company outside the caller's scope answers NOT_FOUND |

## Not claimed
No remote wipe of the phone (only NESTO's own data and access); no root/jailbreak detection (a client-reported hint only); iOS cannot block screenshots; certificate pinning is not adopted (a wrong pin locks installed apps out until a store release).
