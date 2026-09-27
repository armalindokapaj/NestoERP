import { z } from "zod";

import { accessAtLeast, scopeAtLeast, type AccessLevel } from "@/config/access";
import { GRANTABLE_MODULE_KEYS, isGrantableModule, modulesOfFunction, rolesOfFunction } from "@/config/group-departments";
import { modules as moduleRegistry, type ModuleKey } from "@/config/modules";
import { defaultAccessFor } from "@/config/role-defaults";
import { isMembershipRoleKey, roles, type RoleKey } from "@/config/roles";
import { can } from "@/lib/access/can";
import { AccessError, assertFound } from "@/lib/access/guards";
import { resolveEnabledModules } from "@/lib/context/build-context";
import { contextInCompany } from "@/lib/context/member-context";
import { assignmentsInCompany, loadOrganizationAccessFor, positionFor } from "@/lib/context/organization-access";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { invalidateRequestScope } from "@/lib/core/observability/request-scope";

/**
 * Delegated access (E-06 §18, §73, §78).
 *
 * An access grant raises one module, for one person, to one rung of the access
 * ladder — in one company of the group or in all of them. The session resolver
 * already honours live grants (`grantsInCompany`, `buildModuleAccess`); this is
 * the door that makes and ends them.
 *
 * - **Who.** The Owner (`organization.access.grant`) for any function's module;
 *   a group department head (`department.team.access.delegate`) for their own
 *   function's modules, to their own function's people. Nobody grants to
 *   themselves.
 * - **What.** Only the functions' business modules (`GRANTABLE_MODULE_KEYS`).
 *   Administration is never delegated: it would hand on the power to hand on.
 * - **Ceiling.** Nobody delegates more than they hold. In every company the
 *   grant reaches, the grantor's own role and position must open the module at
 *   the granted rung or higher, company-wide. What was delegated to the grantor
 *   does not count, so a grant is never passed along a chain.
 * - **Where.** GROUP (every company of the group, now and later) or COMPANY.
 *   Narrower scopes are recorded by the model but do not widen a module in
 *   V0.1, so they are refused rather than stored to do nothing.
 *
 * A grant is ended by revoking it; it stays as history either way.
 */

export const GRANT_LEVELS = ["VIEW", "CONTRIBUTE", "APPROVE", "MANAGE"] as const satisfies readonly AccessLevel[];
export const GRANT_SCOPES = ["GROUP", "COMPANY"] as const;

const optionalDate = z.coerce.date().nullable().optional();

export const grantAccessSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  moduleKey: z.string().trim().min(1).max(40),
  scope: z.enum(GRANT_SCOPES),
  /** The company of a COMPANY grant; ignored for a GROUP one. */
  scopeCompanyId: z.string().trim().min(1).max(64).nullable().optional(),
  accessLevel: z.enum(GRANT_LEVELS),
  startsAt: optionalDate,
  /** The grant stops working at this moment. */
  expiresAt: optionalDate,
  reason: z.string().trim().min(3, "Say why this access is needed.").max(500),
}).superRefine((value, ctx) => {
  /*
   * The company belongs to a company grant only (AUD-09 §5, FV-10): the form
   * hides it for a group grant and omits it, and a group grant that carries
   * one anyway is an incompatible state, refused rather than ignored.
   */
  if (value.scope === "COMPANY" && !value.scopeCompanyId) ctx.addIssue({ code: "custom", path: ["scopeCompanyId"], message: "Choose a company of your group." });
  if (value.scope === "GROUP" && value.scopeCompanyId) ctx.addIssue({ code: "custom", path: ["scopeCompanyId"], message: "A group grant covers every company; it names none." });
});
export type GrantAccessInput = z.infer<typeof grantAccessSchema>;

export const revokeGrantSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});
export type RevokeGrantInput = z.infer<typeof revokeGrantSchema>;

export const grantListQuerySchema = z.object({
  status: z.enum(["live", "all"]).default("live"),
  userId: z.string().trim().min(1).max(64).optional(),
});
export type GrantListQuery = z.infer<typeof grantListQuerySchema>;

export type GrantStatus = "LIVE" | "SCHEDULED" | "EXPIRED" | "REVOKED";

