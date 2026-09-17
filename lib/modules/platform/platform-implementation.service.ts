import type { ParentGroupStatus } from "@prisma/client";

import { GROUP_DEPARTMENTS, groupDepartmentRows } from "@/config/group-departments";
import { isMembershipRoleKey, roleLabel, type RoleKey } from "@/config/roles";
import { AccessError, assertFound } from "@/lib/access/guards";
import { createProvisionedUser } from "@/lib/auth/identity";
import { generateTemporaryPassword, temporaryPasswordExpiry } from "@/lib/auth/temporary-password";
import { normaliseUsername, usernameProblem } from "@/lib/auth/username";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { type PlatformPermission } from "@/config/platform";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { bootstrapCompany } from "@/lib/modules/company/company-bootstrap.service";
import {
  GROUP_LEVEL_ROLES,
  type CreateGroupCompanyInput,
  type CreateParentGroupInput,
  type InitialProjectMemberInput,
  type InitialUserInput,
  type UpdateParentGroupInput,
} from "./platform.schema";

/**
 * Implementing a parent group (E-06 §20, §21, §30, §34, §35, §39, §40, §70, §71, §138).
 *
 * The Platform Admin creates the group and its departments, connects its
 * companies — each with its settings, modules and department branches — records
 * the approved initial roster (the Owner and Group IT in every company, heads,
 * managers and members where the roster puts them) and their first project
 * assignments, checks the implementation and hands the group over. From ACTIVE
 * on, people join through HR and Group IT and projects through their managers;
 * the initial roster tools refuse (§30, §138).
 *
 * The first rows of a group are written here in one reviewed place, the way a
 * company's first rows are written by the bootstrap (PRD #48 §263). None of it
 * is business authorship: the Platform Admin approves nothing and never becomes
 * a member of what they build (§20, §116).
 */

const IMPLEMENTING: ParentGroupStatus[] = ["IMPLEMENTING", "READY_FOR_VALIDATION"];

function assertPlatform(context: PlatformContext, permission: PlatformPermission): void {
  if (!canPlatform(context, permission)) throw new AccessError("FORBIDDEN");
}

async function groupOrNotFound(groupId: string) {
  return assertFound(
    await prisma.parentGroup.findFirst({
      where: { id: groupId, isTestFixture: false },
      select: { id: true, slug: true, name: true, legalName: true, country: true, timezone: true, currency: true, status: true, activatedAt: true },
    }),
  );
}

/** The department a role works in (§47): Owner and CEO in Executive, Finance in Finance. */
function departmentKeyFor(role: string): string {
  return GROUP_DEPARTMENTS.find((department) => (department.roles as readonly string[]).includes(role))?.key ?? "executive";
}

/* -------------------------------------------------------------------------- */
/* The group                                                                   */
/* -------------------------------------------------------------------------- */

export async function createParentGroup(context: PlatformContext, input: CreateParentGroupInput): Promise<{ id: string }> {
  assertPlatform(context, "platform.group.create");
  return prisma.$transaction(async (tx) => {
    if ((await tx.parentGroup.count({ where: { slug: input.slug } })) > 0) {
      throw new AccessError("CONFLICT", "Another group already uses that slug.", { field: "slug" });
    }
    const group = await tx.parentGroup.create({
      data: {
        slug: input.slug,
        name: input.name,
        legalName: input.legalName ?? null,
        country: input.country ?? null,
        timezone: input.timezone ?? null,
        currency: input.currency ?? null,
        status: "IMPLEMENTING",
      },
      select: { id: true },
    });
    // Every function once for the group, from the start (§11, §36).
    await tx.groupDepartment.createMany({ data: groupDepartmentRows(group.id), skipDuplicates: true });
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_PARENT_GROUP_CREATED, entity: { type: "ParentGroup", id: group.id, label: input.name }, after: { slug: input.slug, name: input.name, status: "IMPLEMENTING" } }, { tx });
    return group;
  });
}

