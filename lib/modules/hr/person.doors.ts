import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { linkPersonProfile } from "@/lib/auth/identity";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recruitsAcrossGroup } from "./recruitment/candidate.service";

/*
 * The person record's doors for E-01 (ADR 0002): the identity invariant, the
 * reach HR keeps person records within, and the work-profile write. Apart from
 * `hr.person.ts` on purpose: that file's name helpers are read from modules
 * that reach the browser, and these need the database.
 */

/**
 * Every login that works in a group has a person there (E-01 §219, ADR 0002).
 *
 * Called by every door that makes somebody a member of a company without HR
 * having recorded them first — accepting an invitation is the one left. A login
 * already linked keeps its person. Otherwise an unlinked person of the group
 * with the same email is theirs; failing that, one is made from the account,
 * as `personForMember` always has.
 */
export async function ensurePersonForUser(
  tx: Prisma.TransactionClient,
  input: { userId: string; parentGroupId: string; jobTitle?: string | null; createdByUserId?: string | null },
): Promise<string> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, personProfileId: true },
  });
  if (user.personProfileId) return user.personProfileId;

  if (user.email) {
    const match = await tx.personProfile.findFirst({
      where: { parentGroupId: input.parentGroupId, workEmail: { equals: user.email, mode: "insensitive" }, user: { is: null } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (match) {
      await linkPersonProfile(tx, user.id, match.id);
      return match.id;
    }
  }

  const person = await tx.personProfile.create({
    data: {
      parentGroupId: input.parentGroupId,
      firstName: user.firstName,
      lastName: user.lastName,
      jobTitle: input.jobTitle ?? null,
      workEmail: user.email,
      workPhone: user.phone,
      lifecycleStatus: "EMPLOYEE",
      createdByUserId: input.createdByUserId ?? null,
    },
    select: { id: true },
  });
  await linkPersonProfile(tx, user.id, person.id);
  return person.id;
}

/**
 * Whether the person record is within this reader's reach for private data
 * and managed edits (ADR 0002 decision 4): the reach HR recruits with — the
 * reader's company, or the whole group for somebody who recruits across it.
 * The permission itself is the caller's to check.
 */
export async function personInRecordReach(context: UserContext, personProfileId: string): Promise<boolean> {
  const person = await prisma.personProfile.findFirst({
    where: { id: personProfileId, parentGroupId: context.parentGroupId },
    select: {
      user: { select: { memberships: { where: { companyId: context.companyId }, select: { id: true } } } },
      employments: { where: { companyId: context.companyId }, select: { id: true } },
      candidacies: { where: { targetCompanyId: context.companyId }, select: { id: true } },
    },
  });
  if (!person) return false;
  if (recruitsAcrossGroup(context)) return true;
  return (person.user?.memberships.length ?? 0) + person.employments.length + person.candidacies.length > 0;
}

export type WorkProfileChange = Partial<{
  preferredName: string | null;
  jobTitle: string | null;
  workEmail: string | null;
  workPhoneExtension: string | null;
  officeLocation: string | null;
  professionalBio: string | null;
}>;

/**
 * The person record's door for the work profile (E-01 §116, ADR 0002). Only
 * work-profile columns, only inside the group; who may change which of them is
 * the caller's rule. One email is one person in a group (E-06 §23).
 */
export async function updatePersonWorkProfile(
  tx: Prisma.TransactionClient,
  input: { personProfileId: string; parentGroupId: string; change: WorkProfileChange },
): Promise<void> {
  const { change } = input;
  if (change.workEmail) {
    const clash = await tx.personProfile.count({
      where: { parentGroupId: input.parentGroupId, id: { not: input.personProfileId }, workEmail: { equals: change.workEmail, mode: "insensitive" } },
    });
    if (clash > 0) throw new AccessError("CONFLICT", "Somebody in the group already has that email address.", { field: "workEmail", code: "EMAIL_TAKEN" });
  }
  // Named column by column: the lifecycle status is never a work-profile change.
  const updated = await tx.personProfile.updateMany({
    where: { id: input.personProfileId, parentGroupId: input.parentGroupId },
    data: {
      preferredName: change.preferredName,
      jobTitle: change.jobTitle,
      workEmail: change.workEmail,
      workPhoneExtension: change.workPhoneExtension,
      officeLocation: change.officeLocation,
      professionalBio: change.professionalBio,
    },
  });
  if (updated.count === 0) throw new AccessError("NOT_FOUND");
}
