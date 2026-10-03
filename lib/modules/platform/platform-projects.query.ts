import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { AccessError, assertFound } from "@/lib/access/guards";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { ENTITLABLE_MODULES, entitledModulesFor, moduleLabel } from "@/lib/core/entitlements/entitlement.resolver";
import { prisma } from "@/lib/database/prisma";
import { ownershipOf, withCompany } from "@/lib/access/project-ownership";
import { threeDState } from "@/lib/modules/platform/platform-dashboard.query";

/**
 * Platform Admin project administration (Admin Projects & 3D PRD #5 §5-§17).
 * Always the canonical Project: its 3D experience hangs off it, never a copy.
 * Filtering, counting and paging happen in the database (§99).
 */

function assertView(context: PlatformContext) {
  if (!canPlatform(context, "platform.project.view")) throw new AccessError("FORBIDDEN");
}

export const PROJECT_PAGE_SIZE = 25;
export const projectDirectorySchema = z.object({
  q: z.string().trim().max(120).catch(""),
  company: z.string().trim().max(128).catch(""),
  group: z.string().trim().max(128).catch(""),
  /** Ownership is its own filter, apart from the construction status (Standalone Project PRD §9, §10). */
  ownership: z.enum(["", "assigned", "unassigned"]).catch(""),
  status: z.enum(["", "PENDING", "ACTIVE", "FINISHED", "ARCHIVED"]).catch(""),
  three: z.enum(["", "configured", "none", "PUBLIC", "COMPANY_ONLY", "PRIVATE", "OFFLINE"]).catch(""),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export async function listProjectsDirectory(context: PlatformContext, raw: Record<string, unknown>) {
  assertView(context);
  const query = projectDirectorySchema.parse(raw);
  const contains = query.q ? { contains: query.q, mode: "insensitive" as const } : undefined;
  const liveConfig = { deletedAt: null };
  const ownedBy: Prisma.ProjectWhereInput = { company: { parentGroup: { isTestFixture: false, ...(query.group ? { id: query.group } : {}) }, ...(query.company ? { id: query.company } : {}) } };
  // A company or group filter can only match an assigned project; otherwise an
  // unassigned one is listed beside the assigned ones (§10, §43).
  const ownership: Prisma.ProjectWhereInput =
    query.ownership === "unassigned" ? { companyId: null }
    : query.ownership === "assigned" || query.company || query.group ? ownedBy
    : { OR: [{ companyId: null }, ownedBy] };
  const where: Prisma.ProjectWhereInput = {
    AND: [
      ownership,
      ...(contains ? [{ OR: [{ name: contains }, { code: contains }, { company: { name: contains } }, { company: { parentGroup: { name: contains, kind: "GROUP" as const } } }] }] : []),
      query.status === "ARCHIVED" ? { OR: [{ archivedAt: { not: null } }, { status: "ARCHIVED" as const }] } : query.status ? { status: query.status, archivedAt: null } : {},
      query.three === "configured" ? { project3DConfig: { is: liveConfig } } : query.three === "none" ? { OR: [{ project3DConfig: { is: null } }, { project3DConfig: { is: { deletedAt: { not: null } } } }] } : query.three ? { project3DConfig: { is: { ...liveConfig, visibility: query.three } } } : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * PROJECT_PAGE_SIZE,
      take: PROJECT_PAGE_SIZE,
      select: {
        id: true, code: true, name: true, status: true, archivedAt: true, updatedAt: true, companyId: true,
        company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true, kind: true } } } },
        project3DConfig: { select: { visibility: true, deletedAt: true } },
      },
    }),
  ]);
  const entitled = await entitledModulesFor([...new Set(rows.flatMap((row) => (row.company ? [row.company.id] : [])))]);
  return {
    query, total, pages: Math.max(1, Math.ceil(total / PROJECT_PAGE_SIZE)),
    rows: rows.map((row) => ({
      id: row.id, code: row.code, name: row.name,
      status: row.archivedAt ? "ARCHIVED" : row.status,
      ownership: ownershipOf(row),
      company: row.company ? { id: row.company.id, name: row.company.name } : null,
      group: row.company && row.company.parentGroup.kind === "GROUP" ? { id: row.company.parentGroup.id, name: row.company.parentGroup.name } : null,
      modules: row.company ? [...(entitled.get(row.company.id) ?? [])].filter((key) => ENTITLABLE_MODULES.includes(key)).length : null,
      threeD: threeDState(row.project3DConfig),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

/** Companies a project can be created for: active ones only (§10). */
export async function projectCompanyOptions(context: PlatformContext) {
  assertView(context);
  const rows = await prisma.company.findMany({
    where: { status: "ACTIVE", parentGroup: { isTestFixture: false } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, parentGroup: { select: { name: true, kind: true } } },
  });
  return rows.map((row) => ({ value: row.id, label: row.parentGroup.kind === "GROUP" ? `${row.name} · ${row.parentGroup.name}` : row.name }));
}

/** One project's Platform Admin page, per tab (§12-§17). */
export async function getPlatformProjectDetail(context: PlatformContext, projectId: string) {
  assertView(context);
  const row = assertFound(await prisma.project.findFirst({
    where: { id: projectId, OR: [{ companyId: null }, { company: { parentGroup: { isTestFixture: false } } }] },
    select: {
      id: true, code: true, name: true, description: true, status: true, archivedAt: true, createdAt: true, updatedAt: true, companyId: true, assignedAt: true,
      company: { select: { id: true, name: true, status: true, parentGroup: { select: { id: true, name: true, kind: true } } } },
      projectManager: { select: { user: { select: { firstName: true, lastName: true } } } },
      project3DEntitlement: { select: { status: true, viewerEnabled: true, expiresAt: true } },
      project3DConfig: {
        select: {
          visibility: true, deletedAt: true, activeReleaseId: true, updatedAt: true, experienceName: true,
          slots: { where: { isActive: true }, select: { versions: { where: { deletedAt: null }, orderBy: { version: "desc" }, take: 1, select: { originalFileName: true, status: true, version: true, _count: { select: { unitBindings: true } } } } } },
        },
      },
      _count: { select: { members: { where: { status: "ACTIVE" } }, units: true } },
    },
  }));
  return {
    id: row.id, code: row.code, name: row.name, description: row.description,
    status: row.archivedAt ? "ARCHIVED" : row.status, archived: Boolean(row.archivedAt),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    ownership: ownershipOf(row),
    assignedAt: row.assignedAt?.toISOString() ?? null,
    company: row.company ? { id: row.company.id, name: row.company.name, status: row.company.status } : null,
    group: row.company && row.company.parentGroup.kind === "GROUP" ? { id: row.company.parentGroup.id, name: row.company.parentGroup.name } : null,
    manager: row.projectManager ? `${row.projectManager.user.firstName} ${row.projectManager.user.lastName}` : null,
    members: row._count.members,
    units: row._count.units,
    threeD: {
      state: threeDState(row.project3DConfig),
      configured: Boolean(row.project3DConfig && !row.project3DConfig.deletedAt),
      published: Boolean(row.project3DConfig?.activeReleaseId),
      entitlement: row.project3DEntitlement ? { status: row.project3DEntitlement.status, viewerEnabled: row.project3DEntitlement.viewerEnabled, expiresAt: row.project3DEntitlement.expiresAt?.toISOString() ?? null } : null,
      models: (row.project3DConfig?.slots ?? []).flatMap((slot) => slot.versions).map((version) => ({ fileName: version.originalFileName, status: version.status, version: version.version, bindings: version._count.unitBindings })),
    },
  };
}

export async function projectUsers(context: PlatformContext, projectId: string) {
  assertView(context);
  const rows = await prisma.projectMember.findMany({
    where: { projectId, project: { company: { parentGroup: { isTestFixture: false } } } },
    orderBy: [{ status: "asc" }, { member: { user: { lastName: "asc" } } }, { id: "asc" }],
    select: { id: true, status: true, projectRole: true, isPrimary: true, member: { select: { user: { select: { firstName: true, lastName: true, username: true, status: true } }, role: { select: { name: true } } } } },
  });
  return rows.map((row) => ({ id: row.id, name: `${row.member.user.firstName} ${row.member.user.lastName}`, username: row.member.user.username, role: row.projectRole ?? row.member.role.name, primary: row.isPrimary, status: row.member.user.status !== "ACTIVE" ? row.member.user.status : row.status }));
}

/** The company's effective entitlements, read from the canonical resolver (§16). */
export async function projectModules(context: PlatformContext, companyId: string) {
  assertView(context);
  const entitled = (await entitledModulesFor([companyId])).get(companyId) ?? new Set();
  return ENTITLABLE_MODULES.map((key) => ({ key, name: moduleLabel(key), enabled: entitled.has(key) }));
}

/**
 * Canonical projects that could be given a 3D experience and have none
 * (Admin Projects & 3D PRD #5 §21): live, of an active company. No placeholder
 * experience is created to list them.
 */
export async function unconfiguredProjects(context: PlatformContext, q: string) {
  assertView(context);
  const contains = q ? { contains: q, mode: "insensitive" as const } : undefined;
  const rows = await prisma.project.findMany({
    where: {
      archivedAt: null,
      project3DConfig: { is: null },
      company: { status: "ACTIVE", parentGroup: { isTestFixture: false } },
      ...(contains ? { OR: [{ name: contains }, { code: contains }, { company: { name: contains } }] } : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 200,
    select: { id: true, code: true, name: true, status: true, company: { select: { id: true, name: true } }, project3DEntitlement: { select: { status: true } }, _count: { select: { units: true } } },
  });
  return withCompany(rows).map((row) => ({ id: row.id, code: row.code, name: row.name, status: row.status, company: row.company, units: row._count.units, entitled: row.project3DEntitlement?.status === "ACTIVE" }));
}