export async function updateParentGroup(context: PlatformContext, groupId: string, input: UpdateParentGroupInput): Promise<void> {
  assertPlatform(context, "platform.group.configure");
  const group = await groupOrNotFound(groupId);
  // An active group's identity is its Owner's to change, not the platform's (§20).
  if (!IMPLEMENTING.includes(group.status)) throw new AccessError("CONFLICT", "An active group's details are no longer set by the platform.", { code: "GROUP_ACTIVE" });
  await prisma.$transaction(async (tx) => {
    const moved = await tx.parentGroup.updateMany({
      where: { id: group.id, status: group.status },
      data: { name: input.name, legalName: input.legalName ?? null, country: input.country ?? null, timezone: input.timezone ?? null, currency: input.currency ?? null },
    });
    if (moved.count === 0) throw new AccessError("CONFLICT", "The group changed while you were editing it.");
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_PARENT_GROUP_UPDATED, entity: { type: "ParentGroup", id: group.id, label: input.name }, before: { name: group.name, country: group.country }, after: { name: input.name, country: input.country ?? null } }, { tx });
  });
}

export type ChecklistItemDTO = { key: string; label: string; done: boolean; blocking: boolean };

export type GroupImplementationDTO = {
  group: { id: string; slug: string; name: string; legalName: string | null; country: string | null; timezone: string | null; currency: string | null; status: ParentGroupStatus; activatedAt: string | null };
  companies: Array<{ id: string; slug: string; name: string; status: string; members: number; branches: number; projects: Array<{ id: string; code: string; name: string }> }>;
  people: Array<{ userId: string; name: string; username: string; placements: string[]; mustChangePassword: boolean }>;
  checklist: ChecklistItemDTO[];
  actions: { canConfigure: boolean; canAddCompany: boolean; canProvision: boolean; canMarkReady: boolean; canActivate: boolean };
};

export async function getGroupImplementation(context: PlatformContext, groupId: string): Promise<GroupImplementationDTO> {
  assertPlatform(context, "platform.group.view");
  const group = await groupOrNotFound(groupId);

  const [companies, memberships, departments, heads] = await Promise.all([
    prisma.company.findMany({
      where: { parentGroupId: group.id },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        _count: { select: { memberships: { where: { status: "ACTIVE" } }, departments: { where: { status: "ACTIVE", groupDepartmentId: { not: null } } } } },
        projects: { where: { archivedAt: null }, select: { id: true, code: true, name: true, projectManagerMemberId: true }, orderBy: { name: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { company: { parentGroupId: group.id }, status: "ACTIVE" },
      select: { companyId: true, role: { select: { key: true, name: true } }, company: { select: { name: true } }, user: { select: { id: true, firstName: true, lastName: true, username: true, mustChangePassword: true } } },
      orderBy: [{ user: { lastName: "asc" } }, { company: { name: "asc" } }],
    }),
    prisma.groupDepartment.count({ where: { parentGroupId: group.id, status: "ACTIVE" } }),
    prisma.departmentAssignment.count({ where: { parentGroupId: group.id, status: "ACTIVE", positionLevel: "GROUP_HEAD" } }),
  ]);

  const active = companies.filter((company) => company.status === "ACTIVE");
  const roleHeld = (role: RoleKey) => memberships.some((membership) => membership.role.key === role);
  const people = new Map<string, GroupImplementationDTO["people"][number]>();
  for (const membership of memberships) {
    const person = people.get(membership.user.id) ?? { userId: membership.user.id, name: `${membership.user.firstName} ${membership.user.lastName}`, username: membership.user.username, placements: [], mustChangePassword: membership.user.mustChangePassword };
    person.placements.push(`${isMembershipRoleKey(membership.role.key) ? roleLabel(membership.role.key) : membership.role.name} · ${membership.company.name}`);
    people.set(person.userId, person);
  }

  const checklist: ChecklistItemDTO[] = [
    { key: "companies", label: "Companies configured", done: active.length > 0, blocking: true },
    { key: "departments", label: "Group departments created", done: departments > 0, blocking: true },
    { key: "branches", label: "Company department branches linked", done: active.length > 0 && active.every((company) => company._count.departments > 0), blocking: true },
    { key: "owner", label: "At least one active Group Owner", done: roleHeld("OWNER"), blocking: true },
    { key: "groupIt", label: "Group IT appointed", done: roleHeld("GROUP_IT"), blocking: true },
    { key: "heads", label: "Initial department heads set", done: heads > 0, blocking: false },
    { key: "projects", label: "Every company has a project with a project manager", done: active.length > 0 && active.every((company) => company.projects.some((project) => project.projectManagerMemberId)), blocking: false },
  ];
  const implementing = IMPLEMENTING.includes(group.status);

  return {
    group: { ...group, activatedAt: group.activatedAt?.toISOString() ?? null },
    companies: companies.map((company) => ({ id: company.id, slug: company.slug, name: company.name, status: company.status, members: company._count.memberships, branches: company._count.departments, projects: company.projects.map(({ id, code, name }) => ({ id, code, name })) })),
    people: [...people.values()],
    checklist,
    actions: {
      canConfigure: implementing && canPlatform(context, "platform.group.configure"),
      canAddCompany: group.status !== "ARCHIVED" && group.status !== "SUSPENDED" && canPlatform(context, "platform.company.create"),
      canProvision: implementing && canPlatform(context, "platform.user.initial_provision"),
      canMarkReady: group.status === "IMPLEMENTING" && canPlatform(context, "platform.implementation.manage"),
      canActivate: implementing && canPlatform(context, "platform.group.activate") && checklist.every((item) => !item.blocking || item.done),
    },
  };
}

export async function markReadyForValidation(context: PlatformContext, groupId: string): Promise<void> {
  assertPlatform(context, "platform.implementation.manage");
  const group = await groupOrNotFound(groupId);
  await prisma.$transaction(async (tx) => {
    const moved = await tx.parentGroup.updateMany({ where: { id: group.id, status: "IMPLEMENTING" }, data: { status: "READY_FOR_VALIDATION" } });
    if (moved.count === 0) throw new AccessError("CONFLICT", "Only a group being implemented can be sent for validation.", { code: "STATE_DENIED" });
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_PARENT_GROUP_READY_FOR_VALIDATION, entity: { type: "ParentGroup", id: group.id, label: group.name }, before: { status: group.status }, after: { status: "READY_FOR_VALIDATION" } }, { tx });
  });
}

