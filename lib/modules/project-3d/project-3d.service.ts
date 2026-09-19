import type { Prisma } from "@prisma/client";

import { AccessError, assertFound } from "@/lib/access/guards";
import type { PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { assertProject3DPlatformPermission } from "./project-3d.permissions";
import type { Project3DEntitlementUpdate } from "./project-3d.schema";

const EMPTY_EXPERIENCE = { schemaVersion: 1, revision: 1 } satisfies Prisma.InputJsonObject;

function entitlementSnapshot(value: {
  status: string;
  planKey: string | null;
  viewerEnabled: boolean;
  activatedAt: Date | null;
  expiresAt: Date | null;
}) {
  return {
    status: value.status,
    planKey: value.planKey,
    viewerEnabled: value.viewerEnabled,
    activatedAt: value.activatedAt?.toISOString() ?? null,
    expiresAt: value.expiresAt?.toISOString() ?? null,
  };
}

export async function listProject3DWorkspaces(context: PlatformContext) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const rows = await prisma.project.findMany({
    where: { company: { parentGroup: { isTestFixture: false } } },
    orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true } } } },
      project3DEntitlement: { select: { status: true, viewerEnabled: true, activatedAt: true, expiresAt: true } },
      project3DConfig: { select: { id: true, schemaVersion: true, activeReleaseId: true, updatedAt: true, _count: { select: { slots: true, releases: true } } } },
      _count: { select: { units: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    company: row.company,
    entitlement: row.project3DEntitlement
      ? { ...row.project3DEntitlement, activatedAt: row.project3DEntitlement.activatedAt?.toISOString() ?? null, expiresAt: row.project3DEntitlement.expiresAt?.toISOString() ?? null }
      : null,
    workspace: row.project3DConfig
      ? { id: row.project3DConfig.id, schemaVersion: row.project3DConfig.schemaVersion, activeReleaseId: row.project3DConfig.activeReleaseId, updatedAt: row.project3DConfig.updatedAt.toISOString(), slots: row.project3DConfig._count.slots, releases: row.project3DConfig._count.releases }
      : null,
    units: row._count.units,
  }));
}

export async function getProject3DWorkspace(context: PlatformContext, projectId: string) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const project = assertFound(await prisma.project.findFirst({
    where: { id: projectId, company: { parentGroup: { isTestFixture: false } } },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      companyId: true,
      company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true } } } },
      project3DEntitlement: true,
      project3DConfig: {
        include: {
          slots: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { versions: { where: { deletedAt: null }, orderBy: { version: "desc" } } } },
          releases: { orderBy: { releaseNumber: "desc" } },
        },
      },
      _count: { select: { units: true } },
    },
  }));
  return project;
}

export async function updateProject3DEntitlement(context: PlatformContext, projectId: string, input: Project3DEntitlementUpdate) {
  assertProject3DPlatformPermission(context, "platform.3d.configure");
  const project = assertFound(await prisma.project.findFirst({
    where: { id: projectId, company: { parentGroup: { isTestFixture: false } } },
    select: {
      id: true,
      name: true,
      companyId: true,
      company: { select: { parentGroupId: true } },
      project3DEntitlement: { select: { id: true, status: true, planKey: true, viewerEnabled: true, activatedAt: true, expiresAt: true } },
    },
  }));

  const activatedAt = input.status === "ACTIVE" ? input.activatedAt ?? project.project3DEntitlement?.activatedAt ?? new Date() : input.activatedAt ?? project.project3DEntitlement?.activatedAt ?? null;
  const after = {
    status: input.status,
    planKey: input.planKey?.trim() || null,
    viewerEnabled: input.viewerEnabled,
    activatedAt,
    expiresAt: input.expiresAt ?? null,
  };

  return prisma.$transaction(async (tx) => {
    const entitlement = await tx.project3DEntitlement.upsert({
      where: { projectId: project.id },
      update: after,
      create: { companyId: project.companyId, projectId: project.id, provisionedByUserId: context.userId, ...after },
    });
    await tx.project3DConfig.upsert({
      where: { projectId: project.id },
      update: { updatedByUserId: context.userId },
      create: { companyId: project.companyId, projectId: project.id, schemaVersion: 1, authoringDocument: EMPTY_EXPERIENCE, updatedByUserId: context.userId },
    });
    await recordPlatformAction(context, project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_ENTITLEMENT_CHANGED,
      entity: { type: "Project3DEntitlement", id: entitlement.id, label: project.name },
      projectId: project.id,
      before: project.project3DEntitlement ? { projectId: project.id, ...entitlementSnapshot(project.project3DEntitlement) } : null,
      after: { projectId: project.id, ...entitlementSnapshot(entitlement) },
      reason: input.reason,
    }, { tx });
    return entitlement;
  });
}

export async function requireProject3DWorkspace(context: PlatformContext, projectId: string) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const workspace = await prisma.project3DConfig.findFirst({ where: { projectId, project: { company: { parentGroup: { isTestFixture: false } } } } });
  if (!workspace) throw new AccessError("NOT_FOUND");
  return workspace;
}

