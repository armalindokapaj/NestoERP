import type { Prisma } from "@prisma/client";

import { AccessError, assertFound, invalidRecordLink, stateDenied } from "@/lib/access/guards";
import type { Project3DSceneNode } from "@/lib/3d/shared/contracts";
import type { PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { bindingChangeSummary, project3DAuditMetadata } from "./project-3d.audit";
import { assertProject3DPlatformPermission } from "./project-3d.permissions";
import type { Project3DUnitBindingsReplace } from "./project-3d.schema";
import { assertProject3DExperienceLive } from "./project-3d.lifecycle";

function sceneNodes(value: Prisma.JsonValue | null): Project3DSceneNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter((node): node is Project3DSceneNode => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    const candidate = node as Record<string, unknown>;
    return typeof candidate.nodeId === "string" && typeof candidate.name === "string";
  });
}

function stringList(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const bindingSelect = {
  id: true,
  meshName: true,
  projectUnitId: true,
  mappingStatus: true,
  poiYawDeg: true,
  poiEnabled: true,
  poiDistanceOverride: true,
  poiHeightOverride: true,
  mappedAt: true,
  projectUnit: {
    select: {
      id: true,
      unitCode: true,
      name: true,
      isActive: true,
      publicationStatus: true,
      floor: { select: { id: true, number: true, name: true, building: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.Project3DUnitMeshBindingSelect;

async function requireVersion(projectId: string, versionId: string) {
  return assertFound(await prisma.project3DModelVersion.findFirst({
    where: {
      id: versionId,
      projectId,
      deletedAt: null,
      project: { company: { parentGroup: { isTestFixture: false } } },
    },
    select: {
      id: true,
      projectId: true,
      companyId: true,
      status: true,
      sceneManifest: true,
      unitNodeNames: true,
      project: { select: { name: true, company: { select: { parentGroupId: true } } } },
    },
  }));
}

export async function getProject3DUnitBindingWorkspace(
  context: PlatformContext,
  projectId: string,
  versionId: string,
) {
  assertProject3DPlatformPermission(context, "platform.3d.view");
  const version = await requireVersion(projectId, versionId);
  const [units, bindings] = await Promise.all([
    prisma.projectUnit.findMany({
      where: { projectId, companyId: version.companyId, isActive: true },
      orderBy: [{ floor: { building: { sortOrder: "asc" } } }, { floor: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: {
        id: true,
        unitCode: true,
        name: true,
        publicationStatus: true,
        floor: { select: { id: true, number: true, name: true, building: { select: { id: true, name: true } } } },
      },
    }),
    prisma.project3DUnitMeshBinding.findMany({
      where: { modelVersionId: version.id, projectId, companyId: version.companyId },
      orderBy: { meshName: "asc" },
      select: bindingSelect,
    }),
  ]);

  const manifest = sceneNodes(version.sceneManifest);
  const manifestUnitNames = manifest.filter((node) => node.autoClassification === "unit_block").map((node) => node.name);
  const detectedNodes = Array.from(new Set([...stringList(version.unitNodeNames), ...manifestUnitNames])).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );

  return {
    version: { id: version.id, status: version.status },
    detectedNodes,
    sceneManifest: manifest,
    units,
    bindings,
  };
}

export async function replaceProject3DUnitBindings(
  context: PlatformContext,
  projectId: string,
  versionId: string,
  input: Project3DUnitBindingsReplace,
) {
  assertProject3DPlatformPermission(context, "platform.3d.binding.manage");
  await assertProject3DExperienceLive(prisma, projectId);
  const version = await requireVersion(projectId, versionId);
  if (!(["READY", "PUBLISHED"] as string[]).includes(version.status)) {
    throw stateDenied("Finish processing this model before linking units.", { code: "MODEL_NOT_READY" });
  }

  const meshNames = input.bindings.map((binding) => binding.meshName);
  const unitIds = input.bindings.map((binding) => binding.projectUnitId);
  if (new Set(meshNames).size !== meshNames.length) {
    throw new AccessError("VALIDATION_ERROR", "Each scene node can be linked once.", { bindings: ["Remove duplicate scene nodes."] });
  }
  if (new Set(unitIds).size !== unitIds.length) {
    throw new AccessError("VALIDATION_ERROR", "Each project unit can be linked once per model.", { bindings: ["Remove duplicate project units."] });
  }

  const allowedNames = new Set(sceneNodes(version.sceneManifest).map((node) => node.name));
  for (const meshName of meshNames) {
    if (!allowedNames.has(meshName)) {
      throw new AccessError("VALIDATION_ERROR", "Choose nodes from this model's scene manifest.", { meshName: [`${meshName} is not in this model.`] });
    }
  }

  const units = unitIds.length === 0
    ? []
    : await prisma.projectUnit.findMany({
        where: { id: { in: unitIds }, projectId, companyId: version.companyId, isActive: true },
        select: { id: true },
      });
  if (units.length !== unitIds.length) {
    throw invalidRecordLink("projectUnitId", "CROSS_PROJECT_REFERENCE", "Choose active units from this project.");
  }

  return prisma.$transaction(async (tx) => {
    const previous = await tx.project3DUnitMeshBinding.findMany({
      where: { modelVersionId: version.id, projectId, companyId: version.companyId },
      select: { meshName: true, projectUnitId: true },
    });
    const beforeCount = previous.length;
    const change = bindingChangeSummary(previous, input.bindings);
    await tx.project3DUnitMeshBinding.deleteMany({
      where: { modelVersionId: version.id, projectId, companyId: version.companyId },
    });
    if (input.bindings.length > 0) {
      await tx.project3DUnitMeshBinding.createMany({
        data: input.bindings.map((binding) => ({
          companyId: version.companyId,
          projectId,
          modelVersionId: version.id,
          projectUnitId: binding.projectUnitId,
          meshName: binding.meshName,
          mappingStatus: binding.mappingStatus,
          poiYawDeg: binding.poiYawDeg,
          poiEnabled: binding.poiEnabled,
          poiDistanceOverride: binding.poiDistanceOverride,
          poiHeightOverride: binding.poiHeightOverride,
          mappedByUserId: context.userId,
        })),
      });
    }
    await recordPlatformAction(context, version.project.company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_THREE_D_BINDING_CHANGED,
      entity: { type: "Project3DModelVersion", id: version.id, label: version.project.name },
      projectId,
      before: { projectId, versionId: version.id, bindingCount: beforeCount },
      after: { projectId, versionId: version.id, bindingCount: input.bindings.length },
      reason: input.reason,
      metadata: project3DAuditMetadata("UNIT_BINDINGS_UPDATED", change.summary, { created: change.created, updated: change.updated, removed: change.removed }),
    }, { tx });

    return tx.project3DUnitMeshBinding.findMany({
      where: { modelVersionId: version.id, projectId, companyId: version.companyId },
      orderBy: { meshName: "asc" },
      select: bindingSelect,
    });
  });
}