/** Hands the group over (§21, §71): refused while anything the checklist blocks on is missing. */
export async function activateParentGroup(context: PlatformContext, groupId: string): Promise<void> {
  assertPlatform(context, "platform.group.activate");
  const implementation = await getGroupImplementation(context, groupId);
  const missing = implementation.checklist.filter((item) => item.blocking && !item.done);
  if (missing.length > 0) {
    throw new AccessError("CONFLICT", `Not ready to activate: ${missing.map((item) => item.label.toLowerCase()).join("; ")}.`, { code: "IMPLEMENTATION_INCOMPLETE", missing: missing.map((item) => item.key) });
  }
  const group = implementation.group;
  await prisma.$transaction(async (tx) => {
    const moved = await tx.parentGroup.updateMany({
      where: { id: group.id, status: { in: IMPLEMENTING } },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedByUserId: context.userId },
    });
    if (moved.count === 0) throw new AccessError("CONFLICT", "Only a group being implemented can be activated.", { code: "STATE_DENIED" });
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_PARENT_GROUP_ACTIVATED, entity: { type: "ParentGroup", id: group.id, label: group.name }, before: { status: group.status }, after: { status: "ACTIVE" } }, { tx });
  });
}

/* -------------------------------------------------------------------------- */
/* Companies                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A new company of the group (§34, §35, §69): its settings, modules, numbering
 * and department branches through the company bootstrap, and a membership for
 * each group-level person — the Owner and Group IT work in every company of
 * their group — with the role they already hold there.
 */
export async function createGroupCompany(context: PlatformContext, groupId: string, input: CreateGroupCompanyInput): Promise<{ companyId: string }> {
  assertPlatform(context, "platform.company.create");
  const group = await groupOrNotFound(groupId);
  if (group.status === "ARCHIVED" || group.status === "SUSPENDED") throw new AccessError("CONFLICT", "Companies are not added to a suspended or archived group.", { code: "GROUP_CLOSED" });
  if ((await prisma.company.count({ where: { slug: input.slug } })) > 0) throw new AccessError("CONFLICT", "Another company already uses that slug.", { field: "slug" });

  const result = await bootstrapCompany({
    name: input.name,
    slug: input.slug,
    legalName: input.legalName,
    country: input.country,
    industry: input.industry,
    address: input.address,
    email: input.email,
    phone: input.phone,
    website: input.website,
    parentGroupSlug: group.slug,
    disabledModules: input.disabledModules,
    timezone: group.timezone ?? undefined,
    baseCurrency: group.currency ?? undefined,
  });

  await prisma.$transaction(async (tx) => {
    const groupLevel = await tx.parentGroupMember.findMany({ where: { parentGroupId: group.id, status: "ACTIVE", user: { status: "ACTIVE" } }, select: { userId: true } });
    const branches = new Map((await tx.department.findMany({ where: { companyId: result.companyId }, select: { id: true, key: true } })).map((row) => [row.key, row.id]));
    for (const { userId } of groupLevel) {
      const held = await tx.companyMember.findFirst({ where: { userId, status: "ACTIVE", company: { parentGroupId: group.id }, companyId: { not: result.companyId } }, select: { roleId: true, jobTitle: true, role: { select: { key: true } } }, orderBy: { createdAt: "asc" } });
      if (!held) continue;
      await tx.companyMember.createMany({
        data: [{ companyId: result.companyId, userId, roleId: held.roleId, departmentId: branches.get(departmentKeyFor(held.role.key)) ?? null, jobTitle: held.jobTitle, status: "ACTIVE", joinedAt: new Date() }],
        skipDuplicates: true,
      });
    }
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_COMPANY_ADDED_TO_GROUP, entity: { type: "Company", id: result.companyId, label: input.name }, after: { companyId: result.companyId, slug: input.slug, name: input.name, groupLevelMembers: groupLevel.length } }, { tx });
  });

  return { companyId: result.companyId };
}

