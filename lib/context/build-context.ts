import type { ParentGroupStatus, Prisma, User } from "@prisma/client";

import { accessAtLeast, widestScope } from "@/config/access";
import { MODULE_KEYS, type ModuleKey } from "@/config/modules";
import { isMutatingPermission, type Permission } from "@/config/permissions";
import { defaultAccessFor, grantPermissions } from "@/config/role-defaults";
import { isMembershipRoleKey, roleLabel, roles, type PositionLevel, type RoleKey } from "@/config/roles";
import { relocateSessionToUsableMembership, setSessionWorkspaceScope, USABLE_GROUP_STATUSES } from "@/lib/auth/session-store";
import { Metric, recordDuration } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import {
  assignmentsInCompany,
  grantsInCompany,
  loadOrganizationAccessFor,
  positionFor,
  type ContextAssignment,
  type ContextGrant,
  type OrganizationAccess,
} from "./organization-access";
import { peekScoped, scoped, seedScoped } from "@/lib/core/observability/request-scope";
import type { ContextResult, ModuleAccess, UserContext } from "./types";

/**
 * Builds the context from a session id alone.
 *
 * Separated from the cookie-reading entry point above so that integration tests
 * can exercise the real resolver — real database, real membership, real role,
 * real permissions — rather than mocking the authorisation they exist to verify
 * (PRD #9 §223).
 */
export async function resolveContextForSession(
  sessionId: string,
  /** `relocated` is set by the one retry below, so a fallback is never chased twice. */
  options: { expectedUserId?: string; relocated?: boolean } = {},
): Promise<ContextResult> {
  // The signed cookie carries only a session id. Validity, membership and
  // company are re-read from the database on every request, so revoking a
  // session or a membership takes effect immediately (PRD #6 §79, §113).
  const record = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: { include: { platformAccess: { select: { status: true } } } },
      membership: {
        include: {
          company: { include: { parentGroup: true } },
          role: true,
          department: true,
        },
      },
    },
  });

  if (!record) return { ok: false, reason: "SESSION_EXPIRED" };
  if (record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }

  // Never trust a session id on its own: the row must still describe the same
  // user and the same company as the membership it points at (PRD #6 §129A).
  if (options.expectedUserId && record.userId !== options.expectedUserId) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }
  // A platform session points at no membership at all. It is a real session,
  // but there is no company in it to build a context for (E-06 §116).
  if (!record.membership || !record.currentCompanyId) {
    if (record.user.status !== "ACTIVE") return { ok: false, reason: "USER_INACTIVE" };
    // Platform access revoked since: the session has nothing left to point at.
    if (record.user.platformAccess?.status !== "ACTIVE") return { ok: false, reason: "SESSION_EXPIRED" };
    return { ok: false, reason: "PLATFORM_SESSION" };
  }
  if (record.membership.userId !== record.userId) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }
  if (record.membership.companyId !== record.currentCompanyId) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }

  if (record.user.status !== "ACTIVE") return { ok: false, reason: "USER_INACTIVE" };

  // The workspace this session sits in may have been taken away while it was
  // open: the membership deactivated, the company closed, or the whole group
  // suspended — a suspended or archived group takes every company in it down
  // with it (E-06 §8, §117; a group still being implemented is usable, because
  // the people validating it have to be able to sign in, §21).
  //
  // §82: that invalidates the workspace, not necessarily the session. Somebody
  // who still works elsewhere in the group is moved there and the request
  // carries on; only somebody with nowhere left to go is turned away.
  const membershipGone = record.membership.status !== "ACTIVE";
  const companyGone = record.membership.company.status !== "ACTIVE" || !isParentGroupUsable(record.membership.company.parentGroup.status);
  if (membershipGone || companyGone) {
    if (!options.relocated && (await relocateSessionToUsableMembership({ sessionId, userId: record.userId }))) {
      return resolveContextForSession(sessionId, { ...options, relocated: true });
    }
    return { ok: false, reason: membershipGone ? "MEMBERSHIP_INACTIVE" : "COMPANY_UNAVAILABLE" };
  }

  // The role stored on the membership, and nothing else (C-01 §6, §31).
  const role = record.membership.role.key;
  if (!isMembershipRoleKey(role)) {
    // A membership pointing at a role the application does not know — or at the
    // Platform Admin's, which no membership may hold — is a configuration
    // fault, not an access grant.
    return { ok: false, reason: "CONFIGURATION_ERROR" };
  }

  const [enabledModules, organization] = await Promise.all([
    resolveEnabledModules(record.membership.companyId),
    loadOrganizationAccessFor(record.membership.company.parentGroupId, record.userId),
  ]);

  const company = assembleContext({
    user: record.user,
    membership: record.membership,
    sessionId: record.id,
    role,
    enabledModules,
    assignments: organization.assignments,
    grants: organization.grants,
  });

  if (record.workspaceScope === "COMPANY") return { ok: true, context: company };

  // A fresh session (null) starts in the Group workspace when the person has
  // group-level standing, in their company otherwise (§16). A session that asks
  // for the group holds it only while that standing lasts: access taken away in
  // the meantime drops them to their company on this very request (§82).
  const members = await loadGroupMemberContexts({
    userId: record.userId,
    parentGroupId: record.membership.company.parentGroupId,
    sessionId: record.id,
    organization,
  });
  // Asked for (or still holding) the group: allowed while they may enter it at
  // all. Chosen for a fresh session only for group-level standing — somebody
  // who simply works in two companies starts in their own (§16).
  const mayEnter = mayEnterGroupWorkspace(members);
  if (!mayEnter || (record.workspaceScope === null && !hasGroupStanding(members))) {
    await setSessionWorkspaceScope({ sessionId: record.id, userId: record.userId, scope: "COMPANY" });
    return { ok: true, context: company };
  }
  if (record.workspaceScope === null) {
    await setSessionWorkspaceScope({ sessionId: record.id, userId: record.userId, scope: "GROUP" });
  }

  const context: UserContext = {
    ...company,
    workspace: { parentGroupId: company.parentGroupId, scopeType: "GROUP", companyId: null },
  };
  groupMemberContexts.set(context, members);
  return { ok: true, context };
}

