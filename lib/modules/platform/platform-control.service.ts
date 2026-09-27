import type { FeatureFlagScopeType, FeatureFlagState, MembershipStatus, Prisma, UserStatus } from "@prisma/client";

import { CORE_MODULE_KEYS, MODULE_KEYS, modules as moduleRegistry, type ModuleKey } from "@/config/modules";
import type { PlatformPermission } from "@/config/platform";
import { isMembershipRoleKey } from "@/config/roles";
import { AccessError, assertFound } from "@/lib/access/guards";
import { createProvisionedUser } from "@/lib/auth/identity";
import { revokeSessions } from "@/lib/auth/session-store";
import { generateTemporaryPassword, temporaryPasswordExpiry } from "@/lib/auth/temporary-password";
import { normaliseUsername, usernameProblem, USERNAME_MESSAGES } from "@/lib/auth/username";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordGlobalPlatformAction, recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { invalidateMaintenanceSnapshot } from "@/lib/core/maintenance/platform-maintenance";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { CORE_MODULES, DEPENDENCIES, SHARED_MODULES } from "@/lib/modules/settings/module-toggle.service";
import type { AccessInspectorInput } from "./platform-control.schema";
import { inspectAccess } from "./platform-control.query";
import { describeLogo } from "@/lib/workspace/branding";

function assertPlatform(context: PlatformContext, permission: PlatformPermission): void {
  if (!canPlatform(context, permission)) throw new AccessError("FORBIDDEN");
}

type PersonInput = {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  jobTitle?: string | null;
  workEmail?: string | null;
  workPhone?: string | null;
  lifecycleStatus: "CANDIDATE" | "SELECTED" | "EMPLOYEE" | "FORMER_EMPLOYEE";
  reason: string;
};

const nullable = (value: string | null | undefined) => value?.trim() || null;
/** Absent keeps the stored value; empty or null clears it (AUD-09 §4, FV-05). */
const keptOr = (value: string | null | undefined, stored: string | null) => (value === undefined ? stored : nullable(value));

function assertUpdated(result: { count: number }, message = "The record changed while you were editing it. Refresh and try again.") {
  if (result.count !== 1) throw new AccessError("CONFLICT", message);
}

export async function updatePlatformCompany(context: PlatformContext, companyId: string, input: { name: string; logoUrl?: string; legalName?: string; registrationNumber?: string; taxNumber?: string; industry?: string; country?: string; address?: string; email?: string; phone?: string; website?: string; reason: string }) {
  assertPlatform(context, "platform.company.configure");
  const company = assertFound(await prisma.company.findFirst({ where: { id: companyId, parentGroup: { isTestFixture: false } }, select: { id: true, parentGroupId: true, name: true, legalName: true, registrationNumber: true, taxNumber: true, industry: true, country: true, address: true, email: true, phone: true, website: true, logoUrl: true } }));
  // A form without the field keeps the logo; an empty one clears it (OW §44).
  const logoUrl = input.logoUrl === undefined ? company.logoUrl : nullable(input.logoUrl);
  const after = { name: input.name, legalName: nullable(input.legalName), registrationNumber: nullable(input.registrationNumber), taxNumber: nullable(input.taxNumber), industry: nullable(input.industry), country: nullable(input.country), address: nullable(input.address), email: nullable(input.email), phone: nullable(input.phone), website: nullable(input.website) };
  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: company.id },
      data: {
        name: after.name,
        legalName: after.legalName,
        registrationNumber: after.registrationNumber,
        taxNumber: after.taxNumber,
        industry: after.industry,
        country: after.country,
        address: after.address,
        email: after.email,
        phone: after.phone,
        website: after.website,
        logoUrl,
        configVersion: { increment: 1 },
      },
    });
    await recordPlatformAction(context, company.parentGroupId, { actionKey: AuditAction.PLATFORM_COMPANY_UPDATED, entity: { type: "Company", id: company.id, label: after.name }, before: { ...company, logo: describeLogo(company.logoUrl) }, after: { ...after, logo: describeLogo(logoUrl) }, reason: input.reason }, { tx });
  });
}

