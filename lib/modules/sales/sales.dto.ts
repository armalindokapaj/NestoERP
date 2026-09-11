import type { MembershipStatus } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import type { MemberRef } from "./sales.types";

/**
 * The shapes every Sales DTO shares (PRD #17 §201–§205, §417).
 *
 * A sales record's actor is always a `CompanyMember`, never a `User`: the same
 * person in two companies is two memberships, and the audit trail has to say
 * which one acted (PRD #17 §417).
 */

type MemberRow = {
  id: string;
  status: MembershipStatus;
  user: { firstName: string; lastName: string };
};

/**
 * `active` travels with the name on purpose (PRD #17 §428, §430).
 *
 * An opportunity whose owner has left the company still needs an owner shown,
 * and the list needs to be able to say so rather than silently displaying a
 * name nobody can reach.
 */
export function toMemberRef(row: MemberRow | null | undefined): MemberRef | null {
  if (!row) return null;
  return {
    memberId: row.id,
    fullName: `${row.user.firstName} ${row.user.lastName}`,
    active: row.status === "ACTIVE",
  };
}

export async function loadMemberRef(memberId: string | null): Promise<MemberRef | null> {
  if (!memberId) return null;
  const member = await prisma.companyMember.findUnique({
    where: { id: memberId },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });
  return toMemberRef(member);
}

export function contactFullName(contact: { firstName: string; lastName: string }): string {
  return `${contact.firstName} ${contact.lastName}`;
}