/* -------------------------------------------------------------------------- */
/* The initial roster                                                          */
/* -------------------------------------------------------------------------- */

async function assertImplementing(groupId: string) {
  const group = await groupOrNotFound(groupId);
  // After go-live people join through HR and Group IT, and projects through their managers (§30, §138).
  if (!IMPLEMENTING.includes(group.status)) {
    throw new AccessError("CONFLICT", "The initial roster closed when the group went live. Group IT provisions accounts from HR's requests now.", { code: "IMPLEMENTATION_CLOSED" });
  }
  return group;
}

export type InitialUserResultDTO = { userId: string; username: string; temporaryPassword: string; expiresAt: string };

/**
 * One approved person of the initial roster (§30, §60): the person, the login,
 * the memberships and the department position, in one transaction.
 */
export async function provisionInitialUser(context: PlatformContext, groupId: string, input: InitialUserInput): Promise<InitialUserResultDTO> {
  assertPlatform(context, "platform.user.initial_provision");
  const group = await assertImplementing(groupId);
  const role = input.roleKey;
  const groupLevel = (GROUP_LEVEL_ROLES as readonly string[]).includes(role);

  const companies = await prisma.company.findMany({
    where: { parentGroupId: group.id, status: "ACTIVE", ...(groupLevel ? {} : { id: { in: input.companyIds } }) },
    select: { id: true },
  });
  if (!groupLevel && (input.companyIds.length === 0 || companies.length !== new Set(input.companyIds).size)) {
    throw new AccessError("VALIDATION_ERROR", "Choose the group's companies this person works in.", { field: "companyIds" });
  }
  if (companies.length === 0) throw new AccessError("VALIDATION_ERROR", "Add a company to the group first.", { field: "companyIds" });
  if (input.position === "GROUP_HEAD" && role === "OWNER") throw new AccessError("VALIDATION_ERROR", "The Owner holds the group, not a department of it.", { field: "position" });

  const username = input.username ? normaliseUsername(input.username) : null;
  if (username && usernameProblem(username)) throw new AccessError("VALIDATION_ERROR", "Usernames use lowercase letters, numbers, dots, hyphens and underscores.", { field: "username" });

  const [roleRow, groupDepartment] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { key: role }, select: { id: true } }),
    prisma.groupDepartment.findFirst({ where: { parentGroupId: group.id, key: departmentKeyFor(role), status: "ACTIVE" }, select: { id: true } }),
  ]);
  if (!groupDepartment) throw new AccessError("VALIDATION_ERROR", "The group has no department for that role.", { field: "roleKey" });

  const temporaryPassword = generateTemporaryPassword();
  const expiresAt = temporaryPasswordExpiry();
  const name = `${input.firstName} ${input.lastName}`;

  const user = await prisma.$transaction(async (tx) => {
    if (username && (await tx.user.count({ where: { username } })) > 0) throw new AccessError("CONFLICT", "That username is taken.", { field: "username" });
    if (input.workEmail) {
      const clash = await tx.user.count({ where: { email: { equals: input.workEmail, mode: "insensitive" } } });
      const person = await tx.personProfile.count({ where: { parentGroupId: group.id, workEmail: { equals: input.workEmail, mode: "insensitive" } } });
      if (clash + person > 0) throw new AccessError("CONFLICT", "Somebody in the group already has that email address.", { field: "workEmail" });
    }

    const person = await tx.personProfile.create({
      data: { parentGroupId: group.id, firstName: input.firstName, lastName: input.lastName, workEmail: input.workEmail ?? null, jobTitle: input.jobTitle ?? null, lifecycleStatus: "EMPLOYEE", createdByUserId: context.userId },
      select: { id: true },
    });
    const account = await createProvisionedUser(tx, { personProfileId: person.id, firstName: input.firstName, lastName: input.lastName, email: input.workEmail ?? null, phone: null, username, temporaryPassword, expiresAt });

    if (groupLevel) await tx.parentGroupMember.create({ data: { parentGroupId: group.id, userId: account.id, status: "ACTIVE", joinedAt: new Date() } });

    for (const company of companies) {
      const branch = await tx.department.findFirst({ where: { companyId: company.id, groupDepartmentId: groupDepartment.id, status: "ACTIVE" }, select: { id: true } });
      const member = await tx.companyMember.create({
        data: { companyId: company.id, userId: account.id, roleId: roleRow.id, departmentId: branch?.id ?? null, jobTitle: input.jobTitle ?? null, status: "ACTIVE", joinedAt: new Date() },
        select: { id: true },
      });
      if (input.position !== "GROUP_HEAD") {
        await tx.departmentAssignment.create({
          data: { parentGroupId: group.id, userId: account.id, groupDepartmentId: groupDepartment.id, companyId: company.id, companyDepartmentId: branch?.id ?? null, functionalRoleKey: role, positionLevel: input.position, accessLevel: input.position === "COMPANY_MANAGER" ? "APPROVE" : "CONTRIBUTE", status: "ACTIVE", startsAt: new Date(), createdByUserId: context.userId },
        });
        if (input.position === "COMPANY_MANAGER" && branch) await tx.department.updateMany({ where: { id: branch.id, companyId: company.id }, data: { managerMemberId: member.id } });
      }
    }
    if (input.position === "GROUP_HEAD") {
      await tx.departmentAssignment.create({
        data: { parentGroupId: group.id, userId: account.id, groupDepartmentId: groupDepartment.id, companyId: null, companyDepartmentId: null, functionalRoleKey: role, positionLevel: "GROUP_HEAD", accessLevel: "MANAGE", status: "ACTIVE", startsAt: new Date(), createdByUserId: context.userId },
      });
    }

    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_INITIAL_USER_PROVISIONED, entity: { type: "User", id: account.id, label: name }, after: { userId: account.id, username: account.username, personProfileId: person.id, roleKey: role, position: input.position, companies: companies.length } }, { tx });
    return account;
  });

  return { userId: user.id, username: user.username, temporaryPassword, expiresAt: expiresAt.toISOString() };
}