type MembershipForContext = Prisma.CompanyMemberGetPayload<{
  include: { company: { include: { parentGroup: true } }; department: true };
}>;

/** Groups whose companies may be worked in (E-06 §21). */
export function isParentGroupUsable(status: ParentGroupStatus): boolean {
  return USABLE_GROUP_STATUSES.includes(status);
}

/**
 * The one place a `UserContext` is assembled.
 *
 * The session resolver and `buildMemberContext` both come through here, so "what
 * may this member do?" has one answer whether they are signed in or are being
 * notified, mentioned or checked as a reviewer (PRD #38 §31, §76).
 */
export function assembleContext(input: {
  user: User;
  membership: MembershipForContext;
  sessionId: string;
  role: RoleKey;
  enabledModules: ModuleKey[];
  assignments: readonly ContextAssignment[];
  grants: readonly ContextGrant[];
}): UserContext {
  const { user, membership, role, enabledModules } = input;
  const company = membership.company;
  const assignments = assignmentsInCompany(input.assignments, company.id);
  // Position and delegated access are always this member's own (C-01 §33).
  const position: PositionLevel = positionFor(role, company.id, assignments);
  const grants = grantsInCompany(input.grants, company.parentGroupId, company.id);
  const moduleAccess = buildModuleAccess(role, enabledModules, position, grants);

  // A permission for a module the company has switched off is not held at all,
  // so navigation, dashboards and guards all agree without special-casing.
  const permissions = [
    ...new Set(
      Object.values(moduleAccess).flatMap((access) => (access.enabled ? access.permissions : [])),
    ),
  ].sort();

  return {
    userId: user.id,
    companyId: company.id,
    membershipId: membership.id,
    sessionId: input.sessionId,

    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    jobTitle: membership.jobTitle,

    company: {
      id: company.id,
      slug: company.slug,
      name: company.name,
      legalName: company.legalName,
      logoUrl: company.logoUrl,
      industry: company.industry,
      country: company.country,
      address: company.address,
      email: company.email,
      phone: company.phone,
      website: company.website,
    },
    department: membership.department
      ? { id: membership.department.id, key: membership.department.key, name: membership.department.name }
      : null,
    parentGroupId: company.parentGroupId,
    parentGroup: {
      id: company.parentGroup.id,
      slug: company.parentGroup.slug,
      name: company.parentGroup.name,
      status: company.parentGroup.status,
      isDemo: company.parentGroup.isDemo,
    },

    role,
    roleLabel: roleLabel(role),
    position,
    assignments,
    permissions,
    moduleAccess,
    enabledModules,
    // A context assembled here is always one company's: the person working in it.
    // The Group workspace is stated by the session resolver, above (§4).
    workspace: { parentGroupId: company.parentGroupId, scopeType: "COMPANY", companyId: company.id },
  };
}

