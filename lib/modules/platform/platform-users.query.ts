import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { AccessError, assertFound } from "@/lib/access/guards";
import { maskEmail } from "@/lib/auth/password-recovery";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { moduleLabel } from "@/lib/core/entitlements/entitlement.resolver";
import { prisma } from "@/lib/database/prisma";

/**
 * NESTO user accounts for Platform Admin (Admin Users PRD #6 §3-§25, §39-§44).
 *
 * Accounts, not the workforce: an employee without a login is not here. Access
 * is shown in its layers — group seat, company memberships, project places and
 * grants — never flattened into one role string. No password, hash or token
 * is ever read.
 */

function assertView(context: PlatformContext) {
  if (!canPlatform(context, "platform.user.view")) throw new AccessError("FORBIDDEN");
}

export const USER_PAGE_SIZE = 25;
export const userDirectorySchema = z.object({
  q: z.string().trim().max(120).catch(""),
  status: z.enum(["", "ACTIVE", "INACTIVE", "SUSPENDED"]).catch(""),
  scope: z.enum(["", "platform", "group", "company", "none"]).catch(""),
  group: z.string().trim().max(128).catch(""),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export async function listUsersDirectory(context: PlatformContext, raw: Record<string, unknown>) {
  assertView(context);
  const query = userDirectorySchema.parse(raw);
  const contains = query.q ? { contains: query.q, mode: "insensitive" as const } : undefined;
  const activeSeat = { status: "ACTIVE" as const };
  const where: Prisma.UserWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(contains ? { OR: [{ firstName: contains }, { lastName: contains }, { username: contains }, { email: contains }, { memberships: { some: { company: { name: contains } } } }, { parentGroupMemberships: { some: { parentGroup: { name: contains } } } }] } : {}),
    ...(query.scope === "platform" ? { platformAccess: { is: activeSeat } } : {}),
    ...(query.scope === "group" ? { parentGroupMemberships: { some: activeSeat } } : {}),
    ...(query.scope === "company" ? { memberships: { some: activeSeat }, parentGroupMemberships: { none: activeSeat } } : {}),
    ...(query.scope === "none" ? { memberships: { none: activeSeat }, parentGroupMemberships: { none: activeSeat }, OR: [{ platformAccess: { is: null } }, { platformAccess: { is: { status: { not: "ACTIVE" } } } }] } : {}),
    ...(query.group ? { OR: [{ memberships: { some: { company: { parentGroupId: query.group } } } }, { parentGroupMemberships: { some: { parentGroupId: query.group } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * USER_PAGE_SIZE,
      take: USER_PAGE_SIZE,
      select: {
        id: true, firstName: true, lastName: true, username: true, email: true, status: true, lastLoginAt: true,
        platformAccess: { select: { status: true } },
        parentGroupMemberships: { where: activeSeat, take: 1, select: { parentGroup: { select: { name: true, kind: true } } } },
        memberships: { where: activeSeat, orderBy: { createdAt: "asc" }, take: 2, select: { role: { select: { name: true } }, company: { select: { name: true, parentGroup: { select: { name: true, kind: true } } } } } },
        _count: { select: { memberships: { where: activeSeat } } },
      },
    }),
  ]);
  return {
    query, total, pages: Math.max(1, Math.ceil(total / USER_PAGE_SIZE)),
    rows: rows.map((row) => {
      const platform = row.platformAccess?.status === "ACTIVE";
      const seat = row.parentGroupMemberships[0]?.parentGroup;
      const first = row.memberships[0];
      const organization = platform ? "NESTO Platform" : seat ? seat.name : first ? (first.company.parentGroup.kind === "GROUP" ? `${first.company.name} · ${first.company.parentGroup.name}` : first.company.name) : "—";
      return {
        id: row.id, name: `${row.firstName} ${row.lastName}`, username: row.username, email: row.email, status: row.status,
        lastActive: row.lastLoginAt?.toISOString() ?? null,
        organization,
        role: platform ? "Platform Admin" : first ? `${first.role.name}${row._count.memberships > 1 ? ` +${row._count.memberships - 1}` : ""}` : seat ? "Group level" : "—",
        scope: platform ? "Platform" : seat ? "Group" : first ? "Company" : "—",
      };
    }),
  };
}

export async function getPlatformUser(context: PlatformContext, userId: string) {
  assertView(context);
  const user = assertFound(await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, firstName: true, lastName: true, username: true, email: true, status: true, createdAt: true, lastLoginAt: true, passwordChangedAt: true, mustChangePassword: true,
      recoveryEmail: true, recoveryEmailVerifiedAt: true,
      platformAccess: { select: { roleKey: true, status: true } },
      personProfile: { select: { id: true, parentGroup: { select: { name: true, kind: true } } } },
      parentGroupMemberships: { select: { id: true, status: true, parentGroup: { select: { id: true, name: true, kind: true } } } },
      memberships: {
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        select: {
          id: true, status: true, jobTitle: true,
          role: { select: { name: true } }, department: { select: { name: true } },
          company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true, kind: true } } } },
          projectMemberships: { where: { status: "ACTIVE" }, select: { projectRole: true, project: { select: { id: true, name: true } } } },
        },
      },
    },
  }));
  return {
    id: user.id, name: `${user.firstName} ${user.lastName}`, username: user.username, email: user.email, status: user.status,
    createdAt: user.createdAt.toISOString(), lastLoginAt: user.lastLoginAt?.toISOString() ?? null, passwordChangedAt: user.passwordChangedAt.toISOString(), mustChangePassword: user.mustChangePassword,
    recoveryEmail: user.recoveryEmailVerifiedAt ? maskEmail(user.recoveryEmail) : null,
    platformAdmin: user.platformAccess?.status === "ACTIVE",
    employee: user.personProfile ? { id: user.personProfile.id, group: user.personProfile.parentGroup.kind === "GROUP" ? user.personProfile.parentGroup.name : null } : null,
    groups: user.parentGroupMemberships.filter((row) => row.parentGroup.kind === "GROUP").map((row) => ({ id: row.parentGroup.id, name: row.parentGroup.name, status: row.status })),
    memberships: user.memberships.map((row) => ({
      id: row.id, status: row.status, role: row.role.name, jobTitle: row.jobTitle, department: row.department?.name ?? null,
      company: { id: row.company.id, name: row.company.name }, group: row.company.parentGroup.kind === "GROUP" ? { id: row.company.parentGroup.id, name: row.company.parentGroup.name } : null,
      projects: row.projectMemberships.map((place) => ({ id: place.project.id, name: place.project.name, role: place.projectRole })),
    })),
  };
}

