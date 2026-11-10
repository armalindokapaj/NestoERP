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

A Group with `allowCompanyOverride:false` drops its Company levels. Saving rejects values weaker than a parent level. A person in several companies is held to the strictest across all active memberships (controls apply to the whole device). An Owner of a group (OWNER on an active membership of one of its companies, or on an active seat; a company or group the platform deleted makes nobody an Owner) is held to the Platform and that Group's level only: the group's Company levels do not bind them (`levelsBindingPerson`; the user, 2026-11-10: "Group owner is protected."), and the policy page says so. Defaults (owner to confirm): app lock offered not forced, modified device warns, export and share allowed, 72 h offline, recent auth 15 min. Every save is versioned, audited and recomputes affected devices at once. So does every Team, Company Users, group Users, invitation and Company CEO change to a person's memberships or seat (`recheckDevicesAfterAccessChange`), since it can make or end a group owner; the platform console's own membership, company-status and recovery screens do not yet, and those phones catch up when the app next checks in.
