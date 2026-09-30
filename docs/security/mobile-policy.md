# Mobile security policy

Levels: **Platform** (environment floor plus platform row), **Group**, **Company**. `resolveMobilePolicy` (`lib/core/security/mobile-policy.schema.ts`) merges them; the strictest value wins.

| Kind | Rule |
| --- | --- |
| Booleans that require (app lock, biometrics, screen protection) | OR |
| "Allow" flags (offline, export, share, external open) | AND |
| Timeouts, offline hours, recent-auth minutes | minimum |
| Versions | maximum |
| Risk policy, notification preview | strictest value |
| Unset everywhere | documented default |

A Group with `allowCompanyOverride:false` drops its Company levels. Saving rejects values weaker than a parent level. A person in several companies is held to the strictest across all active memberships (controls apply to the whole device). Defaults (owner to confirm): app lock offered not forced, modified device warns, export and share allowed, 72 h offline, recent auth 15 min. Every save is versioned, audited and recomputes affected devices at once.
