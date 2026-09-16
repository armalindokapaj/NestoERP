# Account administration

Creating, recovering and taking away access to a NESTO account, without any of
it depending on mail. PRD #50 §16-§23, §55-§63, §258-§265.

## Two identities, not one

```text
User          the global NESTO identity — username, password, name
CompanyMember the company access identity — role, department, status
```

Authentication resolves the `User`. Authorisation resolves the
`CompanyMember`. One person may hold memberships in several companies with a
different role in each, and the same account signs in to all of them.

This split is why deactivating somebody in one company does not touch their
access elsewhere, and why a future external identity provider can attach to the
`User` without any company's data moving.

## What an administrator can do

| Action | Permission | Effect |
|---|---|---|
| Invite a member | `team.member.invite` | Creates the invitation; the account appears once accepted. |
| Change role or department | `team.member.role.assign`, `team.member.department.assign` | Access follows on the member's next request. |
| Deactivate | `team.member.deactivate` | Blocks authentication for that company, keeps every record they authored. |
| Suspend / unsuspend | `team.member.suspend`, `team.member.unsuspend` | Same, intended as temporary. |
| Reset password | `team.member.password.reset` | Temporary password, forced change, every session revoked. |

`team.member.password.reset` is a grant of its own rather than part of
`team.manage`. Managing somebody's role is not the same authority as taking
over their credential, and an audit that cannot tell the two apart is not much
of an audit.

## Resetting a password

The whole of account recovery in V0.1 — there is no self-service path, and
nothing here sends a message.

1. An administrator resets the member's password.
2. NESTO generates a temporary password and shows it **once**.
3. The administrator passes it on out of band — however that organisation
   already passes such things on.
4. Every session on the account is revoked immediately, so whoever was signed
   in stops being signed in. That includes whoever the reset is protecting
   against.
5. The holder signs in with the temporary password and is required to choose
   their own before doing anything else.
6. The temporary password expires after 72 hours whether or not it was used.

What the audit trail keeps: who did it, to which member, the username, the
expiry and how many sessions were revoked. What it never keeps: the password or
its hash.

## Deactivation, not deletion

Hard-deleting a `User` is forbidden once business history exists. A person who
approved an invoice, locked a daily log or signed off an inspection is part of
that record's history, and removing the row would leave the record unable to
say who did it.

Deactivating instead: revokes sessions, blocks authentication, and preserves
every authored record with its actor intact.

## Showing a temporary password on screen

It is displayed once, is not stored in readable form, and cannot be retrieved
afterwards — a second reset issues a new one. Anyone who can see the screen can
see the credential, which is the same property a written-down password has and
the reason the forced change exists.
