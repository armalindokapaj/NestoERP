import { z } from "zod";

import { MODULE_KEYS, type ModuleKey } from "@/config/modules";
import { isMembershipRoleKey, roleLabel } from "@/config/roles";
import {
  supportsGroupWorkspace,
  WORKSPACE_CHANGED,
  WORKSPACE_SCOPE_TYPES,
  workspaceKey,
  type WorkspaceChange,
  type WorkspaceScopeType,
} from "@/config/workspace";
import { canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { recordAuthEvent } from "@/lib/auth/events";
import { moveSessionToMembership, setSessionWorkspaceScope, USABLE_GROUP_STATUSES } from "@/lib/auth/session-store";
import { hasGroupStanding, mayEnterGroupWorkspace, resolveContextForSession } from "@/lib/context/build-context";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { resolveGroupContexts } from "@/lib/context/workspace-access";
import { resolveWorkspaceRoute, type WorkspaceNavigationResult } from "@/lib/workspace/route-resolver";
import { quickCreateShellSummary, type QuickCreateShellDTO } from "@/lib/modules/quick-create/context-key";
import { quickCreateCandidates } from "@/lib/modules/quick-create/eligibility";

/**
 * The workspaces a person can work in, and moving the session between them
 * (Workspace Context §5-§9, §13, §77-§81).
 *
 * The one switcher: the Group above, then the companies they may enter. It
 * replaces the company switcher, which could only move the session between
 * memberships. A switch changes where the person works — never who they are
 * (§11): the user, the person and the session identity stay exactly as they were.
 */

/** §78 — the request to switch. Both fields are a request, validated here, never a grant (§14). */
export const switchWorkspaceSchema = z
  .object({
    scopeType: z.enum(WORKSPACE_SCOPE_TYPES),
    companyId: z.string().trim().min(1).max(64).nullish(),
    currentPathname: z.string().trim().startsWith("/").max(2048).default("/dashboard"),
    currentSearch: z.string().trim().max(4096).default(""),
    transitionId: z.number().int().positive().safe().optional(),
  })
  .refine((body) => (body.scopeType === "COMPANY" ? Boolean(body.companyId) : !body.companyId), {
    message: "A company workspace names its company; the Group workspace names none.",
    path: ["companyId"],
  });

export type WorkspaceCompanyDTO = {
  id: string;
  name: string;
  logoUrl: string | null;
  role: { key: string; label: string };
  department: string | null;
  isCurrent: boolean;
};

export type WorkspacesDTO = {
  parentGroup: { id: string; name: string; groupViewAllowed: boolean };
  /** The companies of this group the person may enter (§8). Suspended ones are not offered (§51). */
  companies: WorkspaceCompanyDTO[];
  /** Companies of any other group they belong to, each entered on its own. */
  otherGroups: Array<{ id: string; name: string; companies: WorkspaceCompanyDTO[] }>;
  active: { scopeType: WorkspaceScopeType; companyId: string | null };
  defaultWorkspace: { scopeType: WorkspaceScopeType; companyId: string | null };
  /**
   * Whether `+ Create` has anything to offer here, and its cache namespace —
   * derived from the contexts above, with no query of its own (NAV-01 QC-01).
   */
  quickCreate: QuickCreateShellDTO;
};

const USABLE_MEMBERSHIP = {
  status: "ACTIVE",
  user: { status: "ACTIVE" },
  company: { status: "ACTIVE", parentGroup: { status: { in: USABLE_GROUP_STATUSES } } },
} as const;

/** §77 — everything the switcher shows, derived from the person's own memberships and standing. */
export async function listWorkspaces(session: UserContext): Promise<WorkspacesDTO> {
  const [contexts, elsewhere] = await Promise.all([
    resolveGroupContexts(session),
    prisma.companyMember.findMany({
      where: {
        userId: session.userId,
        ...USABLE_MEMBERSHIP,
        company: { ...USABLE_MEMBERSHIP.company, parentGroupId: { not: session.parentGroupId } },
      },
      select: {
        id: true,
        companyId: true,
        role: { select: { key: true, name: true } },
        department: { select: { name: true } },
        company: { select: { name: true, logoUrl: true, parentGroup: { select: { id: true, name: true } } } },
      },
      orderBy: { company: { name: "asc" } },
    }),
  ]);

  const homeCompanyId = session.workspace.scopeType === "COMPANY" ? session.workspace.companyId : null;
  // Offered to group-level people and to anyone whose work spans two companies (§7, §8).
  const groupViewAllowed = mayEnterGroupWorkspace(contexts);

  const otherGroups = new Map<string, { id: string; name: string; companies: WorkspaceCompanyDTO[] }>();
  for (const membership of elsewhere) {
    if (!isMembershipRoleKey(membership.role.key)) continue;
    const group = membership.company.parentGroup;
    const entry = otherGroups.get(group.id) ?? { id: group.id, name: group.name, companies: [] };
    entry.companies.push({
      id: membership.companyId,
      name: membership.company.name,
      logoUrl: membership.company.logoUrl,
      role: { key: membership.role.key, label: roleLabel(membership.role.key) },
      department: membership.department?.name ?? null,
      isCurrent: false,
    });
    otherGroups.set(group.id, entry);
  }

  return {
    parentGroup: { id: session.parentGroup.id, name: session.parentGroup.name, groupViewAllowed },
    companies: contexts.map((context) => ({
      id: context.companyId,
      name: context.company.name,
      logoUrl: context.company.logoUrl,
      role: { key: context.role, label: context.roleLabel },
      department: context.department?.name ?? null,
      isCurrent: context.companyId === homeCompanyId,
    })),
    otherGroups: [...otherGroups.values()].sort((a, b) => a.name.localeCompare(b.name)),
    active: { scopeType: session.workspace.scopeType, companyId: session.workspace.companyId },
    // §16: group-level people start in the group, everyone else in their own
    // company — including somebody who may enter the group only because they
    // work in two (§7).
    defaultWorkspace: hasGroupStanding(contexts)
      ? { scopeType: "GROUP", companyId: null }
      : { scopeType: "COMPANY", companyId: session.companyId },
    quickCreate: quickCreateShellSummary(session, quickCreateCandidates(session, contexts)),
  };
}

export type WorkspaceContextDTO = {
  parentGroupId: string;
  scopeType: WorkspaceScopeType;
  companyId: string | null;
  accessibleCompanyIds: string[];
  effectiveModules: ModuleKey[];
  effectiveRoleLabels: string[];
  workspaceKey: string;
  workspaceVersion: number;
};

/** §79 — the effective context of the active workspace: what it lets this person reach. */
export async function getWorkspaceContext(session: UserContext): Promise<WorkspaceContextDTO> {
  const isGroup = session.workspace.scopeType === "GROUP";
  const [contexts, stored] = await Promise.all([
    isGroup ? resolveGroupContexts(session) : Promise.resolve([session]),
    prisma.session.findUnique({ where: { id: session.sessionId }, select: { workspaceVersion: true } }),
  ]);
  if (!stored) throw new AccessError("FORBIDDEN");

  const modules = new Set<ModuleKey>();
  for (const context of contexts) {
    for (const key of MODULE_KEYS) {
      if (isGroup && !supportsGroupWorkspace(key)) continue;
      if (isModuleEnabled(context, key) && canAccessModule(context, key)) modules.add(key);
    }
  }

  return {
    parentGroupId: session.workspace.parentGroupId,
    scopeType: session.workspace.scopeType,
    companyId: session.workspace.companyId,
    accessibleCompanyIds: contexts.map((context) => context.companyId),
    effectiveModules: MODULE_KEYS.filter((key) => modules.has(key)),
    effectiveRoleLabels: [...new Set(contexts.map((context) => context.roleLabel))].sort(),
    workspaceKey: workspaceKey(session.workspace),
    workspaceVersion: stored.workspaceVersion,
  };
}

export type SwitchWorkspaceResult = {
  switched: boolean;
  change: WorkspaceChange;
  context: WorkspaceContextDTO;
  navigation: WorkspaceNavigationResult;
  workspaceVersion: number;
  workspaceKey: string;
  effectiveModuleKeys: ModuleKey[];
};

/**
 * §80 — the switch transaction: authenticate (the caller), validate, resolve the
 * group and the company, verify the membership and standing, persist, return the
 * effective context. A workspace the person may not enter changes nothing and
 * keeps the previous one active (§89): 403 for a company they cannot enter — the
 * same answer whether the id is missing or somebody else's, so it never confirms
 * that a company exists (§81).
 */
export async function switchWorkspace(
  session: UserContext,
  body: z.input<typeof switchWorkspaceSchema>,
  request: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<SwitchWorkspaceResult> {
  const previous = { scopeType: session.workspace.scopeType, companyId: session.workspace.companyId };
  const transitionId = body.transitionId !== undefined
    ? BigInt(body.transitionId)
    : BigInt(Date.now()) * BigInt(1000);
  let next: { scopeType: WorkspaceScopeType; companyId: string | null; parentGroupId: string };

  if (body.scopeType === "GROUP") {
    // §91: a person without group-level standing never enters the Group workspace.
    if (!mayEnterGroupWorkspace(await resolveGroupContexts(session))) throw new AccessError("FORBIDDEN", undefined, undefined, "SCOPE_DENIED");
    next = { scopeType: "GROUP", companyId: null, parentGroupId: session.parentGroupId };
    if (previous.scopeType !== "GROUP") {
      const saved = await setSessionWorkspaceScope({ sessionId: session.sessionId, userId: session.userId, scope: "GROUP", transitionId });
      if (!saved) {
        const latest = await prisma.session.findFirst({ where: { id: session.sessionId, userId: session.userId }, select: { workspaceTransitionId: true } });
        if (latest && latest.workspaceTransitionId >= transitionId) incrementCounter(Metric.WORKSPACE_SWITCH_STALE_RESPONSE);
        throw new AccessError("FORBIDDEN");
      }
    }
  } else {
    const companyId = body.companyId!;
    const membership = await prisma.companyMember.findFirst({
      where: { userId: session.userId, companyId },
      select: {
        id: true,
        status: true,
        role: { select: { key: true } },
        user: { select: { status: true } },
        company: { select: { status: true, parentGroupId: true, parentGroup: { select: { status: true } } } },
      },
    });
    // §90: not a company they may enter, or not one at all — one answer for both.
    if (!membership || !isMembershipRoleKey(membership.role.key)) throw new AccessError("FORBIDDEN", undefined, undefined, "SCOPE_DENIED");
    // §51, §81: a workspace they belong to but that is not open right now says so.
    if (membership.status !== "ACTIVE" || membership.user.status !== "ACTIVE") throw new AccessError("MEMBERSHIP_INACTIVE");
    if (membership.company.status !== "ACTIVE" || !USABLE_GROUP_STATUSES.includes(membership.company.parentGroup.status)) {
      throw new AccessError("COMPANY_INACTIVE");
    }

    next = { scopeType: "COMPANY", companyId, parentGroupId: membership.company.parentGroupId };
    const alreadyThere = previous.scopeType === "COMPANY" && previous.companyId === companyId;
    if (!alreadyThere) {
      const { moved } = await moveSessionToMembership({
        sessionId: session.sessionId,
        userId: session.userId,
        membershipId: membership.id,
        transitionId,
      });
      // The membership or the session ended in between: nothing moved, nothing changed (§89).
      if (!moved) {
        const latest = await prisma.session.findFirst({ where: { id: session.sessionId, userId: session.userId }, select: { workspaceTransitionId: true } });
        if (latest && latest.workspaceTransitionId >= transitionId) incrementCounter(Metric.WORKSPACE_SWITCH_STALE_RESPONSE);
        throw new AccessError("FORBIDDEN", undefined, undefined, "SCOPE_DENIED");
      }
    }
  }

  const switched = previous.scopeType !== next.scopeType || previous.companyId !== next.companyId;

  // Read the context back from the session row, as the next request will: the
  // answer the caller gets is the state that was stored, not the state it asked for.
  const resolved = await resolveContextForSession(session.sessionId, { expectedUserId: session.userId });
  if (!resolved.ok) throw new AccessError("FORBIDDEN");
  const [context, navigation] = await Promise.all([
    getWorkspaceContext(resolved.context),
    resolveWorkspaceRoute({
      context: resolved.context,
      currentPathname: body.currentPathname ?? "/dashboard",
      currentSearch: body.currentSearch ?? "",
    }),
  ]);
  const key = workspaceKey(resolved.context.workspace);
  const change: WorkspaceChange = {
    previousScopeType: previous.scopeType,
    previousCompanyId: previous.companyId,
    nextScopeType: resolved.context.workspace.scopeType,
    nextCompanyId: resolved.context.workspace.companyId,
    parentGroupId: resolved.context.workspace.parentGroupId,
    workspaceKey: key,
    workspaceVersion: context.workspaceVersion,
  };

  if (switched) {
    await recordAuthEvent({
      type: "COMPANY_CONTEXT_SWITCHED",
      userId: session.userId,
      companyId: next.companyId ?? session.companyId,
      sessionId: session.sessionId,
      ipAddress: request.ipAddress ?? null,
      userAgent: request.userAgent ?? null,
      metadata: { event: WORKSPACE_CHANGED, resolution: navigation.resolution, ...change },
    });
  }

  return {
    switched,
    change,
    context,
    navigation,
    workspaceVersion: context.workspaceVersion,
    workspaceKey: key,
    effectiveModuleKeys: context.effectiveModules,
  };
}