export type AccessGrantDTO = {
  id: string;
  holder: { userId: string; name: string };
  module: { key: string; label: string };
  scope: { type: "GROUP" | "COMPANY"; company: { id: string; name: string } | null };
  accessLevel: AccessLevel;
  status: GrantStatus;
  startsAt: string | null;
  expiresAt: string | null;
  reason: string | null;
  grantedBy: { userId: string; name: string };
  grantedAt: string;
  revokedAt: string | null;
  revokedBy: { userId: string; name: string } | null;
  canRevoke: boolean;
};

const fullName = (user: { firstName: string; lastName: string }) => `${user.firstName} ${user.lastName}`;

function moduleLabel(key: string): string {
  return (moduleRegistry as Record<string, { label: string } | undefined>)[key]?.label ?? key;
}

export function grantStatus(grant: { startsAt: Date | null; expiresAt: Date | null; revokedAt: Date | null }, now = new Date()): GrantStatus {
  if (grant.revokedAt) return "REVOKED";
  if (grant.expiresAt && grant.expiresAt <= now) return "EXPIRED";
  if (grant.startsAt && grant.startsAt > now) return "SCHEDULED";
  return "LIVE";
}

/** The functions this reader heads across the group, by group department key. */
async function headedFunctions(context: UserContext): Promise<string[]> {
  const access = await loadOrganizationAccessFor(context.parentGroupId, context.userId);
  return access.assignments.filter((assignment) => assignment.positionLevel === "GROUP_HEAD" && assignment.companyId === null).map((assignment) => assignment.groupDepartmentKey);
}

/** The modules a head may delegate: their functions' own. */
function delegableModules(functions: readonly string[]): Set<string> {
  return new Set(functions.flatMap((key) => modulesOfFunction(key)));
}

/** Who may make grants at all, and for which modules (null = any grantable module). */
async function grantAuthority(context: UserContext): Promise<{ anyModule: boolean; modules: Set<string>; functions: string[] } | null> {
  if (can(context, "organization.access.grant")) return { anyModule: true, modules: new Set(), functions: [] };
  if (!can(context, "department.team.access.delegate")) return null;
  const functions = await headedFunctions(context);
  return { anyModule: false, modules: delegableModules(functions), functions };
}

/**
 * What a person may delegate in one company: their role and position there,
 * never what was delegated to them. Null when they do not work there.
 */
export async function delegationCeiling(
  parentGroupId: string,
  userId: string,
  companyIds: readonly string[],
): Promise<Map<string, { role: RoleKey; position: ReturnType<typeof positionFor> } | null>> {
  const [memberships, access] = await Promise.all([
    prisma.companyMember.findMany({
      where: { userId, companyId: { in: [...companyIds] }, status: "ACTIVE", user: { status: "ACTIVE" }, company: { parentGroupId, status: "ACTIVE" } },
      select: { companyId: true, role: { select: { key: true } } },
    }),
    loadOrganizationAccessFor(parentGroupId, userId),
  ]);
  const result = new Map<string, { role: RoleKey; position: ReturnType<typeof positionFor> } | null>(companyIds.map((id) => [id, null]));
  for (const membership of memberships) {
    if (!isMembershipRoleKey(membership.role.key)) continue;
    const role = membership.role.key;
    result.set(membership.companyId, { role, position: positionFor(role, membership.companyId, assignmentsInCompany(access.assignments, membership.companyId)) });
  }
  return result;
}

function withinCeiling(holding: { role: RoleKey; position: ReturnType<typeof positionFor> } | null, moduleKey: ModuleKey, level: AccessLevel): boolean {
  if (!holding) return false;
  const preset = defaultAccessFor(holding.role, moduleKey, holding.position);
  return accessAtLeast(preset.accessLevel, level) && scopeAtLeast(preset.scope, "COMPANY");
}

