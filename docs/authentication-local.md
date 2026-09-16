# Local authentication

How somebody signs in to NESTO V0.1, and what deliberately plays no part in it.
PRD #50 §2-§9, §16-§24, §66, §67, §317, §318.

## The short version

```text
V0.1 login = username + password
email is not required
Microsoft 365 / Entra ID is not active
```

## Username is the identifier

`User.username` is what an account signs in with. It is unique across the
platform, and stored already normalised — trimmed, NFKC, lowercased — so
`Owner`, ` owner ` and `owner` are one account rather than three. Every lookup
normalises its input the same way and compares exactly, which leaves the unique
index doing the work.

NFKC comes first for a reason worth stating: without it, `admin` written with a
fullwidth `ａ` would be a second account that is indistinguishable from the
first in every list it ever appears in.

A username is 3 to 32 characters, starts and ends alphanumeric, and may contain
`.`, `_` and `-` between. `lib/auth/username.ts` holds the rule, the reserved
list and the normalisation, and nothing else implements any of them.

**Reserved names** — `admin`, `root`, `system`, `support`, `nesto`, `api`,
`worker` and the rest of the list — cannot be *chosen*. They are refused
however they are typed, homographs included. The list governs new usernames,
not existing ones: accounts migrated from before the rule keep the name they
were given, which is why the demo company's administrator still signs in as
`admin`.

## Email is contact metadata

`User.email` is optional and nothing authenticates by it. An account with no
address at all signs in, is administered, and recovers its password exactly
like one that has an address — `tests/integration/auth/local-login.test.ts`
asserts that directly, because it is the claim most likely to quietly stop
being true.

No flow requires mail to be delivered: not sign-in, not password recovery, not
startup. An installation with no mail transport configured works.

## Passwords

Hashed with bcrypt at cost 12 (`lib/auth/password.ts`). The PRD names Argon2id;
bcrypt is used because it needs no native build step, which keeps `pnpm install`
identical on every machine and in CI. Swapping the implementation means changing
that one file — nothing else touches a hash.

Stored alongside the hash: `passwordChangedAt`, `mustChangePassword`, and
`temporaryPasswordExpiresAt`. Plaintext is never persisted and never logged.

## Recovery is an administrator's action

There is no self-service reset. `/forgot-password` carries one sentence telling
people to contact their administrator, and takes no input at all; there is no
`/reset-password` route, no token in an inbox, and no reset mail template.

An administrator holding `team.member.password.reset` calls
`resetMemberPassword`, which in one transaction:

- replaces the password with a generated temporary one,
- sets `mustChangePassword` so the holder must choose their own,
- sets an expiry 72 hours out, after which it stops working used or not,
- revokes **every** session on the account, and
- writes a `CRITICAL` audit event carrying the username, the expiry and the
  number of sessions revoked — and neither the password nor its hash.

The temporary password is returned to the caller once and is passed on however
that organisation already passes such things on. It is four groups of four from
an alphabet with `0`/`O` and `1`/`l`/`I` left out, because dictating it down a
telephone is exactly how it gets delivered.

Resetting your own password through this path is refused: that is the
change-password flow, which asks for the current password first. Otherwise
somebody at an unlocked screen could take over the account without knowing it.

## Rate limiting and lockout

Sign-in failures are counted per account and per address, and the check happens
*before* the password is verified — so a locked account costs an attacker
nothing to learn and the server no bcrypt round. Failures against a username
nobody holds count the same way, so the lockout itself cannot be used to
discover which accounts exist.

Every failure gives one generic answer. Wrong password, unknown username,
lapsed temporary password, suspended account, no active membership: the caller
cannot tell them apart.

## What is deliberately absent

Email login, email OTP, magic links, email password reset, email invitations,
Microsoft 365 / Entra ID, Google SSO, SAML, OIDC federation, passkeys and MFA.
None of these are implemented, and `docs/session-security.md` covers what the
session does instead.

## Future: Microsoft 365 / Entra ID

Future scope, and the schema must not block it. The shape it takes when it
arrives:

```text
NESTO User → ExternalIdentity → Microsoft Entra ID → Microsoft 365
```

An external identity **attaches to** an existing NESTO `User`; it does not
replace it. `User` stays the global identity and `CompanyMember` stays the
company access identity, so a person federated tomorrow keeps every record they
authored today. Nothing in V0.1 authenticates through a provider, and no
provider column exists yet — what matters is that adding one is additive.