export async function createPlatformPerson(context: PlatformContext, input: PersonInput & { parentGroupId: string }) {
  assertPlatform(context, "platform.user.manage");
  const group = assertFound(await prisma.parentGroup.findFirst({ where: { id: input.parentGroupId, isTestFixture: false, status: { not: "ARCHIVED" } }, select: { id: true, name: true } }));
  if (input.workEmail && await prisma.personProfile.count({ where: { parentGroupId: group.id, workEmail: { equals: input.workEmail, mode: "insensitive" } } })) throw new AccessError("CONFLICT", "That work email is already used by a person in this group.", { field: "workEmail" });
  return prisma.$transaction(async (tx) => {
    const person = await tx.personProfile.create({ data: { parentGroupId: group.id, firstName: input.firstName, lastName: input.lastName, preferredName: nullable(input.preferredName), jobTitle: nullable(input.jobTitle), workEmail: nullable(input.workEmail), workPhone: nullable(input.workPhone), lifecycleStatus: input.lifecycleStatus, createdByUserId: context.userId } });
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_PERSON_CREATED, entity: { type: "PersonProfile", id: person.id, label: `${person.firstName} ${person.lastName}` }, after: { parentGroupId: group.id, firstName: person.firstName, lastName: person.lastName, preferredName: person.preferredName, jobTitle: person.jobTitle, workEmail: person.workEmail, workPhone: person.workPhone, lifecycleStatus: person.lifecycleStatus }, reason: input.reason }, { tx });
    return { id: person.id };
  });
}

export async function updatePlatformPerson(context: PlatformContext, personId: string, input: PersonInput) {
  assertPlatform(context, "platform.user.manage");
  const person = assertFound(await prisma.personProfile.findFirst({ where: { id: personId, parentGroup: { isTestFixture: false } }, select: { id: true, parentGroupId: true, firstName: true, lastName: true, preferredName: true, jobTitle: true, workEmail: true, workPhone: true, lifecycleStatus: true, user: { select: { id: true } } } }));
  if (input.workEmail && await prisma.personProfile.count({ where: { parentGroupId: person.parentGroupId, workEmail: { equals: input.workEmail, mode: "insensitive" }, id: { not: person.id } } })) throw new AccessError("CONFLICT", "That work email is already used by a person in this group.", { field: "workEmail" });
  const after = { firstName: input.firstName, lastName: input.lastName, preferredName: keptOr(input.preferredName, person.preferredName), jobTitle: keptOr(input.jobTitle, person.jobTitle), workEmail: keptOr(input.workEmail, person.workEmail), workPhone: keptOr(input.workPhone, person.workPhone), lifecycleStatus: input.lifecycleStatus };
  await prisma.$transaction(async (tx) => {
    assertUpdated(await tx.personProfile.updateMany({
      where: { id: person.id, lifecycleStatus: person.lifecycleStatus },
      data: {
        firstName: after.firstName,
        lastName: after.lastName,
        preferredName: after.preferredName,
        jobTitle: after.jobTitle,
        workEmail: after.workEmail,
        workPhone: after.workPhone,
        lifecycleStatus: after.lifecycleStatus,
      },
    }));
    // Only what the edit named reaches the account: an omitted email or phone leaves the login's alone (AUD-09 §4, FV-05).
    if (person.user) await tx.user.update({ where: { id: person.user.id }, data: { firstName: after.firstName, lastName: after.lastName, email: input.workEmail === undefined ? undefined : after.workEmail, phone: input.workPhone === undefined ? undefined : after.workPhone } });
    await recordPlatformAction(context, person.parentGroupId, { actionKey: AuditAction.PLATFORM_PERSON_UPDATED, entity: { type: "PersonProfile", id: person.id, label: `${after.firstName} ${after.lastName}` }, before: person, after, reason: input.reason }, { tx });
  });
}

export async function createPlatformUser(context: PlatformContext, input: { personProfileId: string; username?: string; reason: string }) {
  assertPlatform(context, "platform.user.manage");
  const person = assertFound(await prisma.personProfile.findFirst({ where: { id: input.personProfileId, parentGroup: { isTestFixture: false } }, select: { id: true, parentGroupId: true, firstName: true, lastName: true, workEmail: true, workPhone: true, user: { select: { id: true } } } }));
  if (person.user) throw new AccessError("CONFLICT", "This person already has a user account.");
  const username = input.username ? normaliseUsername(input.username) : null;
  if (username) {
    const problem = usernameProblem(username);
    if (problem) throw new AccessError("VALIDATION_ERROR", USERNAME_MESSAGES[problem], { field: "username" });
    if (await prisma.user.count({ where: { username } })) throw new AccessError("CONFLICT", "That username is already in use.", { field: "username" });
  }
  if (person.workEmail && await prisma.user.count({ where: { email: person.workEmail } })) throw new AccessError("CONFLICT", "That work email is already linked to another account.", { field: "username" });
  const temporaryPassword = generateTemporaryPassword();
  const expiresAt = temporaryPasswordExpiry();
  const user = await prisma.$transaction(async (tx) => {
    const created = await createProvisionedUser(tx, { personProfileId: person.id, firstName: person.firstName, lastName: person.lastName, email: person.workEmail, phone: person.workPhone, username, temporaryPassword, expiresAt });
    await recordPlatformAction(context, person.parentGroupId, { actionKey: AuditAction.PLATFORM_USER_CREATED, entity: { type: "User", id: created.id, label: created.username }, after: { personProfileId: person.id, userId: created.id, username: created.username, status: "ACTIVE", mustChangePassword: true, expiresAt: expiresAt.toISOString() }, reason: input.reason }, { tx });
    return created;
  });
  return { userId: user.id, username: user.username, temporaryPassword, expiresAt: expiresAt.toISOString() };
}