export async function grantAccess(context: UserContext, input: GrantAccessInput): Promise<{ grantId: string }> {
  const authority = await grantAuthority(context);
  if (!authority) throw new AccessError("FORBIDDEN");
  if (!isGrantableModule(input.moduleKey)) {
    throw new AccessError("VALIDATION_ERROR", "Access can be delegated only in a department's own modules.", { field: "moduleKey", code: "NOT_GRANTABLE" });
  }
  const moduleKey = input.moduleKey;
  if (!authority.anyModule && !authority.modules.has(moduleKey)) {
    throw new AccessError("FORBIDDEN", "You delegate access only in your own department's modules.", { code: "OUTSIDE_FUNCTION" });
  }
  if (input.userId === context.userId) {
    throw new AccessError("VALIDATION_ERROR", "Access is delegated to somebody else, never to yourself.", { field: "userId", code: "SELF_GRANT" });
  }

  const companies = await prisma.company.findMany({ where: { parentGroupId: context.parentGroupId, status: "ACTIVE" }, select: { id: true, name: true } });
  let reached: string[];
  let scopeId: string;
  if (input.scope === "COMPANY") {
    const company = companies.find((row) => row.id === input.scopeCompanyId);
    if (!company) throw new AccessError("VALIDATION_ERROR", "Choose a company of your group.", { field: "scopeCompanyId" });
    reached = [company.id];
    scopeId = company.id;
    if (!(await resolveEnabledModules(company.id)).includes(moduleKey)) {
      throw new AccessError("VALIDATION_ERROR", `${company.name} has switched ${moduleLabel(moduleKey)} off.`, { field: "moduleKey", code: "MODULE_DISABLED" });
    }
  } else {
    reached = companies.map((row) => row.id);
    scopeId = context.parentGroupId;
  }

  // The holder works in the group — and, for a company grant, in that company.
  // Somebody outside the group is not found, whatever their id.
  const holderMemberships = await prisma.companyMember.findMany({
    where: { userId: input.userId, status: "ACTIVE", user: { status: "ACTIVE" }, company: { parentGroupId: context.parentGroupId, status: "ACTIVE" } },
    select: { companyId: true, role: { select: { key: true } }, department: { select: { groupDepartment: { select: { key: true } } } }, user: { select: { firstName: true, lastName: true } } },
  });
  if (holderMemberships.length === 0) throw new AccessError("NOT_FOUND");
  const holderName = fullName(holderMemberships[0].user);
  const reachedMemberships = holderMemberships.filter((membership) => reached.includes(membership.companyId));
  if (reachedMemberships.length === 0) {
    throw new AccessError("VALIDATION_ERROR", `${holderName} does not work in that company.`, { field: "userId", code: "NOT_A_MEMBER" });
  }

  // A head delegates to the people of the function: those working as its role,
  // or in a branch of it.
  if (!authority.anyModule) {
    const functions = authority.functions.filter((key) => modulesOfFunction(key).includes(moduleKey));
    const assigned = await prisma.departmentAssignment.count({
      where: { userId: input.userId, parentGroupId: context.parentGroupId, status: "ACTIVE", groupDepartment: { key: { in: functions } } },
    });
    const ofFunction =
      assigned > 0 ||
      holderMemberships.some(
        (membership) =>
          functions.some((key) => (rolesOfFunction(key) as readonly string[]).includes(membership.role.key)) ||
          (membership.department?.groupDepartment?.key !== undefined && functions.includes(membership.department.groupDepartment.key)),
      );
    if (!ofFunction) throw new AccessError("FORBIDDEN", "You delegate access only to your own department's people.", { code: "OUTSIDE_FUNCTION" });
  }

  // A read-only role stays read-only whatever it is handed (`buildModuleAccess`);
  // a grant that could only ever mean View is refused above View.
  const everyReadOnly = reachedMemberships.every((membership) => isMembershipRoleKey(membership.role.key) && Boolean(roles[membership.role.key].readOnly));
  if (everyReadOnly && input.accessLevel !== "VIEW") {
    throw new AccessError("VALIDATION_ERROR", `${holderName} has a read-only role; delegate View at most.`, { field: "accessLevel", code: "READ_ONLY_HOLDER" });
  }

  const now = new Date();
  const startsAt = input.startsAt ?? now;
  if (input.expiresAt && input.expiresAt <= (startsAt > now ? startsAt : now)) {
    throw new AccessError("VALIDATION_ERROR", "The end must come after the start, and after today.", { field: "expiresAt" });
  }

  const ceiling = await delegationCeiling(context.parentGroupId, context.userId, reached);
  const above = reached.filter((companyId) => !withinCeiling(ceiling.get(companyId) ?? null, moduleKey, input.accessLevel));
  if (above.length > 0) {
    const names = companies.filter((row) => above.includes(row.id)).map((row) => row.name).join(", ");
    throw new AccessError("FORBIDDEN", `You do not hold ${moduleLabel(moduleKey)} at that level company-wide in ${names}, so you cannot delegate it there.`, { code: "ABOVE_CEILING", companyIds: above });
  }

  // A company grant is the company's business: its audit log records it, as
  // the grantor's membership there (§161). A group grant stays in the session's.
  const acting = input.scope === "COMPANY" ? await contextInCompany(context, scopeId) : context;
  if (!acting) throw new AccessError("FORBIDDEN");

  const grantId = await prisma.$transaction(async (tx) => {
    const duplicate = await tx.accessGrant.count({
      where: {
        userId: input.userId,
        parentGroupId: context.parentGroupId,
        functionKey: moduleKey,
        scopeType: input.scope,
        scopeId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    if (duplicate > 0) throw new AccessError("CONFLICT", `${holderName} already has ${moduleLabel(moduleKey)} delegated there. Revoke it first to change it.`, { code: "GRANT_EXISTS" });
    const grant = await tx.accessGrant.create({
      data: {
        userId: input.userId,
        parentGroupId: context.parentGroupId,
        functionKey: moduleKey,
        scopeType: input.scope,
        scopeId,
        accessLevel: input.accessLevel,
        grantedByUserId: context.userId,
        startsAt,
        expiresAt: input.expiresAt ?? null,
        reason: input.reason,
      },
      select: { id: true },
    });
    await recordUserAction(
      acting,
      {
        actionKey: AuditAction.ORGANIZATION_ACCESS_GRANTED,
        entity: { type: "AccessGrant", id: grant.id, label: `${holderName} — ${moduleLabel(moduleKey)}` },
        after: { userId: input.userId, moduleKey, scopeType: input.scope, scopeId, accessLevel: input.accessLevel, startsAt: startsAt.toISOString(), expiresAt: input.expiresAt?.toISOString() ?? null },
        metadata: { reason: input.reason },
      },
      { tx },
    );
    return grant.id;
  });
  // Access has changed: nothing later in this request answers from before it (NAV-02 CTX-04).
  invalidateRequestScope();
  return { grantId };
}

export async function revokeAccessGrant(context: UserContext, grantId: string, input: RevokeGrantInput = {}): Promise<void> {
  const grant = assertFound(
    await prisma.accessGrant.findFirst({
      where: { id: grantId, parentGroupId: context.parentGroupId },
      select: { id: true, userId: true, functionKey: true, scopeType: true, scopeId: true, accessLevel: true, grantedByUserId: true, revokedAt: true, user: { select: { firstName: true, lastName: true } } },
    }),
  );
  if (!(await mayRevoke(context, grant))) throw new AccessError("FORBIDDEN");
  if (grant.revokedAt) throw new AccessError("CONFLICT", "This access has already been revoked.", { code: "GRANT_REVOKED" });

  const acting = grant.scopeType === "COMPANY" && grant.scopeId ? ((await contextInCompany(context, grant.scopeId)) ?? context) : context;
  await prisma.$transaction(async (tx) => {
    const revoked = await tx.accessGrant.updateMany({ where: { id: grant.id, revokedAt: null }, data: { revokedAt: new Date(), revokedByUserId: context.userId } });
    if (revoked.count === 0) throw new AccessError("CONFLICT", "This access has already been revoked.", { code: "GRANT_REVOKED" });
    await recordUserAction(
      acting,
      {
        actionKey: AuditAction.ORGANIZATION_ACCESS_GRANT_REVOKED,
        entity: { type: "AccessGrant", id: grant.id, label: `${fullName(grant.user)} — ${moduleLabel(grant.functionKey ?? "")}` },
        before: { userId: grant.userId, moduleKey: grant.functionKey, scopeType: grant.scopeType, scopeId: grant.scopeId, accessLevel: grant.accessLevel },
        ...(input.reason ? { metadata: { reason: input.reason } } : {}),
      },
      { tx },
    );
  });
  invalidateRequestScope();
}

/** The Owner, the head of the function the module belongs to, or whoever made it. Taking access away is always safe. */
async function mayRevoke(context: UserContext, grant: { grantedByUserId: string; functionKey: string | null }): Promise<boolean> {
  if (can(context, "organization.access.grant")) return true;
  if (grant.grantedByUserId === context.userId) return true;
  if (!can(context, "department.team.access.delegate") || !grant.functionKey) return false;
  return delegableModules(await headedFunctions(context)).has(grant.functionKey);
}

/**
 * Grants in the group. Those who keep access (`organization.access.view`) read
 * every grant; a head reads the grants in their function's modules.
 */
export async function listAccessGrants(context: UserContext, query: GrantListQuery): Promise<AccessGrantDTO[]> {
  const readsAll = can(context, "organization.access.view") || can(context, "organization.access.grant");
  let modules: string[] | null = null;
  if (!readsAll) {
    if (!can(context, "department.team.access.delegate")) throw new AccessError("FORBIDDEN");
    modules = [...delegableModules(await headedFunctions(context))];
  }
  const now = new Date();
  const rows = await prisma.accessGrant.findMany({
    where: {
      parentGroupId: context.parentGroupId,
      ...(modules ? { functionKey: { in: modules } } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.status === "live" ? { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } : {}),
    },
    select: {
      id: true,
      functionKey: true,
      scopeType: true,
      scopeId: true,
      accessLevel: true,
      startsAt: true,
      expiresAt: true,
      revokedAt: true,
      reason: true,
      createdAt: true,
      grantedByUserId: true,
      revokedByUserId: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: 500,
  });

  const peopleIds = [...new Set(rows.flatMap((row) => [row.grantedByUserId, row.revokedByUserId].filter((id): id is string => Boolean(id))))];
  const companyIds = [...new Set(rows.filter((row) => row.scopeType === "COMPANY" && row.scopeId).map((row) => row.scopeId!))];
  const [people, companies, owner, heads] = await Promise.all([
    peopleIds.length ? prisma.user.findMany({ where: { id: { in: peopleIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
    companyIds.length ? prisma.company.findMany({ where: { id: { in: companyIds }, parentGroupId: context.parentGroupId }, select: { id: true, name: true } }) : [],
    Promise.resolve(can(context, "organization.access.grant")),
    can(context, "department.team.access.delegate") ? headedFunctions(context).then(delegableModules) : Promise.resolve(new Set<string>()),
  ]);
  const personName = new Map(people.map((person) => [person.id, fullName(person)]));
  const companyName = new Map(companies.map((company) => [company.id, company.name]));

  return rows.map((row) => {
    const status = grantStatus(row, now);
    return {
      id: row.id,
      holder: { userId: row.user.id, name: fullName(row.user) },
      module: { key: row.functionKey ?? "", label: moduleLabel(row.functionKey ?? "") },
      scope: {
        type: row.scopeType === "COMPANY" ? "COMPANY" : "GROUP",
        company: row.scopeType === "COMPANY" && row.scopeId ? { id: row.scopeId, name: companyName.get(row.scopeId) ?? "—" } : null,
      },
      accessLevel: row.accessLevel,
      status,
      startsAt: row.startsAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      reason: row.reason,
      grantedBy: { userId: row.grantedByUserId, name: personName.get(row.grantedByUserId) ?? "—" },
      grantedAt: row.createdAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revokedBy: row.revokedByUserId ? { userId: row.revokedByUserId, name: personName.get(row.revokedByUserId) ?? "—" } : null,
      canRevoke: status !== "REVOKED" && status !== "EXPIRED" && (owner || row.grantedByUserId === context.userId || (row.functionKey !== null && heads.has(row.functionKey))),
    };
  });
}

export type GrantOptionsDTO = {
  modules: Array<{ key: string; label: string }>;
  companies: Array<{ id: string; name: string }>;
  people: Array<{ userId: string; name: string }>;
};

/** What the grant form offers this reader: the modules they may delegate, the group's companies, the people they may delegate to. */
export async function grantOptions(context: UserContext): Promise<GrantOptionsDTO | null> {
  const authority = await grantAuthority(context);
  if (!authority) return null;
  const moduleKeys = authority.anyModule ? [...GRANTABLE_MODULE_KEYS] : [...authority.modules];
  const [companies, members] = await Promise.all([
    prisma.company.findMany({ where: { parentGroupId: context.parentGroupId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.companyMember.findMany({
      where: { status: "ACTIVE", user: { status: "ACTIVE" }, company: { parentGroupId: context.parentGroupId, status: "ACTIVE" }, NOT: { userId: context.userId } },
      select: { userId: true, role: { select: { key: true } }, user: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const functionRoles = new Set(authority.functions.flatMap((key) => rolesOfFunction(key) as readonly string[]));
  const people = new Map<string, string>();
  for (const member of members) {
    if (!authority.anyModule && !functionRoles.has(member.role.key)) continue;
    people.set(member.userId, fullName(member.user));
  }
  return {
    modules: moduleKeys.map((key) => ({ key, label: moduleLabel(key) })),
    companies,
    people: [...people.entries()].map(([userId, name]) => ({ userId, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
