import type { ParentGroupKind, Prisma } from "@prisma/client";

import { AccessError, assertFound } from "@/lib/access/guards";
import { revokeSessions } from "@/lib/auth/session-store";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { type PlatformPermission } from "@/config/platform";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { bootstrapCompany } from "@/lib/modules/company/company-bootstrap.service";
import type { CreateCompanyInput } from "./platform.schema";

/**
 * Companies with or without a Parent Group (Simplified Company Creation).
 *
 * A company is created from its name alone. Every company still has a business
 * root, because the root is the isolation boundary its people, departments and
 * grants live in (E-06 §3.1, §9). A company created without a group gets a
 * STANDALONE root: its own private workspace, never listed, named or shown as a
 * group. So "no Parent Group" is `parentGroup.kind = STANDALONE`, and no group
 * is invented behind the scenes (§12).
 *
 * Attaching moves the company and its standalone root's rows into the chosen
 * group and removes the empty root. Detaching moves the company, and the people
 * who work only in it, into a new standalone root. Neither recreates the
 * company: its id, projects, documents, units, contracts, modules and audit
 * history stay where they are (§6, §7).
 *
 * Group-wide reach never travels with a move. Group-level members, group heads
 * and GROUP-scoped grants of the old root end before the rows move, so nobody
 * gains access to other companies by the company changing group (§11).
 */

function assertPlatform(context: PlatformContext, permission: PlatformPermission): void {
  if (!canPlatform(context, permission)) throw new AccessError("FORBIDDEN");
}

const SLUG_MAX = 60;

/** A company code from its name: "Acme Construction" → "acme-construction". */
export function slugFromName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return base.length >= 2 ? base : "company";
}