export async function setGroupStatus(context: PlatformContext, groupId: string, status: "IMPLEMENTING" | "READY_FOR_VALIDATION" | "ACTIVE" | "SUSPENDED" | "ARCHIVED", reason: string) {
  assertPlatform(context, "platform.group.lifecycle");
  const group = assertFound(await prisma.parentGroup.findFirst({ where: { id: groupId, isTestFixture: false }, select: { id: true, name: true, status: true } }));
  if (group.status === "ARCHIVED") throw new AccessError("CONFLICT", "An archived group is historical and cannot be reopened from the console.");
  if (status === "ACTIVE" && ["IMPLEMENTING", "READY_FOR_VALIDATION"].includes(group.status)) {
    throw new AccessError("CONFLICT", "Complete the implementation checklist and use the handover action to activate this group.");
  }
  if (group.status === status) return;
  await prisma.$transaction(async (tx) => {
    assertUpdated(await tx.parentGroup.updateMany({ where: { id: group.id, status: group.status }, data: { status } }));
    if (["SUSPENDED", "ARCHIVED"].includes(status)) {
      await revokeSessions(tx, { parentGroupId: group.id });
    }
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_GROUP_STATUS_CHANGED, entity: { type: "ParentGroup", id: group.id, label: group.name }, before: { status: group.status }, after: { status }, reason }, { tx });
  });
}

/**
 * The tenant's logo, which the shell shows at the top of the sidebar (OW §12,
 * §44). Presentation only, so it may change at any point of a group's life
 * except once it is archived history.
 */
export async function setGroupBranding(context: PlatformContext, groupId: string, input: { logoUrl: string; reason: string }) {
  assertPlatform(context, "platform.group.configure");
  const group = assertFound(await prisma.parentGroup.findFirst({ where: { id: groupId, isTestFixture: false }, select: { id: true, name: true, status: true, logoUrl: true } }));
  if (group.status === "ARCHIVED") throw new AccessError("CONFLICT", "An archived group is historical and cannot be changed from the console.");
  const logoUrl = nullable(input.logoUrl);
  if (logoUrl === group.logoUrl) return;
  await prisma.$transaction(async (tx) => {
    // Guarded by the state it was read in, as the lifecycle change is: an archive in between refuses it.
    assertUpdated(await tx.parentGroup.updateMany({ where: { id: group.id, status: group.status, isTestFixture: false }, data: { logoUrl } }));
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_GROUP_BRANDING_CHANGED, entity: { type: "ParentGroup", id: group.id, label: group.name }, before: { logo: describeLogo(group.logoUrl) }, after: { logo: describeLogo(logoUrl) }, reason: input.reason }, { tx });
  });
}

export async function setCompanyStatus(context: PlatformContext, companyId: string, status: "ACTIVE" | "INACTIVE" | "SUSPENDED", reason: string) {
  assertPlatform(context, "platform.company.configure");
  const company = assertFound(await prisma.company.findFirst({ where: { id: companyId, parentGroup: { isTestFixture: false } }, select: { id: true, name: true, status: true, parentGroupId: true } }));
  if (company.status === status) return;
  await prisma.$transaction(async (tx) => {
    assertUpdated(await tx.company.updateMany({ where: { id: company.id, status: company.status }, data: { status, configVersion: { increment: 1 } } }));
    if (status !== "ACTIVE") await revokeSessions(tx, { companyId: company.id, relocate: true });
    await recordPlatformAction(context, company.parentGroupId, { actionKey: AuditAction.PLATFORM_COMPANY_STATUS_CHANGED, entity: { type: "Company", id: company.id, label: company.name }, before: { status: company.status }, after: { status }, reason }, { tx });
  });
}

export async function setUserStatus(context: PlatformContext, userId: string, status: UserStatus, reason: string) {
  assertPlatform(context, "platform.user.manage");
  if (userId === context.userId && status !== "ACTIVE") throw new AccessError("CONFLICT", "Use another Platform Admin to disable this account.");
  const user = assertFound(await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, firstName: true, lastName: true, status: true } }));
  if (user.status === status) return;
  await prisma.$transaction(async (tx) => {
    assertUpdated(await tx.user.updateMany({ where: { id: user.id, status: user.status }, data: { status } }));
    const revoked = status === "ACTIVE" ? 0 : await revokeSessions(tx, { userId: user.id });
    await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_USER_STATUS_CHANGED, entity: { type: "User", id: user.id, label: `${user.firstName} ${user.lastName}` }, before: { status: user.status }, after: { status, sessionsRevoked: revoked }, reason }, { tx });
  });
}