/**
 * The other contexts a Group workspace reads, kept beside the session's own
 * context for the length of the request that resolved it. A WeakMap: the
 * contexts are per request and per person, never a cache across either, so
 * nothing outlives the context object they were built for (§69).
 */
const groupMemberContexts = new WeakMap<UserContext, UserContext[]>();

/** The per-company contexts resolved with this Group-workspace context, if they were. */
export function groupMemberContextsOf(context: UserContext): UserContext[] | undefined {
  return groupMemberContexts.get(context);
}

/**
 * One person's context in every usable company of one group (§13, §57).
 *
 * The same `assembleContext` the session uses, once per active membership, so
 * "what may this person do in that company?" has one answer whichever way it is
 * asked. Batched — one membership query, one module query — because a Group
 * workspace asks it on every request. A suspended company, an inactive
 * membership and a group that is not usable yield no context: they are not
 * places the person can work in (§51).
 *
 * Within a request it reuses what the request already read (NAV-02 QUERY-01,
 * QUERY-02): the person's organization access, and the modules of any company
 * already resolved — the session's own, usually. Only the companies still
 * unknown are batched.
 */
export async function loadGroupMemberContexts(input: {
  userId: string;
  parentGroupId: string;
  sessionId: string;
  organization?: OrganizationAccess;
}): Promise<UserContext[]> {
  const startedAt = performance.now();
  const [memberships, organization] = await Promise.all([
    prisma.companyMember.findMany({
      where: {
        userId: input.userId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
        company: { parentGroupId: input.parentGroupId, status: "ACTIVE" },
      },
      include: { user: true, role: true, company: { include: { parentGroup: true } }, department: true },
    }),
    input.organization ? Promise.resolve(input.organization) : loadOrganizationAccessFor(input.parentGroupId, input.userId),
  ]);
  const usable = memberships.filter(
    (membership) => isParentGroupUsable(membership.company.parentGroup.status) && isMembershipRoleKey(membership.role.key),
  );
  if (usable.length === 0) return [];

  const enabledByCompany = await enabledModulesFor(usable.map((membership) => membership.companyId));

  const contexts = usable
    .map((membership) =>
      assembleContext({
        user: membership.user,
        membership,
        sessionId: input.sessionId,
        role: membership.role.key as RoleKey,
        enabledModules: enabledByCompany.get(membership.companyId) ?? ["dashboard"],
        assignments: organization.assignments,
        grants: organization.grants,
      }),
    )
    .sort((a, b) => a.company.name.localeCompare(b.company.name));
  recordDuration(Metric.COMPANY_CONTEXTS_MS, Metric.COMPANY_CONTEXTS, startedAt);
  return contexts;
}

/**
 * The modules of several companies (QUERY-02): those this request has already
 * read are reused, the rest are read in one batch and remembered for the rest
 * of the request. A company in the batch with no switch on is loaded and
 * disabled — its answer is the Dashboard alone, never "not loaded".
 */
async function enabledModulesFor(companyIds: readonly string[]): Promise<Map<string, ModuleKey[]>> {
  const unique = [...new Set(companyIds)];
  const known = unique.map((companyId) => [companyId, peekScoped<ModuleKey[]>(moduleKeyFor(companyId))] as const);
  const unresolved = known.filter(([, pending]) => !pending).map(([companyId]) => companyId);

  const result = new Map<string, ModuleKey[]>();
  if (unresolved.length > 0) {
    const switches = await prisma.companyModule.findMany({
      where: { companyId: { in: unresolved }, enabled: true },
      select: { companyId: true, module: { select: { key: true } } },
    });
    const enabledByCompany = new Map<string, Set<string>>();
    for (const row of switches) {
      const keys = enabledByCompany.get(row.companyId) ?? new Set<string>();
      keys.add(row.module.key);
      enabledByCompany.set(row.companyId, keys);
    }
    for (const companyId of unresolved) {
      const switchedOn = enabledByCompany.get(companyId) ?? new Set<string>();
      const enabled = enabledModuleList(switchedOn);
      result.set(companyId, enabled);
      seedScoped(moduleKeyFor(companyId), enabled);
    }
  }
  for (const [companyId, pending] of known) {
    if (pending) result.set(companyId, await pending);
  }
  return result;
}