/** A first project assignment from the approved roster (§30, §32, §138). */
export async function assignInitialProjectMember(context: PlatformContext, groupId: string, input: InitialProjectMemberInput): Promise<void> {
  assertPlatform(context, "platform.user.initial_provision");
  const group = await assertImplementing(groupId);
  const project = assertFound(await prisma.project.findFirst({ where: { id: input.projectId, company: { parentGroupId: group.id }, archivedAt: null }, select: { id: true, name: true, companyId: true } }));
  const member = await prisma.companyMember.findFirst({ where: { userId: input.userId, companyId: project.companyId, status: "ACTIVE" }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  if (!member) throw new AccessError("VALIDATION_ERROR", "That person does not work in the project's company.", { field: "userId" });

  await prisma.$transaction(async (tx) => {
    const existing = await tx.projectMember.findUnique({ where: { projectId_companyMemberId: { projectId: project.id, companyMemberId: member.id } }, select: { id: true, status: true } });
    if (existing?.status === "ACTIVE") throw new AccessError("CONFLICT", "That person is already on the project.");
    if (existing) {
      await tx.projectMember.updateMany({ where: { id: existing.id, status: existing.status }, data: { status: "ACTIVE", leftAt: null, projectRole: input.projectRole ?? null } });
    } else {
      await tx.projectMember.create({ data: { companyId: project.companyId, projectId: project.id, companyMemberId: member.id, projectRole: input.projectRole ?? null, status: "ACTIVE", joinedAt: new Date() } });
    }
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_INITIAL_PROJECT_MEMBER_ASSIGNED, entity: { type: "Project", id: project.id, label: project.name }, after: { projectId: project.id, userId: input.userId, companyMemberId: member.id } }, { tx });
  });
}