export async function createMembership(context: PlatformContext, input: { userId: string; companyId: string; roleKey: string; status: MembershipStatus; jobTitle?: string; reason: string }) {
  assertPlatform(context, "platform.membership.manage");
  if (!isMembershipRoleKey(input.roleKey)) throw new AccessError("VALIDATION_ERROR", "Choose a tenant role.");
  const [companyResult, userResult, roleResult] = await Promise.all([
    prisma.company.findFirst({ where: { id: input.companyId, parentGroup: { isTestFixture: false } }, select: { id: true, name: true, parentGroupId: true } }),
    prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, firstName: true, lastName: true, platformAccess: { select: { status: true } }, personProfile: { select: { parentGroupId: true } } } }),
    prisma.role.findUnique({ where: { key: input.roleKey }, select: { id: true } }),
  ]);
  const company = assertFound(companyResult);
  const user = assertFound(userResult);
  const role = assertFound(roleResult);
  if (user.platformAccess?.status === "ACTIVE") throw new AccessError("VALIDATION_ERROR", "A Platform Admin account cannot also be a tenant membership.");
  if (user.personProfile?.parentGroupId && user.personProfile.parentGroupId !== company.parentGroupId) throw new AccessError("VALIDATION_ERROR", "The person belongs to another parent group.");
  const existing = await prisma.companyMember.findFirst({ where: { companyId: company.id, userId: user.id }, select: { id: true } });
  if (existing) throw new AccessError("CONFLICT", "This user already has a membership in the company.");
  return prisma.$transaction(async (tx) => {
    const member = await tx.companyMember.create({ data: { companyId: company.id, userId: user.id, roleId: role.id, status: input.status, jobTitle: input.jobTitle || null, joinedAt: input.status === "ACTIVE" ? new Date() : null } });
    await recordPlatformAction(context, company.parentGroupId, { actionKey: AuditAction.PLATFORM_MEMBERSHIP_CHANGED, entity: { type: "CompanyMember", id: member.id, label: `${user.firstName} ${user.lastName} · ${company.name}` }, after: { companyId: company.id, userId: user.id, roleKey: input.roleKey, status: input.status }, reason: input.reason }, { tx });
    return { id: member.id };
  });
}

export async function updateMembership(context: PlatformContext, membershipId: string, input: { roleKey?: string; status?: MembershipStatus; reason: string }) {
  assertPlatform(context, "platform.membership.manage");
  const member = assertFound(await prisma.companyMember.findFirst({ where: { id: membershipId, company: { parentGroup: { isTestFixture: false } } }, select: { id: true, status: true, role: { select: { id: true, key: true } }, userId: true, user: { select: { firstName: true, lastName: true } }, company: { select: { id: true, name: true, parentGroupId: true } } } }));
  let roleId = member.role.id;
  if (input.roleKey) {
    if (!isMembershipRoleKey(input.roleKey)) throw new AccessError("VALIDATION_ERROR", "Choose a tenant role.");
    roleId = assertFound(await prisma.role.findUnique({ where: { key: input.roleKey }, select: { id: true } })).id;
  }
  const status = input.status ?? member.status;
  await prisma.$transaction(async (tx) => {
    assertUpdated(await tx.companyMember.updateMany({ where: { id: member.id, status: member.status }, data: { roleId, status, accessVersion: { increment: 1 }, deactivatedAt: status === "ACTIVE" ? null : new Date(), deactivatedByMemberId: null } }));
    // A role change ends the session so the next one is built afresh; only losing the membership relocates (§82).
    if (status !== "ACTIVE" || input.roleKey) await revokeSessions(tx, { membershipId: member.id, relocate: status !== "ACTIVE" });
    await recordPlatformAction(context, member.company.parentGroupId, { actionKey: AuditAction.PLATFORM_MEMBERSHIP_CHANGED, entity: { type: "CompanyMember", id: member.id, label: `${member.user.firstName} ${member.user.lastName} · ${member.company.name}` }, before: { companyId: member.company.id, userId: member.userId, roleKey: member.role.key, status: member.status }, after: { companyId: member.company.id, userId: member.userId, roleKey: input.roleKey ?? member.role.key, status }, reason: input.reason }, { tx });
  });
}

