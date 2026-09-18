import type { Prisma } from "@prisma/client";

import { linkPersonProfile } from "@/lib/auth/identity";
import type { UserContext } from "@/lib/context/types";

/**
 * The person behind an employment record (E-06 §22, §25).
 *
 * An employment record always names a person, and names a membership once
 * Group IT has provisioned a login. Every V0.1 HR screen is addressed by
 * membership id, so the HR scope builders only reach records that have one;
 * `memberAddressed` narrows the rows those queries return to match, and says
 * so loudly if a record without a login ever slips through.
 */

export const PERSON_NAME_SELECT = {
  select: { firstName: true, lastName: true },
} as const satisfies { select: Prisma.PersonProfileSelect };

export type PersonName = { firstName: string; lastName: string };

export function personName(person: PersonName): string {
  return `${person.firstName} ${person.lastName}`;
}

type MemberBearing = { companyMemberId: string | null; companyMember: unknown };

export type MemberAddressed<T extends MemberBearing> = T & {
  companyMemberId: string;
  companyMember: NonNullable<T["companyMember"]>;
};

export function memberAddressed<T extends MemberBearing>(row: T): MemberAddressed<T> {
  if (row.companyMemberId === null || row.companyMember === null) {
    throw new Error("An employment record without a login reached a screen addressed by membership.");
  }
  return row as MemberAddressed<T>;
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