/** The first code free for both companies and roots (groups and standalone roots). */
export async function freeSlug(client: Prisma.TransactionClient | typeof prisma, name: string): Promise<string> {
  const base = slugFromName(name);
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base.slice(0, SLUG_MAX - String(attempt).length - 1)}-${attempt}`;
    const [companies, roots] = await Promise.all([
      client.company.count({ where: { slug: candidate } }),
      client.parentGroup.count({ where: { slug: candidate } }),
    ]);
    if (companies === 0 && roots === 0) return candidate;
  }
  throw new AccessError("CONFLICT", "No free company code was found for that name.");
}

async function companyOrNotFound(companyId: string) {
  const company = assertFound(
    await prisma.company.findFirst({
      where: { id: companyId, parentGroup: { isTestFixture: false } },
      select: { id: true, name: true, slug: true, status: true, parentGroupId: true, parentGroup: { select: { id: true, name: true, kind: true, status: true } } },
    }),
  );
  if (company.status === "DELETED") throw new AccessError("CONFLICT", "This company is deleted. Restore it from Recovery first.", { code: "COMPANY_DELETED" });
  return company;
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A company from its name alone (§2, §4, §10): its code, standalone root,
 * settings, modules, numbering and department branches through the company
 * bootstrap. Nobody is given access to it (§11).
 */
export async function createCompany(context: PlatformContext, input: CreateCompanyInput): Promise<{ companyId: string }> {
  assertPlatform(context, "platform.company.create");
  const slug = await freeSlug(prisma, input.name);
  const result = await bootstrapCompany({ name: input.name, slug, parentGroupSlug: slug, standalone: true, disabledModules: [] });
  await recordPlatformAction(context, result.parentGroupId, {
    actionKey: AuditAction.PLATFORM_COMPANY_CREATED,
    entity: { type: "Company", id: result.companyId, label: input.name },
    after: { companyId: result.companyId, slug, name: input.name, structure: "STANDALONE" },
  });
  return { companyId: result.companyId };
}

/* -------------------------------------------------------------------------- */
/* Moving between roots                                                        */
/* -------------------------------------------------------------------------- */

/** The composite (id, parentGroupId) keys a move rewrites; deferrable since the standalone-companies migration. */
async function deferRootKeys(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
}

/**
 * Ends what reaches beyond one company in a root that is about to be merged or
 * split: group-level members, group heads and GROUP-scoped grants (§11).
 */
async function endGroupWideReach(tx: Prisma.TransactionClient, rootId: string): Promise<number> {
  const now = new Date();
  const members = await tx.parentGroupMember.updateMany({ where: { parentGroupId: rootId, status: "ACTIVE" }, data: { status: "INACTIVE" } });
  await tx.departmentAssignment.updateMany({ where: { parentGroupId: rootId, companyId: null, status: "ACTIVE" }, data: { status: "INACTIVE", endsAt: now } });
  await tx.accessGrant.updateMany({ where: { parentGroupId: rootId, scopeType: "GROUP", revokedAt: null }, data: { revokedAt: now, reason: "Company changed group" } });
  return members.count;
}

/**
 * Attaches a standalone company to a Parent Group (§6). Its standalone root's
 * people, departments, grants and history move into the group; departments the
 * group already runs are merged by key. The empty root is removed.
 */
export async function attachCompanyToGroup(context: PlatformContext, companyId: string, groupId: string, reason: string): Promise<void> {
  assertPlatform(context, "platform.company.configure");
  const company = await companyOrNotFound(companyId);
  if (company.parentGroup.kind !== "STANDALONE") throw new AccessError("CONFLICT", "This company already belongs to a group. Detach it first.", { code: "ALREADY_IN_GROUP" });
  const group = await openGroup(groupId);
  await prisma.$transaction((tx) => attachInTx(tx, context, company, group, reason, true));
}

type MovingCompany = { id: string; name: string; parentGroupId: string };
type TargetGroup = { id: string; name: string; status: string };

async function openGroup(groupId: string): Promise<TargetGroup> {
  const group = assertFound(await prisma.parentGroup.findFirst({ where: { id: groupId, kind: "GROUP", isTestFixture: false }, select: { id: true, name: true, status: true } }));
  if (group.status === "SUSPENDED" || group.status === "ARCHIVED" || group.status === "DELETED") throw new AccessError("CONFLICT", "Companies are not added to a suspended, archived or deleted group.", { code: "GROUP_CLOSED" });
  return group;
}

/** The attach itself, inside the caller's transaction; `record` false when a move records one event instead. */
async function attachInTx(tx: Prisma.TransactionClient, context: PlatformContext, company: MovingCompany, group: TargetGroup, reason: string, record: boolean): Promise<void> {
  const rootId = company.parentGroupId;
  {
    if ((await tx.company.count({ where: { parentGroupId: rootId } })) !== 1) throw new AccessError("CONFLICT", "The company's workspace is shared and cannot be merged.");
    await deferRootKeys(tx);

    // Nothing group-wide in the standalone root becomes group-wide in the group.
    await endGroupWideReach(tx, rootId);
    const alreadyInGroup = await tx.parentGroupMember.findMany({ where: { parentGroupId: group.id }, select: { userId: true } });
    await tx.parentGroupMember.deleteMany({ where: { parentGroupId: rootId, userId: { in: alreadyInGroup.map((row) => row.userId) } } });

    // Departments: the group's own where it runs the same function, the root's otherwise.
    const [rootDepartments, groupDepartments] = await Promise.all([
      tx.groupDepartment.findMany({ where: { parentGroupId: rootId }, select: { id: true, key: true, code: true, name: true } }),
      tx.groupDepartment.findMany({ where: { parentGroupId: group.id }, select: { id: true, key: true, code: true, name: true } }),
    ]);
    let merged = 0;
    for (const department of rootDepartments) {
      const same = groupDepartments.find((candidate) => candidate.key === department.key);
      if (same) {
        await tx.department.updateMany({ where: { groupDepartmentId: department.id }, data: { groupDepartmentId: same.id } });
        await tx.departmentAssignment.updateMany({ where: { groupDepartmentId: department.id }, data: { groupDepartmentId: same.id, parentGroupId: group.id } });
        merged += 1;
      } else {
        if (groupDepartments.some((candidate) => candidate.code === department.code || candidate.name === department.name)) {
          throw new AccessError("CONFLICT", `The group already has a department named or coded like "${department.name}". Rename one of them first.`, { code: "DEPARTMENT_CONFLICT" });
        }
        await tx.groupDepartment.update({ where: { id: department.id }, data: { parentGroupId: group.id } });
      }
    }

    await tx.company.update({ where: { id: company.id }, data: { parentGroupId: group.id, configVersion: { increment: 1 } } });
    const people = await moveRootRows(tx, { from: rootId, to: group.id });
    await tx.groupDepartment.deleteMany({ where: { parentGroupId: rootId } });
    await tx.parentGroup.delete({ where: { id: rootId } });

    // Sessions carry the root they were built in; the next request builds afresh.
    await revokeSessions(tx, { companyId: company.id });
    if (record) await recordPlatformAction(context, group.id, {
      actionKey: AuditAction.PLATFORM_COMPANY_ATTACHED_TO_GROUP,
      entity: { type: "Company", id: company.id, label: company.name },
      before: { companyId: company.id, structure: "STANDALONE" },
      after: { companyId: company.id, name: company.name, parentGroupId: group.id, parentGroupName: group.name, structure: "GROUP", people, departmentsMerged: merged },
      reason,
    }, { tx });
  }
}

/** Every row of one root that is not the company or a department, moved to another. */
async function moveRootRows(tx: Prisma.TransactionClient, root: { from: string; to: string }): Promise<number> {
  const { from, to } = root;
  const people = await tx.personProfile.updateMany({ where: { parentGroupId: from }, data: { parentGroupId: to } });
  await tx.parentGroupMember.updateMany({ where: { parentGroupId: from }, data: { parentGroupId: to } });
  await tx.departmentAssignment.updateMany({ where: { parentGroupId: from }, data: { parentGroupId: to } });
  await tx.accessGrant.updateMany({ where: { parentGroupId: from }, data: { parentGroupId: to } });
  await tx.candidateProfile.updateMany({ where: { parentGroupId: from }, data: { parentGroupId: to } });
  await tx.userProvisioningRequest.updateMany({ where: { parentGroupId: from }, data: { parentGroupId: to } });
  await tx.personQualification.updateMany({ where: { parentGroupId: from }, data: { parentGroupId: to } });
  await tx.demoRecord.updateMany({ where: { parentGroupId: from }, data: { parentGroupId: to } });
  await tx.supportAccessSession.updateMany({ where: { parentGroupId: from }, data: { parentGroupId: to } });
  await tx.companyOwner.updateMany({ where: { holderParentGroupId: from }, data: { holderParentGroupId: to } });
  await tx.auditEvent.updateMany({ where: { parentGroupId: from }, data: { parentGroupId: to } });
  return people.count;
}

export type DetachPreviewDTO = {
  allowed: boolean;
  /** People who also work in another company of the group: they block the detach. */
  sharedPeople: string[];
  /** Group-level members whose place in this company ends on detaching. */
  groupLevelPeople: string[];
  /** People who move with the company. */
  movingPeople: number;
};

/** Whose person profile a company's rows point at, directly or through a login. */
async function peopleOf(tx: Prisma.TransactionClient | typeof prisma, companyIds: string[]): Promise<Set<string>> {
  if (companyIds.length === 0) return new Set();
  const inCompany = { companyId: { in: companyIds } };
  const [employees, members, placements, qualifications, candidates, requests] = await Promise.all([
    tx.employeeProfile.findMany({ where: inCompany, select: { personProfileId: true } }),
    tx.companyMember.findMany({ where: { ...inCompany, user: { personProfileId: { not: null } } }, select: { user: { select: { personProfileId: true } } } }),
    tx.departmentAssignment.findMany({ where: { ...inCompany, user: { personProfileId: { not: null } } }, select: { user: { select: { personProfileId: true } } } }),
    tx.personQualification.findMany({ where: inCompany, select: { personProfileId: true } }),
    tx.candidateProfile.findMany({ where: { targetCompanyId: { in: companyIds } }, select: { personProfileId: true } }),
    tx.userProvisioningRequest.findMany({ where: inCompany, select: { personProfileId: true } }),
  ]);
  return new Set(
    [
      ...employees.map((row) => row.personProfileId),
      ...members.map((row) => row.user.personProfileId),
      ...placements.map((row) => row.user.personProfileId),
      ...qualifications.map((row) => row.personProfileId),
      ...candidates.map((row) => row.personProfileId),
      ...requests.map((row) => row.personProfileId),
    ].filter((id): id is string => Boolean(id)),
  );
}

async function planDetach(tx: Prisma.TransactionClient | typeof prisma, company: { id: string; parentGroupId: string }) {
  const others = await tx.company.findMany({ where: { parentGroupId: company.parentGroupId, id: { not: company.id } }, select: { id: true } });
  const [mine, theirs, groupLevel] = await Promise.all([
    peopleOf(tx, [company.id]),
    peopleOf(tx, others.map((row) => row.id)),
    // Group-level: a member of the group itself, or a head placed at group level.
    tx.user.findMany({
      where: {
        personProfileId: { not: null },
        OR: [
          { parentGroupMemberships: { some: { parentGroupId: company.parentGroupId, status: "ACTIVE" } } },
          { departmentAssignments: { some: { parentGroupId: company.parentGroupId, companyId: null, status: "ACTIVE" } } },
        ],
      },
      select: { id: true, personProfileId: true, firstName: true, lastName: true },
    }),
  ]);
  const groupLevelPeople = new Set(groupLevel.map((user) => user.personProfileId as string));
  const shared = [...mine].filter((id) => theirs.has(id) && !groupLevelPeople.has(id));
  const moving = [...mine].filter((id) => !theirs.has(id) && !groupLevelPeople.has(id));
  const names = shared.length
    ? await tx.personProfile.findMany({ where: { id: { in: shared } }, select: { firstName: true, lastName: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] })
    : [];
  const groupLevelHere = groupLevel.filter((user) => mine.has(user.personProfileId as string));
  return {
    sharedNames: names.map((person) => `${person.firstName} ${person.lastName}`),
    groupLevelUsers: groupLevelHere,
    moving,
  };
}

/** What detaching would do, for the confirmation (§7). */
export async function previewDetach(context: PlatformContext, companyId: string): Promise<DetachPreviewDTO> {
  assertPlatform(context, "platform.company.view");
  const company = await companyOrNotFound(companyId);
  if (company.parentGroup.kind !== "GROUP") return { allowed: false, sharedPeople: [], groupLevelPeople: [], movingPeople: 0 };
  const plan = await planDetach(prisma, company);
  return {
    allowed: plan.sharedNames.length === 0,
    sharedPeople: plan.sharedNames,
    groupLevelPeople: plan.groupLevelUsers.map((user) => `${user.firstName} ${user.lastName}`),
    movingPeople: plan.moving.length,
  };
}

/**
 * Detaches a company from its Parent Group (§7). Refused while anyone who
 * works in it also works in another company of the group. Group-level members
 * stop working in it; everyone else, its department branches and its history
 * move with it into a new standalone root.
 */
export async function detachCompanyFromGroup(context: PlatformContext, companyId: string, reason: string): Promise<void> {
  assertPlatform(context, "platform.company.configure");
  const company = await companyOrNotFound(companyId);
  if (company.parentGroup.kind !== "GROUP") throw new AccessError("CONFLICT", "This company is already standalone.", { code: "ALREADY_STANDALONE" });
  await prisma.$transaction((tx) => detachInTx(tx, context, company, reason, true));
}

/** The detach itself, inside the caller's transaction; returns the new standalone root. */
async function detachInTx(tx: Prisma.TransactionClient, context: PlatformContext, company: MovingCompany & { parentGroup: { id: string; name: string } }, reason: string, record: boolean): Promise<string> {
  const group = company.parentGroup;
  {
    const plan = await planDetach(tx, company);
    if (plan.sharedNames.length > 0) {
      throw new AccessError("CONFLICT", `These people also work in another company of the group: ${plan.sharedNames.join(", ")}. End their place in one of the companies first.`, { code: "SHARED_PEOPLE" });
    }
    const slug = await freeSlug(tx, company.name);
    const root = await tx.parentGroup.create({
      data: { slug, name: company.name, kind: "STANDALONE" satisfies ParentGroupKind, status: "ACTIVE", activatedAt: new Date() },
      select: { id: true },
    });
    await deferRootKeys(tx);

    // Group-level members stop working here; their reach stays with the group.
    const groupUserIds = plan.groupLevelUsers.map((user) => user.id);
    const now = new Date();
    const ended = await tx.companyMember.updateMany({ where: { companyId: company.id, userId: { in: groupUserIds }, status: "ACTIVE" }, data: { status: "INACTIVE" } });
    await tx.departmentAssignment.updateMany({ where: { companyId: company.id, userId: { in: groupUserIds }, status: "ACTIVE" }, data: { status: "INACTIVE", endsAt: now } });

    // The group departments this company's branches belong to, copied into the new root.
    const used = await tx.groupDepartment.findMany({
      where: { parentGroupId: group.id, OR: [{ branches: { some: { companyId: company.id } } }, { assignments: { some: { companyId: company.id } } }] },
      select: { id: true, key: true, code: true, name: true, description: true, status: true },
    });
    for (const department of used) {
      const copy = await tx.groupDepartment.create({
        data: { parentGroupId: root.id, key: department.key, code: department.code, name: department.name, description: department.description, status: department.status, createdByUserId: context.userId },
        select: { id: true },
      });
      await tx.department.updateMany({ where: { companyId: company.id, groupDepartmentId: department.id }, data: { groupDepartmentId: copy.id } });
      await tx.departmentAssignment.updateMany({ where: { companyId: company.id, groupDepartmentId: department.id }, data: { groupDepartmentId: copy.id, parentGroupId: root.id } });
    }

    // The company, then the people who work only here and what hangs off them.
    await tx.company.update({ where: { id: company.id }, data: { parentGroupId: root.id, configVersion: { increment: 1 } } });
    const moving = plan.moving;
    const movingUsers = (await tx.user.findMany({ where: { personProfileId: { in: moving } }, select: { id: true } })).map((user) => user.id);
    await tx.personProfile.updateMany({ where: { id: { in: moving } }, data: { parentGroupId: root.id } });
    await tx.candidateProfile.updateMany({ where: { OR: [{ personProfileId: { in: moving } }, { targetCompanyId: company.id }] }, data: { parentGroupId: root.id } });
    await tx.userProvisioningRequest.updateMany({ where: { OR: [{ personProfileId: { in: moving } }, { companyId: company.id }] }, data: { parentGroupId: root.id } });
    await tx.personQualification.updateMany({ where: { OR: [{ personProfileId: { in: moving } }, { companyId: company.id }] }, data: { parentGroupId: root.id } });
    await tx.departmentAssignment.updateMany({ where: { companyId: company.id }, data: { parentGroupId: root.id } });

    // Grants: a moving person's go with them (group-wide ones ended); anyone
    // else's grant into this company or its projects ends, since it would
    // otherwise reach across the new boundary.
    const projectIds = (await tx.project.findMany({ where: { companyId: company.id }, select: { id: true } })).map((project) => project.id);
    const intoCompany: Prisma.AccessGrantWhereInput = { OR: [{ scopeType: "COMPANY", scopeId: company.id }, { scopeType: "PROJECT", scopeId: { in: projectIds } }] };
    await tx.accessGrant.updateMany({ where: { parentGroupId: group.id, userId: { in: movingUsers }, scopeType: "GROUP", revokedAt: null }, data: { revokedAt: now, reason: "Company left the group" } });
    await tx.accessGrant.updateMany({ where: { parentGroupId: group.id, userId: { notIn: movingUsers }, revokedAt: null, ...intoCompany }, data: { revokedAt: now, reason: "Company left the group" } });
    await tx.accessGrant.updateMany({ where: { parentGroupId: group.id, userId: { in: movingUsers } }, data: { parentGroupId: root.id } });

    await tx.auditEvent.updateMany({ where: { companyId: company.id }, data: { parentGroupId: root.id } });
    await tx.supportAccessSession.updateMany({ where: { companyId: company.id }, data: { parentGroupId: root.id } });

    await revokeSessions(tx, { companyId: company.id });
    const audit = {
      entity: { type: "Company", id: company.id, label: company.name },
      before: { companyId: company.id, parentGroupId: group.id, parentGroupName: group.name, structure: "GROUP" },
      after: { companyId: company.id, name: company.name, structure: "STANDALONE", people: moving.length, groupMembershipsEnded: ended.count },
      reason,
    };
    // Recorded on both sides, so each keeps the history of the move.
    if (record) {
      await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_COMPANY_DETACHED_FROM_GROUP, ...audit }, { tx });
      await recordPlatformAction(context, root.id, { actionKey: AuditAction.PLATFORM_COMPANY_DETACHED_FROM_GROUP, ...audit }, { tx });
    }
    return root.id;
  }
}

/**
 * Moves a group company straight into another group, in one transaction
 * (Organizations PRD §31, §72): the detach and the attach both happen or
 * neither does, so the company is never left standalone half-way. The same
 * rules hold as for each step — shared people refuse it, and no group-wide
 * reach travels — and one event is recorded on each group.
 */
export async function moveCompanyToGroup(context: PlatformContext, companyId: string, groupId: string, reason: string): Promise<void> {
  assertPlatform(context, "platform.company.configure");
  const company = await companyOrNotFound(companyId);
  if (company.parentGroup.kind !== "GROUP") throw new AccessError("CONFLICT", "This company is standalone. Assign it to a group instead.", { code: "ALREADY_STANDALONE" });
  if (company.parentGroupId === groupId) throw new AccessError("CONFLICT", "The company already belongs to that group.", { code: "SAME_GROUP" });
  const group = await openGroup(groupId);
  const from = company.parentGroup;
  await prisma.$transaction(async (tx) => {
    const rootId = await detachInTx(tx, context, company, reason, false);
    await attachInTx(tx, context, { ...company, parentGroupId: rootId }, group, reason, false);
    const audit = {
      actionKey: AuditAction.PLATFORM_COMPANY_MOVED_BETWEEN_GROUPS,
      entity: { type: "Company", id: company.id, label: company.name },
      before: { companyId: company.id, parentGroupId: from.id, parentGroupName: from.name },
      after: { companyId: company.id, parentGroupId: group.id, parentGroupName: group.name },
      reason,
    };
    await recordPlatformAction(context, from.id, audit, { tx });
    await recordPlatformAction(context, group.id, audit, { tx });
  }, { timeout: 30_000 });
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export type SetupItemDTO = { key: string; label: string; done: boolean; href?: string };

export type PlatformCompanyOverviewDTO = {
  company: {
    id: string; slug: string; name: string; legalName: string | null; registrationNumber: string | null; taxNumber: string | null; industry: string | null;
    country: string | null; address: string | null; email: string | null; phone: string | null; website: string | null; logoUrl: string | null; status: string; createdAt: string;
  };
  structure: { kind: ParentGroupKind; group: { id: string; name: string } | null };
  counts: { users: number; projects: number; departments: number; modules: number; people: number };
  createdBy: string | null;
  deletedWithGroup: boolean;
  setup: SetupItemDTO[];
  groupOptions: Array<{ value: string; label: string }>;
  detach: DetachPreviewDTO | null;
  history: Array<{ id: string; actionKey: string; actor: string | null; occurredAt: string }>;
};

export async function getPlatformCompanyOverview(context: PlatformContext, companyId: string): Promise<PlatformCompanyOverviewDTO> {
  assertPlatform(context, "platform.company.view");
  const row = assertFound(
    await prisma.company.findFirst({
      where: { id: companyId, parentGroup: { isTestFixture: false } },
      select: {
        id: true, slug: true, name: true, legalName: true, registrationNumber: true, taxNumber: true, industry: true, country: true, address: true, email: true, phone: true, website: true, logoUrl: true, status: true, createdAt: true, deletedWithGroup: true,
        parentGroup: { select: { id: true, name: true, kind: true } },
        _count: { select: { memberships: true, projects: true, departments: true, modules: { where: { enabled: true } }, employeeProfiles: true } },
      },
    }),
  );
  const [groups, history, created, detach] = await Promise.all([
    prisma.parentGroup.findMany({ where: { kind: "GROUP", isTestFixture: false, status: { notIn: ["SUSPENDED", "ARCHIVED", "DELETED"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.auditEvent.findMany({ where: { OR: [{ companyId: row.id }, { entityType: "Company", entityId: row.id }] }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 10, select: { id: true, actionKey: true, actorDisplayNameSnapshot: true, occurredAt: true } }),
    prisma.auditEvent.findFirst({ where: { entityType: "Company", entityId: row.id, actionKey: { in: [AuditAction.PLATFORM_COMPANY_CREATED, AuditAction.PLATFORM_COMPANY_ADDED_TO_GROUP] } }, orderBy: { occurredAt: "asc" }, select: { actorDisplayNameSnapshot: true } }),
    row.parentGroup.kind === "GROUP" ? previewDetach(context, row.id) : Promise.resolve(null),
  ]);
  const base = "/admin";
  const setup: SetupItemDTO[] = [
    { key: "legal", label: "Legal name", done: Boolean(row.legalName) },
    { key: "registration", label: "Registration / NUIS / VAT", done: Boolean(row.registrationNumber || row.taxNumber) },
    { key: "address", label: "Address and country", done: Boolean(row.address && row.country) },
    { key: "contact", label: "Contact information", done: Boolean(row.email || row.phone) },
    { key: "logo", label: "Logo", done: Boolean(row.logoUrl) },
    { key: "group", label: "Parent Group (optional)", done: row.parentGroup.kind === "GROUP" },
    { key: "users", label: "Users and administrators", done: row._count.memberships > 0, href: `${base}/users/memberships` },
    { key: "projects", label: "Projects", done: row._count.projects > 0, href: `${base}/projects` },
    { key: "modules", label: "Modules", done: row._count.modules > 0, href: `${base}/modules` },
  ];
  const { parentGroup, _count, createdAt, ...company } = row;
  return {
    company: { ...company, createdAt: createdAt.toISOString() },
    structure: { kind: parentGroup.kind, group: parentGroup.kind === "GROUP" ? { id: parentGroup.id, name: parentGroup.name } : null },
    counts: { users: _count.memberships, projects: _count.projects, departments: _count.departments, modules: _count.modules, people: _count.employeeProfiles },
    createdBy: created?.actorDisplayNameSnapshot ?? null,
    deletedWithGroup: row.deletedWithGroup,
    setup,
    groupOptions: groups.map((group) => ({ value: group.id, label: group.name })),
    detach,
    history: history.map((event) => ({ id: event.id, actionKey: event.actionKey, actor: event.actorDisplayNameSnapshot, occurredAt: event.occurredAt.toISOString() })),
  };
}