export async function repairBrokenMembership(context: PlatformContext, membershipId: string, reason: string) {
  assertPlatform(context, "platform.membership.manage");
  const member = assertFound(await prisma.companyMember.findFirst({ where: { id: membershipId, company: { parentGroup: { isTestFixture: false } } }, select: { id: true, userId: true, status: true, role: { select: { key: true } }, company: { select: { id: true, name: true, parentGroupId: true } }, user: { select: { firstName: true, lastName: true, personProfile: { select: { parentGroupId: true } } } } } }));
  if (!member.user.personProfile || member.user.personProfile.parentGroupId === member.company.parentGroupId) throw new AccessError("CONFLICT", "This membership has no repairable parent-group mismatch.");
  await prisma.$transaction(async (tx) => {
    assertUpdated(await tx.companyMember.updateMany({ where: { id: member.id, status: member.status }, data: { status: "INACTIVE", accessVersion: { increment: 1 }, deactivatedAt: new Date(), deactivatedByMemberId: null } }));
    await revokeSessions(tx, { membershipId: member.id, relocate: true });
    await recordPlatformAction(context, member.company.parentGroupId, { actionKey: AuditAction.PLATFORM_MEMBERSHIP_CHANGED, entity: { type: "CompanyMember", id: member.id, label: `${member.user.firstName} ${member.user.lastName} · ${member.company.name}` }, before: { companyId: member.company.id, userId: member.userId, roleKey: member.role.key, status: member.status }, after: { companyId: member.company.id, userId: member.userId, roleKey: member.role.key, status: "INACTIVE" }, reason }, { tx });
  });
}

export async function revokePlatformSession(context: PlatformContext, sessionId: string, reason: string) {
  assertPlatform(context, "platform.session.revoke");
  const session = assertFound(await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true, userId: true, user: { select: { username: true } } } }));
  if (session.id === context.sessionId) throw new AccessError("CONFLICT", "Sign out to end your current Platform Admin session.");
  await prisma.$transaction(async (tx) => {
    const revoked = await revokeSessions(tx, { sessionId: session.id });
    await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_SESSION_REVOKED, entity: { type: "Session", id: session.id, label: session.user.username }, before: { sessionId: session.id, userId: session.userId, revoked: false }, after: { sessionId: session.id, userId: session.userId, revoked: revoked === 1 }, reason }, { tx });
  });
}

export async function setPlatformModule(context: PlatformContext, input: { companyId: string; moduleKey: ModuleKey; enabled: boolean; reason: string }) {
  assertPlatform(context, "platform.module.manage");
  const company = assertFound(await prisma.company.findFirst({ where: { id: input.companyId, parentGroup: { isTestFixture: false } }, select: { id: true, name: true, parentGroupId: true } }));
  const moduleRow = assertFound(await prisma.module.findUnique({ where: { key: input.moduleKey }, select: { id: true, name: true } }));
  if (!input.enabled && ([...CORE_MODULES, ...SHARED_MODULES] as ModuleKey[]).includes(input.moduleKey)) throw new AccessError("CONFLICT", `${moduleRow.name} is required by the platform.`);
  const currentRows = await prisma.companyModule.findMany({ where: { companyId: company.id }, select: { enabled: true, module: { select: { key: true } } } });
  const current = new Map(currentRows.map((row) => [row.module.key, row.enabled]));
  if (input.enabled) {
    const missing = (DEPENDENCIES[input.moduleKey] ?? []).filter((key) => !current.get(key));
    if (missing.length) throw new AccessError("CONFLICT", `Enable ${missing.map((key) => moduleRegistry[key].label).join(", ")} first.`);
  } else {
    const dependants = Object.entries(DEPENDENCIES).filter(([key, dependencies]) => current.get(key) && dependencies?.includes(input.moduleKey)).map(([key]) => moduleRegistry[key as ModuleKey].label);
    if (dependants.length) throw new AccessError("CONFLICT", `${dependants.join(", ")} depends on this module.`);
  }
  const was = current.get(input.moduleKey) ?? false;
  if (was === input.enabled) return;
  await prisma.$transaction(async (tx) => {
    await tx.companyModule.upsert({ where: { companyId_moduleId: { companyId: company.id, moduleId: moduleRow.id } }, update: { enabled: input.enabled }, create: { companyId: company.id, moduleId: moduleRow.id, enabled: input.enabled } });
    await tx.company.update({ where: { id: company.id }, data: { configVersion: { increment: 1 } } });
    await recordPlatformAction(context, company.parentGroupId, { actionKey: AuditAction.PLATFORM_MODULE_CHANGED, entity: { type: "CompanyModule", id: `${company.id}:${input.moduleKey}`, label: `${company.name} · ${moduleRow.name}` }, before: { companyId: company.id, moduleKey: input.moduleKey, enabled: was }, after: { companyId: company.id, moduleKey: input.moduleKey, enabled: input.enabled }, reason: input.reason }, { tx });
  });
}