/** Grants beyond roles, live ones first (§15). */
export async function userGrants(context: PlatformContext, userId: string) {
  assertView(context);
  const rows = await prisma.accessGrant.findMany({ where: { userId }, orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 50, select: { id: true, functionKey: true, scopeType: true, accessLevel: true, expiresAt: true, revokedAt: true, parentGroup: { select: { name: true } } } });
  return rows.map((row) => ({ id: row.id, module: row.functionKey ? moduleLabel(row.functionKey) : "All modules", scope: row.scopeType, level: row.accessLevel, group: row.parentGroup.name, expiresAt: row.expiresAt?.toISOString() ?? null, active: !row.revokedAt && (!row.expiresAt || row.expiresAt > new Date()) }));
}

/** Live sessions with device and address; no token (§39). */
export async function userSessions(context: PlatformContext, userId: string) {
  if (!canPlatform(context, "platform.session.view")) throw new AccessError("FORBIDDEN");
  const now = new Date();
  const rows = await prisma.session.findMany({ where: { userId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 50, select: { id: true, createdAt: true, updatedAt: true, expiresAt: true, userAgent: true, ipAddress: true, company: { select: { name: true } } } });
  return rows.map((row) => ({ id: row.id, startedAt: row.createdAt.toISOString(), lastActive: row.updatedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), device: row.userAgent, ipAddress: row.ipAddress, workspace: row.company?.name ?? "Platform", active: row.expiresAt > now, current: row.id === context.sessionId }));
}

/** Account administration and sign-in history — never productivity data (§44, §69). */
export async function userActivity(context: PlatformContext, userId: string) {
  assertView(context);
  const [audit, auth] = await Promise.all([
    canPlatform(context, "platform.audit.view")
      ? prisma.auditEvent.findMany({ where: { entityType: "User", entityId: userId }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 30, select: { id: true, actionKey: true, actorDisplayNameSnapshot: true, reason: true, occurredAt: true } })
      : Promise.resolve([]),
    prisma.authEvent.findMany({ where: { userId, type: { in: ["LOGIN_SUCCESS", "LOGIN_FAILED", "LOGOUT", "PASSWORD_RESET_REQUEST", "PASSWORD_RESET_SUCCESS", "PASSWORD_CHANGED", "SESSIONS_REVOKED", "ACCOUNT_BLOCKED"] } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, type: true, createdAt: true, ipAddress: true } }),
  ]);
  return [
    ...audit.map((row) => ({ id: row.id, kind: "admin" as const, label: row.actionKey.replace(/^PLATFORM_/, "").toLowerCase().replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase()), by: row.actorDisplayNameSnapshot, detail: row.reason, at: row.occurredAt.toISOString() })),
    ...auth.map((row) => ({ id: row.id, kind: "sign-in" as const, label: row.type.toLowerCase().replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase()), by: null, detail: row.ipAddress, at: row.createdAt.toISOString() })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
}
