import type { Prisma, QualificationVisibility } from "@prisma/client";

import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { hrReachWhere } from "@/lib/modules/hr/documents/employee-document.access";

/**
 * Who may see a qualification, and how much of it (E-02 §8, §32-§37, §103,
 * §111, §122-§124; ADR 0007).
 *
 * A qualification is the person's, held across the group, so every clause
 * starts from the reader's group — another group's person is never reached
 * (§9). Within it there are three readers:
 *
 *   colleague  anybody who may read profiles: the summary of a qualification
 *              the person shares with the group, once verified and while
 *              current — never its number, its notes or its file (§34-§37)
 *   self       the person: everything of theirs but what HR keeps to itself
 *   HR         `hr.document.view`, the person employed in the reader's company
 *              inside their HR scope, not themselves: everything but what the
 *              person keeps private; RESTRICTED needs `hr.document.private.view`
 *
 * The supporting file is never opened through any of these: it is a Document
 * and answers to its own rules (§35, §104).
 */

export const SELF_QUALIFICATION_VISIBLE: QualificationVisibility[] = ["PRIVATE", "EMPLOYEE_AND_HR", "GROUP_SUMMARY"];

/** The reader's own person record, if their login has one. */
export async function readerPersonId(context: UserContext): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: context.userId }, select: { personProfileId: true } });
  return user?.personProfileId ?? null;
}

/** People the reader reaches as HR: employed here, in their HR scope, and not themselves. */
export function hrPersonWhere(context: UserContext): Prisma.PersonProfileWhereInput {
  return { parentGroupId: context.parentGroupId, employments: { some: hrReachWhere(context) } };
}

function hrVisibilities(context: UserContext): QualificationVisibility[] {
  return ["EMPLOYEE_AND_HR", "HR_ONLY", "GROUP_SUMMARY", ...(can(context, "hr.document.private.view") ? (["RESTRICTED"] as const) : [])];
}

/** The HR reader alone, as a clause — what HR's worklists read (§153, §154). Null for none. */
export function hrQualificationWhere(context: UserContext, ownPersonId: string | null): Prisma.PersonQualificationWhereInput | null {
  if (!can(context, "hr.document.view")) return null;
  return {
    parentGroupId: context.parentGroupId,
    person: hrPersonWhere(context),
    visibility: { in: hrVisibilities(context) },
    ...(ownPersonId ? { personProfileId: { not: ownPersonId } } : {}),
  };
}

/** The full records this reader may see, as a clause — null for none (§105, §106). */
export function fullQualificationWhere(context: UserContext, ownPersonId: string | null): Prisma.PersonQualificationWhereInput | null {
  const branches: Prisma.PersonQualificationWhereInput[] = [];
  if (ownPersonId) branches.push({ personProfileId: ownPersonId, visibility: { in: SELF_QUALIFICATION_VISIBLE } });
  const hr = hrQualificationWhere(context, ownPersonId);
  if (hr) branches.push(hr);
  if (branches.length === 0) return null;
  return { parentGroupId: context.parentGroupId, OR: branches };
}

/** What colleagues see: verified, shared with the group, current, not put away (§34, §111). */
export function summaryQualificationWhere(context: UserContext): Prisma.PersonQualificationWhereInput {
  return { parentGroupId: context.parentGroupId, visibility: "GROUP_SUMMARY", verificationStatus: "VERIFIED", isCurrent: true, archivedAt: null };
}

/** Whether HR reaches this person: employed in the reader's company, in their HR scope, and not the reader. */
export async function hrReachesPerson(context: UserContext, personId: string, ownPersonId: string | null): Promise<boolean> {
  if (!can(context, "hr.document.view") || personId === ownPersonId) return false;
  return (await prisma.personProfile.count({ where: { AND: [hrPersonWhere(context), { id: personId }] } })) > 0;
}

/** How this reader may add to or change a person's qualifications: as the person, as HR, or not at all (§69). */
export async function qualificationRole(context: UserContext, personId: string): Promise<{ ownPersonId: string | null; via: "SELF" | "HR" | null; verifier: boolean }> {
  const ownPersonId = await readerPersonId(context);
  if (ownPersonId === personId) return { ownPersonId, via: can(context, "people.qualification.add_self") ? "SELF" : null, verifier: false };
  const reach = await hrReachesPerson(context, personId, ownPersonId);
  return {
    ownPersonId,
    via: reach && can(context, "hr.qualification.manage") ? "HR" : null,
    // Never one's own (§74): the branch above has already answered for the person themselves.
    verifier: reach && can(context, "hr.qualification.verify"),
  };
}