export async function createFeatureFlag(context: PlatformContext, input: { key: string; name: string; description?: string; defaultState: FeatureFlagState; reason: string }) {
  assertPlatform(context, "platform.feature_flag.manage");
  if (await prisma.featureFlag.count({ where: { key: input.key } })) throw new AccessError("CONFLICT", "A feature flag already uses that key.");
  return prisma.$transaction(async (tx) => {
    const flag = await tx.featureFlag.create({ data: { key: input.key, name: input.name, description: input.description || null, defaultState: input.defaultState, createdByUserId: context.userId, updatedByUserId: context.userId } });
    await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_FEATURE_FLAG_CHANGED, entity: { type: "FeatureFlag", id: flag.id, label: flag.name }, after: { key: flag.key, scopeType: "DEFAULT", scopeId: "platform", state: flag.defaultState, archived: false }, reason: input.reason }, { tx });
    return flag;
  });
}

async function assertFlagScope(scopeType: FeatureFlagScopeType, scopeId: string) {
  if (scopeType === "PLATFORM") {
    if (scopeId !== "platform") throw new AccessError("VALIDATION_ERROR", "The platform scope id is platform.");
    return;
  }
  const exists = scopeType === "GROUP" ? await prisma.parentGroup.count({ where: { id: scopeId, isTestFixture: false } }) : scopeType === "COMPANY" ? await prisma.company.count({ where: { id: scopeId, parentGroup: { isTestFixture: false } } }) : await prisma.user.count({ where: { id: scopeId } });
  if (!exists) throw new AccessError("NOT_FOUND");
}

export async function setFeatureFlagOverride(context: PlatformContext, flagId: string, input: { scopeType: FeatureFlagScopeType; scopeId: string; state: FeatureFlagState; reason: string }) {
  assertPlatform(context, "platform.feature_flag.manage");
  await assertFlagScope(input.scopeType, input.scopeId);
  const flag = assertFound(await prisma.featureFlag.findFirst({ where: { id: flagId, archivedAt: null }, select: { id: true, key: true, name: true } }));
  await prisma.$transaction(async (tx) => {
    const before = await tx.featureFlagOverride.findUnique({ where: { featureFlagId_scopeType_scopeId: { featureFlagId: flag.id, scopeType: input.scopeType, scopeId: input.scopeId } }, select: { id: true, state: true } });
    if (before) {
      assertUpdated(await tx.featureFlagOverride.updateMany({ where: { id: before.id, state: before.state }, data: { state: input.state, reason: input.reason, updatedByUserId: context.userId } }));
    } else {
      await tx.featureFlagOverride.create({ data: { featureFlagId: flag.id, scopeType: input.scopeType, scopeId: input.scopeId, state: input.state, reason: input.reason, updatedByUserId: context.userId } });
    }
    await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_FEATURE_FLAG_CHANGED, entity: { type: "FeatureFlag", id: flag.id, label: flag.name }, before: before ? { key: flag.key, scopeType: input.scopeType, scopeId: input.scopeId, state: before.state, archived: false } : null, after: { key: flag.key, scopeType: input.scopeType, scopeId: input.scopeId, state: input.state, archived: false }, reason: input.reason }, { tx });
  });
}

export async function createPlatformProject(context: PlatformContext, input: { companyId: string; code: string; name: string; description?: string; status: "PENDING" | "ACTIVE" | "FINISHED"; reason: string }) {
  assertPlatform(context, "platform.project.manage");
  const company = assertFound(await prisma.company.findFirst({ where: { id: input.companyId, parentGroup: { isTestFixture: false } }, select: { id: true, name: true, parentGroupId: true } }));
  if (await prisma.project.count({ where: { companyId: company.id, code: input.code } })) throw new AccessError("CONFLICT", "That company already uses this project code.");
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({ data: { companyId: company.id, code: input.code, name: input.name, description: input.description || null, status: input.status, createdBy: context.userId } });
    await recordPlatformAction(context, company.parentGroupId, { actionKey: AuditAction.PLATFORM_PROJECT_CREATED, entity: { type: "Project", id: project.id, label: project.name }, projectId: project.id, after: { companyId: company.id, code: project.code, name: project.name, status: project.status }, reason: input.reason }, { tx });
    return { id: project.id };
  });
}

