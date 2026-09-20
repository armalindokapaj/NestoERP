import type { UnitCommercialStatus } from "@prisma/client";

import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { project3DBootstrapSchema, type Project3DBootstrap } from "@/lib/3d/company/bootstrap.schema";
import { parseProject3DExperience } from "@/lib/3d/shared/experience";
import { project3DReleaseManifestSchema } from "@/lib/3d/shared/release.schema";
import type { UserContext } from "@/lib/context/types";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { isProject3DEntitlementActive } from "./project-3d.entitlement";
import { assertProject3DStorageKey } from "./project-3d.storage";

const VIEWER_ASSET_TTL_SECONDS = 5 * 60;

function canOpenProjects(context: UserContext): boolean {
  return isModuleEnabled(context, "projects")
    && canAccessModule(context, "projects")
    && can(context, "project.view");
}

function viewerUnitStatus(status: UnitCommercialStatus | null): "available" | "reserved" | "sold" {
  if (status === "SOLD") return "sold";
  if (status === "RESERVED" || status === "ON_HOLD") return "reserved";
  return "available";
}

/** Cheap navigation gate. It never signs assets or reads draft authoring data. */
export async function hasActiveProject3DViewer(context: UserContext, projectId: string): Promise<boolean> {
  if (!canOpenProjects(context)) return false;
  const project = await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId }] },
    select: {
      project3DEntitlement: true,
      project3DConfig: { select: { activeRelease: { select: { id: true, status: true } } } },
    },
  });
  return Boolean(
    project
    && isProject3DEntitlementActive(project.project3DEntitlement)
    && project.project3DConfig?.activeRelease?.status === "PUBLISHED",
  );
}

/**
 * Resolves the Company viewer from the one active immutable release.
 * Draft documents, source objects, processing diagnostics and storage keys are
 * deliberately absent from the returned browser contract.
 */
export async function getProject3DViewerBootstrap(
  context: UserContext,
  projectId: string,
): Promise<Project3DBootstrap> {
  assertModule(context, "projects");
  assertPermission(context, "project.view");

  const project = assertFound(await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId }] },
    select: {
      id: true,
      name: true,
      companyId: true,
      project3DEntitlement: true,
      project3DConfig: {
        select: {
          activeRelease: {
            select: {
              id: true,
              releaseNumber: true,
              status: true,
              publishedAt: true,
              manifest: true,
            },
          },
        },
      },
    },
  }));

  const release = project.project3DConfig?.activeRelease;
  if (!isProject3DEntitlementActive(project.project3DEntitlement) || !release || release.status !== "PUBLISHED") {
    throw new AccessError("NOT_FOUND");
  }

  const parsedManifest = project3DReleaseManifestSchema.safeParse(release.manifest);
  if (!parsedManifest.success) {
    throw new AccessError("CONFLICT", "The published 3D release is unavailable.", { code: "INVALID_RELEASE" });
  }
  const manifest = parsedManifest.data;
  if (
    manifest.projectId !== project.id
    || manifest.companyId !== project.companyId
    || manifest.releaseId !== release.id
    || manifest.releaseNumber !== release.releaseNumber
  ) {
    throw new AccessError("CONFLICT", "The published 3D release is unavailable.", { code: "RELEASE_SCOPE_MISMATCH" });
  }

  let experience;
  try {
    experience = parseProject3DExperience({ schemaVersion: 1, revision: 1, config: manifest.experience }).config;
  } catch {
    throw new AccessError("CONFLICT", "The published 3D release is unavailable.", { code: "INVALID_EXPERIENCE" });
  }

  const unitIds = [...new Set(manifest.models.flatMap((model) => model.unitBindings.map((binding) => binding.unitId)))];
  const unitRows = unitIds.length === 0 ? [] : await prisma.projectUnit.findMany({
    where: { id: { in: unitIds }, projectId: project.id, companyId: project.companyId },
    select: { id: true, unitCode: true, commercialProfile: { select: { status: true } } },
  });
  if (unitRows.length !== unitIds.length) {
    throw new AccessError("CONFLICT", "The published 3D release is unavailable.", { code: "UNIT_REFERENCE_MISMATCH" });
  }

  const provider = storageProvider();
  const models = await Promise.all(manifest.models.map(async (model) => {
    assertProject3DStorageKey(model.runtimeStorageKey, project.companyId, project.id, "runtime");
    const signed = await provider.createDownloadUrl({
      storageKey: model.runtimeStorageKey,
      expiresInSeconds: VIEWER_ASSET_TTL_SECONDS,
      disposition: "inline",
      fileName: model.runtimeFileName,
      contentType: "model/gltf-binary",
    });
    return {
      slotId: model.slotId,
      slotName: model.slotName,
      slotRole: model.slotRole,
      transformParentSlotId: model.transformParentSlotId,
      versionId: model.versionId,
      versionNumber: model.versionNumber,
      asset: {
        url: signed.url,
        expiresAt: signed.expiresAt.toISOString(),
        fileName: model.runtimeFileName,
        contentType: "model/gltf-binary" as const,
      },
      transform: model.transform,
      visible: model.visible,
      castShadow: model.castShadow,
      receiveShadow: model.receiveShadow,
      selectable: model.selectable,
      sceneManifest: model.sceneManifest,
      nodeOverrides: model.nodeOverrides,
      unitBindings: model.unitBindings,
    };
  }));

  return project3DBootstrapSchema.parse({
    schemaVersion: 1,
    project: { id: project.id, name: project.name },
    release: { id: release.id, number: release.releaseNumber, publishedAt: release.publishedAt.toISOString() },
    experience,
    models,
    units: unitRows.map((unit) => ({
      id: unit.id,
      code: unit.unitCode,
      status: viewerUnitStatus(unit.commercialProfile?.status ?? null),
    })),
    capabilities: {
      mapbox: Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN),
      unitDetails: can(context, "project.structure.view"),
    },
  });
}