function moduleKeyFor(companyId: string): string {
  return `modules:${companyId}`;
}

/** Dashboard is part of the shell rather than a switchable module. */
function enabledModuleList(switchedOn: ReadonlySet<string>): ModuleKey[] {
  return MODULE_KEYS.filter((key) => key === "dashboard" || switchedOn.has(key));
}

/**
 * Whether this person may work in the Group workspace (§7, §63).
 *
 * Group-level standing is not a role label. It is the access model's own group
 * scope: a module they hold over the whole group — the Owner's and Group IT's
 * organization access, a group department head's, or anything delegated to
 * them with group scope — in at least one company they can enter. Derived from
 * the contexts, so an Owner reads "group" the same way an administrator's
 * grant does, and a company-only employee never does.
 */
export function hasGroupStanding(contexts: readonly UserContext[]): boolean {
  return contexts.some((context) =>
    Object.values(context.moduleAccess).some(
      // The people directory is group-wide for everybody who works in a company
      // (E-01 §103): knowing the group's people is not standing in the group.
      (access) => access.module !== "people" && access.scope === "GROUP" && access.accessLevel !== "NONE",
    ),
  );
}

/**
 * Whether the Group workspace is offered at all (§7, §8, §91).
 *
 * Group-level standing is one way in. Working in more than one company of the
 * group is the other: the Group workspace then unions the companies they
 * already belong to and shows what they may already read in each, so it grants
 * nothing — it is the one page that answers "my projects, my tasks" for
 * somebody whose work is split between two companies (E-05A §26).
 *
 * What §7 and §91 refuse is a *company-only* employee, and one company is
 * exactly what they have: they are never offered it.
 */
export function mayEnterGroupWorkspace(contexts: readonly UserContext[]): boolean {
  return contexts.length > 1 || hasGroupStanding(contexts);
}

/** Company-level module activation (PRD #7 §59). */
/**
 * Exported so anything resolving access outside a session — the notification
 * dispatcher re-checking each recipient — uses this definition rather than its
 * own. Two module-access rules that can disagree is how a notification tells
 * somebody about a module their company switched off.
 */
export function resolveEnabledModules(companyId: string): Promise<ModuleKey[]> {
  // Once per company per request (NAV-02 QUERY-02); the next request reads again.
  return scoped(moduleKeyFor(companyId), async () => {
    const rows = await prisma.companyModule.findMany({
      where: { companyId, enabled: true },
      include: { module: true },
    });
    return enabledModuleList(new Set(rows.map((row) => row.module.key)));
  });
}

export function buildModuleAccess(
  role: RoleKey,
  enabledModules: readonly ModuleKey[],
  position: PositionLevel = "MEMBER",
  grants: readonly ContextGrant[] = [],
): Record<ModuleKey, ModuleAccess> {
  const enabled = new Set(enabledModules);
  const readOnly = Boolean(roles[role].readOnly);

  return Object.fromEntries(
    MODULE_KEYS.map((moduleKey) => {
      const preset = defaultAccessFor(role, moduleKey, position);
      const moduleEnabled = enabled.has(moduleKey);

      let accessLevel = preset.accessLevel;
      let scope = preset.scope;
      let permissions = preset.permissions as Permission[];

      // Delegated access raises a module to the grant's rung, company-wide or
      // group-wide as it was granted (E-06 §18). It never lowers anything, and a
      // read-only role stays read-only whatever it was handed.
      for (const grant of grants) {
        if (grant.moduleKey !== moduleKey || grant.accessLevel === "NONE") continue;
        if (!accessAtLeast(accessLevel, grant.accessLevel)) accessLevel = readOnly ? "VIEW" : grant.accessLevel;
        scope = widestScope(scope, grant.scopeType === "GROUP" ? "GROUP" : "COMPANY");
        const granted = grantPermissions(moduleKey, grant.accessLevel).filter(
          (permission) => !readOnly || !isMutatingPermission(permission),
        );
        permissions = [...new Set([...permissions, ...granted])].sort();
      }

      const access: ModuleAccess = {
        module: moduleKey,
        accessLevel: moduleEnabled ? accessLevel : "NONE",
        scope,
        permissions: moduleEnabled ? permissions : [],
        enabled: moduleEnabled,
      };

      return [moduleKey, access];
    }),
  ) as Record<ModuleKey, ModuleAccess>;
}
