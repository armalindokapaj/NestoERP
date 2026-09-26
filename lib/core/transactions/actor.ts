import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";

/**
 * The actor, re-read at the commit boundary (AUD-06 §7, RP-16).
 *
 * A request resolves its context once, decides, then writes. A revocation that
 * commits in between — the membership suspended, the account deactivated, the
 * role changed, the session ended by sign-out or a demo user switch — would
 * otherwise be followed by a write the actor no longer had the right to make,
 * committed after the revocation and announced by its own activity and
 * notification rows.
 *
 * Called first inside the write's transaction, this reads the rows those
 * revocations change and holds a share lock on them until the transaction
 * ends. The two then serialise, whichever starts first:
 *
 *   - the revocation committed first: this read waits for it, sees the new
 *     state and refuses, and the transaction rolls back with nothing written —
 *     no activity, no outbox event;
 *   - this transaction locked first: the revocation's UPDATE or DELETE waits
 *     for it to commit, so the write is ordered before the revocation, which
 *     then applies to the record as it now is.
 *
 * Lock order: the actor's `company_members` row, then the `users` row, then the
 * `sessions` row — before any record the transaction writes. `mutateTask` takes
 * the membership first as well, so the two orders agree.
 *
 * What it covers: membership status, account status, the membership's role and
 * — for a signed-in actor — the session row. What it does not: a module switch,
 * a project assignment, a department position or a delegated grant. Those are
 * per-record facts only the calling service knows; they are checked when the
 * context is resolved, on every request, and a service that needs them at the
 * commit boundary locks those rows itself (as `mutateTask` locks the project
 * and assignee rows).
 *
 * A context with no session — `buildMemberContexts` for a recipient, a job's
 * member context — has its membership, account and role re-read the same way;
 * there is no session row to hold.
 */
export async function assertActorCurrent(tx: Prisma.TransactionClient, context: UserContext): Promise<void> {
  // Locked first, then read: a role is looked up only after the membership row
  // is held, because a join evaluated against a concurrently updated row
  // re-checks the new row against the old join partner and loses the row.
  const actor = await tx.$queryRaw<Array<{ membership: string; user: string; roleId: string }>>`
    SELECT cm."status"::text AS "membership", u."status"::text AS "user", cm."roleId" AS "roleId"
    FROM "company_members" cm
    JOIN "users" u ON u."id" = cm."userId"
    WHERE cm."id" = ${context.membershipId} AND cm."companyId" = ${context.companyId} AND cm."userId" = ${context.userId}
    FOR SHARE OF cm, u`;
  const row = actor[0];
  // The same public codes the resolver's refusals map to (lib/api/respond.ts):
  // the caller's own state, disclosing nothing about anybody else.
  if (!row || row.membership !== "ACTIVE" || row.user !== "ACTIVE") throw new AccessError("MEMBERSHIP_INACTIVE");
  // Decided under one role, committing under another: refused either way, since
  // the decision was not made under the rules that now apply. The next request
  // resolves the new role and decides again.
  // Compared in SQL: the stored role against the one decided under, never a
  // role name standing in for a permission.
  const [role] = await tx.$queryRaw<Array<{ unchanged: boolean }>>`
    SELECT "key" = ${context.role} AS "unchanged" FROM "roles" WHERE "id" = ${row.roleId}`;
  if (!role?.unchanged) {
    throw new AccessError("FORBIDDEN", "Your access changed while this was being saved. Nothing was saved.");
  }

  if (!context.sessionId) return;
  const session = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
    SELECT "expiresAt" FROM "sessions" WHERE "id" = ${context.sessionId} AND "userId" = ${context.userId} FOR SHARE`;
  // Compared here, not in SQL: the database's clock reads local time (Europe/Tirane).
  if (!session[0] || session[0].expiresAt.getTime() <= Date.now()) throw new AccessError("UNAUTHENTICATED");
}