export async function createPlatformGrant(context: PlatformContext, input: { userId: string; parentGroupId: string; moduleKey: ModuleKey; scopeType: "GROUP" | "COMPANY" | "PROJECT"; scopeId: string; accessLevel: "VIEW" | "CONTRIBUTE" | "APPROVE" | "MANAGE"; expiresAt?: Date; reason: string }) {
  assertPlatform(context, "platform.membership.manage");
  const group = assertFound(await prisma.parentGroup.findFirst({ where: { id: input.parentGroupId, isTestFixture: false }, select: { id: true, name: true } }));
  const holder = assertFound(await prisma.user.findFirst({ where: { id: input.userId, memberships: { some: { company: { parentGroupId: group.id } } } }, select: { id: true, firstName: true, lastName: true } }));
  if (!MODULE_KEYS.includes(input.moduleKey)) throw new AccessError("VALIDATION_ERROR", "Choose a registered module.");
  if (input.scopeType === "GROUP" && input.scopeId !== group.id) throw new AccessError("VALIDATION_ERROR", "A group grant must target its own group.");
  if (input.scopeType === "COMPANY" && !(await prisma.company.count({ where: { id: input.scopeId, parentGroupId: group.id } }))) throw new AccessError("VALIDATION_ERROR", "Choose a company in the parent group.");
  if (input.scopeType === "PROJECT" && !(await prisma.project.count({ where: { id: input.scopeId, company: { parentGroupId: group.id } } }))) throw new AccessError("VALIDATION_ERROR", "Choose a project in the parent group.");
  if (input.expiresAt && input.expiresAt <= new Date()) throw new AccessError("VALIDATION_ERROR", "The expiry must be in the future.");
  return prisma.$transaction(async (tx) => {
    const grant = await tx.accessGrant.create({ data: { userId: holder.id, parentGroupId: group.id, functionKey: input.moduleKey, scopeType: input.scopeType, scopeId: input.scopeId, accessLevel: input.accessLevel, grantedByUserId: context.userId, startsAt: new Date(), expiresAt: input.expiresAt ?? null, reason: input.reason } });
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_ACCESS_GRANT_CHANGED, entity: { type: "AccessGrant", id: grant.id, label: `${holder.firstName} ${holder.lastName} · ${input.moduleKey}` }, after: { userId: holder.id, parentGroupId: group.id, moduleKey: input.moduleKey, scopeType: input.scopeType, scopeId: input.scopeId, accessLevel: input.accessLevel, revoked: false }, reason: input.reason }, { tx });
    return { id: grant.id };
  });
}

export async function revokePlatformGrant(context: PlatformContext, grantId: string, reason: string) {
  assertPlatform(context, "platform.membership.manage");
  const grant = assertFound(await prisma.accessGrant.findFirst({ where: { id: grantId, parentGroup: { isTestFixture: false } }, select: { id: true, userId: true, parentGroupId: true, functionKey: true, scopeType: true, scopeId: true, accessLevel: true, revokedAt: true } }));
  if (grant.revokedAt) return;
  await prisma.$transaction(async (tx) => {
    await tx.accessGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date(), revokedByUserId: context.userId } });
    await recordPlatformAction(context, grant.parentGroupId, { actionKey: AuditAction.PLATFORM_ACCESS_GRANT_CHANGED, entity: { type: "AccessGrant", id: grant.id, label: grant.functionKey ?? "Access grant" }, before: { userId: grant.userId, parentGroupId: grant.parentGroupId, moduleKey: grant.functionKey, scopeType: grant.scopeType, scopeId: grant.scopeId, accessLevel: grant.accessLevel, revoked: false }, after: { userId: grant.userId, parentGroupId: grant.parentGroupId, moduleKey: grant.functionKey, scopeType: grant.scopeType, scopeId: grant.scopeId, accessLevel: grant.accessLevel, revoked: true }, reason }, { tx });
  });
}

export async function savePlatformSetting(context: PlatformContext, input: { key: string; value: string | number | boolean; reason: string }) {
  assertPlatform(context, "platform.settings.manage");
  const category = input.key.split(".")[0];
  await prisma.$transaction(async (tx) => {
    const before = await tx.platformSetting.findUnique({ where: { key: input.key }, select: { value: true } });
    await tx.platformSetting.upsert({ where: { key: input.key }, update: { value: input.value as Prisma.InputJsonValue, updatedByUserId: context.userId, reason: input.reason, category }, create: { key: input.key, value: input.value as Prisma.InputJsonValue, updatedByUserId: context.userId, reason: input.reason, category } });
    await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_SETTING_CHANGED, entity: { type: "PlatformSetting", id: input.key, label: input.key }, before: before ? { key: input.key, value: before.value } : null, after: { key: input.key, value: input.value }, reason: input.reason }, { tx });
  });
}

/** What saving a maintenance setting reports (NAV-02 CACHE-02): the policy is committed; page snapshots follow. */
export type MaintenanceSaveResult = { ok: true; policyCommitted: true; pageRefresh: "complete" | "pending" };

/**
 * Saves one maintenance switch (NAV-02 CACHE-02). The setting and its audit
 * event commit together; only then is this process's page snapshot dropped, so
 * a rolled-back change never reaches a page. Enforcement reads the database
 * either way. If dropping the snapshot fails, the save still succeeded: the
 * result says page updates are pending — they follow within five seconds — so
 * nobody repeats an audited change that already happened.
 */
