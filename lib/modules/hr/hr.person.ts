import type { Prisma } from "@prisma/client";

import { linkPersonProfile } from "@/lib/auth/identity";
import type { UserContext } from "@/lib/context/types";

/**
 * The person behind an employment record (E-06 §22, §25; E-04 §2-§7).
 *
 * An employment record always names a person, and names a membership only
 * once Group IT has provisioned a login — which many employees never need: a
 * mason, a driver, a site labourer (E-04 §1). So HR addresses an employee by
 * the employment, names them from the person, and treats the login as one
 * optional fact about them: whether they have a NESTO account.
 */

export const PERSON_NAME_SELECT = {
  select: { firstName: true, lastName: true },
} as const satisfies { select: Prisma.PersonProfileSelect };

export type PersonName = { firstName: string; lastName: string };

export function personName(person: PersonName): string {
  return `${person.firstName} ${person.lastName}`;
}

/**
 * Whether the employee has a NESTO account (E-04 §17, §20): none at all, one
 * they can use, or one that is switched off. Derived, never stored — the
 * membership and the user are the account's own records.
 */
export type AccountStatus = "HAS_ACCOUNT" | "NO_ACCOUNT" | "ACCOUNT_SUSPENDED";

export const ACCOUNT_STATUSES = ["HAS_ACCOUNT", "NO_ACCOUNT", "ACCOUNT_SUSPENDED"] as const satisfies readonly AccountStatus[];

export function accountStatusOf(member: { status: string; user: { status: string } | null } | null): AccountStatus {
  if (!member) return "NO_ACCOUNT";
  const usable = (member.status === "ACTIVE" || member.status === "INVITED") && member.user?.status === "ACTIVE";
  return usable ? "HAS_ACCOUNT" : "ACCOUNT_SUSPENDED";
}

/** The employments whose account is in this state, as a filter (E-04 §20, §263). */
export function accountStatusWhere(status: AccountStatus): Prisma.EmployeeProfileWhereInput {
  switch (status) {
    case "NO_ACCOUNT":
      return { companyMemberId: null };
    case "HAS_ACCOUNT":
      return { companyMember: { is: { status: { in: ["ACTIVE", "INVITED"] }, user: { status: "ACTIVE" } } } };
    case "ACCOUNT_SUSPENDED":
      return {
        companyMemberId: { not: null },
        NOT: { companyMember: { is: { status: { in: ["ACTIVE", "INVITED"] }, user: { status: "ACTIVE" } } } },
      };
  }
}

/**
 * The person an employment record for this member should name: the one their
 * login is linked to, or — for a login that predates person records — a new
 * one in this group made from the account's own details.
 */
export async function personForMember(
  tx: Prisma.TransactionClient,
  context: UserContext,
  member: { userId: string; jobTitle: string | null },
): Promise<string> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: member.userId },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, personProfileId: true, personProfile: { select: { parentGroupId: true } } },
  });
  if (user.personProfileId && user.personProfile?.parentGroupId === context.parentGroupId) return user.personProfileId;

  const person = await tx.personProfile.create({
    data: {
      parentGroupId: context.parentGroupId,
      firstName: user.firstName,
      lastName: user.lastName,
      jobTitle: member.jobTitle,
      workEmail: user.email,
      workPhone: user.phone,
      lifecycleStatus: "EMPLOYEE",
      createdByUserId: context.userId,
    },
    select: { id: true },
  });
  // A login with no person yet gets this one; a login already linked to a
  // person in another group keeps it (a user has at most one, E-06 §26).
  if (!user.personProfileId) await linkPersonProfile(tx, user.id, person.id);
  return person.id;
}

/**
 * A person's own name and phone, changed on their account page, are the same
 * name and phone on their person record (E-08 §57 makes the person canonical;
 * until then the two are kept equal from this side).
 */
export async function syncPersonFromAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  profile: { firstName: string; lastName: string; phone: string | null },
): Promise<void> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { personProfileId: true } });
  if (!user.personProfileId) return;
  await tx.personProfile.update({
    where: { id: user.personProfileId },
    data: { firstName: profile.firstName, lastName: profile.lastName, workPhone: profile.phone },
  });
}
