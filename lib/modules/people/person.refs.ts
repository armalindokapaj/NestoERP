import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * Which person a record's reference means (E-08 §69).
 *
 * Most records name somebody by their membership in a company, some by their
 * login and HR's by their employment; the profile is the person's. These answer
 * the person behind a reference inside the reader's parent group and nowhere
 * else: another group's membership, login or employment is no person at all.
 * Whether the reader may then open the profile is the profile's own rule.
 */

export type PersonRefKind = "member" | "user" | "employee";

export async function personIdFor(context: UserContext, kind: PersonRefKind, id: string): Promise<string | null> {
  const group = context.parentGroupId;
  if (kind === "member") {
    const member = await prisma.companyMember.findFirst({ where: { id, company: { parentGroupId: group } }, select: { user: { select: { personProfileId: true } } } });
    return member?.user.personProfileId ?? null;
  }
  if (kind === "user") {
    const user = await prisma.user.findFirst({ where: { id, personProfile: { is: { parentGroupId: group } } }, select: { personProfileId: true } });
    return user?.personProfileId ?? null;
  }
  const employment = await prisma.employeeProfile.findFirst({ where: { id, company: { parentGroupId: group } }, select: { personProfileId: true } });
  return employment?.personProfileId ?? null;
}
