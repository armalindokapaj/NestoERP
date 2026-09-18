import type { Prisma } from "@prisma/client";

import { AccessError, assertFound } from "@/lib/access/guards";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";

/**
 * The records E-13's department services work on, always found inside the
 * actor's own group: an id from anywhere else is "not found" (§107, §112).
 */

export type Client = Prisma.TransactionClient | typeof prisma;

export async function loadGroupDepartment(client: Client, parentGroupId: string, id: string) {
  return assertFound(
    await client.groupDepartment.findFirst({
      where: { id, parentGroupId },
      select: { id: true, parentGroupId: true, key: true, code: true, name: true, description: true, status: true },
    }),
  );
}

export type LoadedGroupDepartment = Awaited<ReturnType<typeof loadGroupDepartment>>;

/** A company branch of one of the group's departments (§14), with its company. */
export async function loadBranch(client: Client, parentGroupId: string, branchId: string) {
  const branch = assertFound(
    await client.department.findFirst({
      where: { id: branchId, company: { parentGroupId }, groupDepartmentId: { not: null }, groupDepartment: { parentGroupId } },
      select: {
        id: true,
        companyId: true,
        status: true,
        company: { select: { id: true, name: true, status: true } },
        groupDepartment: { select: { id: true, parentGroupId: true, key: true, code: true, name: true, description: true, status: true } },
      },
    }),
  );
  return { ...branch, groupDepartment: branch.groupDepartment! };
}

export type LoadedBranch = Awaited<ReturnType<typeof loadBranch>>;

export async function loadCompany(client: Client, parentGroupId: string, companyId: string) {
  return assertFound(await client.company.findFirst({ where: { id: companyId, parentGroupId }, select: { id: true, name: true, status: true } }));
}

/** Refused while the department or its branch is not active (§89, §90, §122). */
export function assertOpen(department: { name: string; status: string }, branch?: { status: string; company: { name: string } }): void {
  if (department.status !== "ACTIVE") throw new AccessError("CONFLICT", `${department.name} is inactive. Reactivate it first.`, { code: "DEPARTMENT_INACTIVE" });
  if (branch && branch.status !== "ACTIVE") {
    throw new AccessError("CONFLICT", `${department.name} is not active in ${branch.company.name}. Activate it there first.`, { code: "BRANCH_INACTIVE" });
  }
}

/**
 * The person asked for, and the login their department place is recorded on
 * (§24, §31). A person of another group is not found; one with no NESTO account
 * is refused until E-04 lets somebody without one hold a place.
 */
export async function loadPerson(client: Client, parentGroupId: string, personId: string) {
  const person = assertFound(
    await client.personProfile.findFirst({
      where: { id: personId, parentGroupId },
      select: { id: true, firstName: true, lastName: true, jobTitle: true, user: { select: { id: true, status: true } } },
    }),
  );
  const name = `${person.firstName} ${person.lastName}`.trim();
  if (!person.user) {
    throw new AccessError("VALIDATION_ERROR", `${name} has no NESTO account yet. A department place is held by somebody who can sign in.`, { field: "personId", code: "NO_ACCOUNT" });
  }
  if (person.user.status !== "ACTIVE") {
    throw new AccessError("VALIDATION_ERROR", `${name}'s account is not active.`, { field: "personId", code: "ACCOUNT_INACTIVE" });
  }
  return { personId: person.id, userId: person.user.id, name, jobTitle: person.jobTitle };
}

export type LoadedPerson = Awaited<ReturnType<typeof loadPerson>>;

/** The active memberships of a login in the group's active companies, oldest first. */
export async function membershipsInGroup(client: Client, parentGroupId: string, userId: string) {
  return client.companyMember.findMany({
    where: { userId, status: "ACTIVE", company: { parentGroupId, status: "ACTIVE" } },
    select: { id: true, companyId: true, departmentId: true, role: { select: { key: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Who may hold a place in a company's branch (§79, §82, §83): somebody who
 * works in that company, or somebody who works for the whole group — the
 * group-level member covering several companies (§27). Nobody else, and nobody
 * is created to make it true.
 */
export async function placeEligibility(client: Client, parentGroupId: string, person: LoadedPerson, companyId: string) {
  const [memberships, groupLevel] = await Promise.all([
    membershipsInGroup(client, parentGroupId, person.userId),
    client.parentGroupMember.count({ where: { parentGroupId, userId: person.userId, status: "ACTIVE" } }),
  ]);
  const here = memberships.find((membership) => membership.companyId === companyId) ?? null;
  if (!here && (groupLevel === 0 || memberships.length === 0)) {
    throw new AccessError("VALIDATION_ERROR", `${person.name} is not eligible for this company: they do not work in it, or for the whole group.`, { field: "personId", code: "NOT_ELIGIBLE" });
  }
  // The role their place is recorded with: the one they work as there, else their first.
  return { membership: here, roleKey: (here ?? memberships[0]).role.key };
}

/** The membership a department notification reaches a person through (§93). */
async function recipientMembership(client: Client, parentGroupId: string, userId: string, companyId: string | null) {
  const memberships = await membershipsInGroup(client, parentGroupId, userId);
  return memberships.find((membership) => membership.companyId === companyId) ?? memberships[0] ?? null;
}

type DepartmentNotice =
  | { event: "HEAD"; companyName?: undefined; change?: undefined }
  | { event: "MANAGER" | "MEMBER"; companyName: string; change?: undefined }
  | { event: "CHANGED"; change: string; companyName?: string };

const EVENTS = {
  HEAD: NotificationEvent.DEPARTMENT_HEAD_ASSIGNED,
  MANAGER: NotificationEvent.DEPARTMENT_MANAGER_ASSIGNED,
  MEMBER: NotificationEvent.DEPARTMENT_MEMBER_ADDED,
  CHANGED: NotificationEvent.DEPARTMENT_ASSIGNMENT_CHANGED,
} as const;

/** Tells the person whose place it is, in the transaction that made it (§93). */
export async function notifyPerson(
  tx: Prisma.TransactionClient,
  input: { parentGroupId: string; userId: string; companyId: string | null; groupDepartmentId: string; actorMemberId: string | null; notice: DepartmentNotice },
): Promise<void> {
  const membership = await recipientMembership(tx, input.parentGroupId, input.userId, input.companyId);
  if (!membership) return;
  await enqueueNotificationEvent(tx, {
    companyId: membership.companyId,
    eventType: EVENTS[input.notice.event],
    moduleKey: "organization",
    entityType: "group_department",
    entityId: input.groupDepartmentId,
    actorMemberId: input.actorMemberId,
    payload: { memberId: membership.id, companyName: input.notice.companyName ?? null, change: input.notice.change ?? null },
  });
}
