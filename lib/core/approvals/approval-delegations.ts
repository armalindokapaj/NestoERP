import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";

/**
 * Who is standing in for whom, right now (PRD #41 §32-§34, §171-§173).
 *
 * Only the lookup lives here, because the modules that honour a delegation —
 * a document review assigned to one person, a chain step that belongs to a
 * role — need it inside their own decision transaction. Creating and revoking
 * delegations is the Approvals Center's (lib/modules/approvals).
 *
 * One hop only: a delegation lends the delegator's own assignments, never
 * something that was itself lent to them, so the question is always asked of
 * direct delegations and nothing recursive can form.
 */

type Client = Prisma.TransactionClient | typeof prisma;

export type ActiveDelegation = {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  providerKey: string | null;
  startsAt: Date;
  endsAt: Date;
};

const SELECT = { id: true, fromMemberId: true, toMemberId: true, providerKey: true, startsAt: true, endsAt: true } as const;

function liveWhere(companyId: string, providerKey: string, now: Date): Prisma.ApprovalDelegationWhereInput {
  return {
    companyId,
    active: true,
    revokedAt: null,
    startsAt: { lte: now },
    endsAt: { gt: now },
    OR: [{ providerKey: null }, { providerKey }],
    // A delegation from somebody who has since left lends nothing.
    fromMember: { status: "ACTIVE", user: { status: "ACTIVE" } },
  };
}

/** Delegations currently lent to this member for this provider. */
export async function delegationsTo(
  companyId: string,
  memberId: string,
  providerKey: string,
  options: { now?: Date; client?: Client } = {},
): Promise<ActiveDelegation[]> {
  const client = options.client ?? prisma;
  return client.approvalDelegation.findMany({
    where: { ...liveWhere(companyId, providerKey, options.now ?? new Date()), toMemberId: memberId },
    select: SELECT,
    orderBy: { startsAt: "asc" },
  });
}

/** The live delegation from one member to another for this provider, if any. */
export async function delegationBetween(
  companyId: string,
  fromMemberId: string,
  toMemberId: string,
  providerKey: string,
  options: { now?: Date; client?: Client } = {},
): Promise<ActiveDelegation | null> {
  const client = options.client ?? prisma;
  return client.approvalDelegation.findFirst({
    where: { ...liveWhere(companyId, providerKey, options.now ?? new Date()), fromMemberId, toMemberId },
    select: SELECT,
  });
}