export async function saveMaintenanceSetting(context: PlatformContext, input: { key: string; enabled: boolean; reason: string }): Promise<MaintenanceSaveResult> {
  assertPlatform(context, "platform.maintenance.manage");
  await prisma.$transaction(async (tx) => {
    const before = await tx.platformSetting.findUnique({ where: { key: input.key }, select: { value: true } });
    await tx.platformSetting.upsert({ where: { key: input.key }, update: { value: input.enabled, updatedByUserId: context.userId, reason: input.reason, category: "maintenance" }, create: { key: input.key, value: input.enabled, updatedByUserId: context.userId, reason: input.reason, category: "maintenance" } });
    await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_MAINTENANCE_CHANGED, entity: { type: "PlatformSetting", id: input.key, label: input.key }, before: { key: input.key, enabled: before?.value === true }, after: { key: input.key, enabled: input.enabled }, reason: input.reason }, { tx });
  });
  try {
    invalidateMaintenanceSnapshot();
    return { ok: true, policyCommitted: true, pageRefresh: "complete" };
  } catch (error) {
    incrementCounter(Metric.MAINTENANCE_INVALIDATION_FAILURE);
    logger.error("maintenance.page_snapshot.invalidation_failed", { key: input.key, ...serialiseError(error) });
    return { ok: true, policyCommitted: true, pageRefresh: "pending" };
  }
}

export async function createSupportAccess(context: PlatformContext, input: { parentGroupId?: string; companyId?: string; projectId?: string; targetUserId?: string; reason: string; durationMinutes: number }) {
  assertPlatform(context, "platform.support.manage");
  let parentGroupId = input.parentGroupId;
  if (input.companyId) {
    const company = assertFound(await prisma.company.findFirst({ where: { id: input.companyId, parentGroup: { isTestFixture: false } }, select: { parentGroupId: true } }));
    if (parentGroupId && parentGroupId !== company.parentGroupId) throw new AccessError("VALIDATION_ERROR", "The support targets do not share a parent group.");
    parentGroupId = company.parentGroupId;
  }
  if (input.projectId) {
    const project = assertFound(await prisma.project.findFirst({ where: { id: input.projectId, company: { parentGroup: { isTestFixture: false } } }, select: { companyId: true, company: { select: { parentGroupId: true } } } }));
    if (input.companyId && input.companyId !== project.companyId) throw new AccessError("VALIDATION_ERROR", "The project does not belong to the selected company.");
    if (parentGroupId && parentGroupId !== project.company.parentGroupId) throw new AccessError("VALIDATION_ERROR", "The support targets do not share a parent group.");
    parentGroupId = project.company.parentGroupId;
  }
  if (input.targetUserId && !(await prisma.user.count({ where: { id: input.targetUserId } }))) throw new AccessError("NOT_FOUND");
  if (parentGroupId && !(await prisma.parentGroup.count({ where: { id: parentGroupId, isTestFixture: false } }))) throw new AccessError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const support = await tx.supportAccessSession.create({ data: { actorUserId: context.userId, parentGroupId: parentGroupId ?? null, companyId: input.companyId ?? null, projectId: input.projectId ?? null, targetUserId: input.targetUserId ?? null, reason: input.reason, expiresAt: new Date(Date.now() + input.durationMinutes * 60_000) } });
    await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_SUPPORT_ACCESS_CHANGED, entity: { type: "SupportAccessSession", id: support.id, label: "Sensitive support access" }, after: { supportSessionId: support.id, parentGroupId: parentGroupId ?? null, companyId: input.companyId ?? null, projectId: input.projectId ?? null, targetUserId: input.targetUserId ?? null, expiresAt: support.expiresAt.toISOString(), revoked: false }, reason: input.reason }, { tx });
    return support;
  });
}

export async function revokeSupportAccess(context: PlatformContext, supportSessionId: string, reason: string) {
  assertPlatform(context, "platform.support.manage");
  const support = assertFound(await prisma.supportAccessSession.findUnique({ where: { id: supportSessionId } }));
  if (support.revokedAt) return;
  await prisma.$transaction(async (tx) => {
    await tx.supportAccessSession.update({ where: { id: support.id }, data: { revokedAt: new Date(), revokedByUserId: context.userId } });
    await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_SUPPORT_ACCESS_CHANGED, entity: { type: "SupportAccessSession", id: support.id, label: "Sensitive support access" }, before: { supportSessionId: support.id, parentGroupId: support.parentGroupId, companyId: support.companyId, projectId: support.projectId, targetUserId: support.targetUserId, expiresAt: support.expiresAt.toISOString(), revoked: false }, after: { supportSessionId: support.id, parentGroupId: support.parentGroupId, companyId: support.companyId, projectId: support.projectId, targetUserId: support.targetUserId, expiresAt: support.expiresAt.toISOString(), revoked: true }, reason }, { tx });
  });
}

export async function runAccessInspection(context: PlatformContext, input: AccessInspectorInput) {
  return inspectAccess(context, input);
}

export const PLATFORM_MODULE_KEYS = MODULE_KEYS;
export const NON_TOGGLEABLE_MODULE_KEYS = [...CORE_MODULE_KEYS, ...SHARED_MODULES];
