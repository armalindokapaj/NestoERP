import type { ProjectPhaseStatus, UnitCommercialStatus } from "@prisma/client";

import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { project3DBootstrapSchema, type Project3DBootstrap } from "@/lib/3d/company/bootstrap.schema";
import { parseProject3DExperience } from "@/lib/3d/shared/experience";
import { project3DReleaseManifestSchema } from "@/lib/3d/shared/release.schema";
import type { UserContext } from "@/lib/context/types";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import { planningOpen } from "@/lib/modules/project-planning/planning.permissions";
import { isProject3DEntitlementActive } from "./project-3d.entitlement";
import { assertProject3DStorageKey } from "./project-3d.storage";

const VIEWER_ASSET_TTL_SECONDS = 5 * 60;

function canOpenProjects(context: UserContext): boolean {
  return isModuleEnabled(context, "projects")
    && canAccessModule(context, "projects")
    && can(context, "project.view");
}

type ViewerStageStatus = "done" | "active" | "upcoming";

function viewerStageStatus(status: ProjectPhaseStatus): ViewerStageStatus {
  if (status === "COMPLETED") return "done";
  if (status === "NOT_STARTED" || status === "CANCELLED") return "upcoming";
  return "active";
}

/**
 * The planning phases, read as the viewer's construction timeline. A phase
 * without its own progress counts as 100 when completed and 0 when not
 * started; the overall figure is the mean over phases that are not cancelled.
 */
export function constructionFromPhases(phases: Array<{
  id: string;
  name: string;
  sortOrder: number;
  status: ProjectPhaseStatus;
  progressPercent: { toNumber(): number } | null;
  plannedEndDate: Date | null;
  forecastEndDate: Date | null;
  actualEndDate: Date | null;
}>) {
  const stages = phases
    .filter((phase) => phase.status !== "CANCELLED")
    .map((phase, index) => {
      const status = viewerStageStatus(phase.status);
      const own = phase.progressPercent?.toNumber();
      const progressPercent = Math.max(0, Math.min(100, Math.round(own ?? (status === "done" ? 100 : 0))));
      const end = phase.actualEndDate ?? phase.forecastEndDate ?? phase.plannedEndDate;
      return {
        id: phase.id,
        name: phase.name,
        order: index + 1,
        status,
        progressPercent: status === "done" ? 100 : progressPercent,
        endDate: end ? end.toISOString() : null,
      };
    });
  const progressPercent = stages.length ? Math.round(stages.reduce((sum, stage) => sum + stage.progressPercent, 0) / stages.length) : 0;
  return { progressPercent, stages };
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
      project3DConfig: { select: { activeRelease: { select: { status: true } } } },
    },
  });
  return Boolean(project && isProject3DEntitlementActive(project.project3DEntitlement) && project.project3DConfig?.activeRelease?.status === "PUBLISHED");
}

/** Lightweight published-experience resolver used by Project navigation. */
export async function getProject3DAvailability(context: UserContext, projectId: string): Promise<{
  available: boolean;
  status: "PUBLISHED" | "UNAVAILABLE";
  experienceId: string | null;
  publishedVersionId: string | null;
  viewerUrl: string | null;
}> {
  assertModule(context, "projects");
  assertPermission(context, "project.view");
  const project = assertFound(await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId }] },
    select: {
      project3DEntitlement: true,
      project3DConfig: { select: { id: true, activeRelease: { select: { id: true, status: true } } } },
    },
  }));
  const available = Boolean(
    project
    && isProject3DEntitlementActive(project.project3DEntitlement)
    && project.project3DConfig?.activeRelease?.status === "PUBLISHED",
  );
  return {
    available,
    status: available ? "PUBLISHED" : "UNAVAILABLE",
    experienceId: available ? project!.project3DConfig!.id : null,
    publishedVersionId: available ? project!.project3DConfig!.activeRelease!.id : null,
    viewerUrl: available ? `/projects/${projectId}/3d` : null,
  };
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
      code: true,
      status: true,
      city: true,
      companyId: true,
      company: { select: { id: true, name: true, phone: true, email: true } },
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
  const unitDetails = can(context, "project.structure.view");
  const commercialVisible = can(context, "project.unit.sales.view");
  const filesVisible = canAccessModule(context, "documents") && can(context, "document.view");
  const unitRows = unitIds.length === 0 ? [] : await prisma.projectUnit.findMany({
    where: { id: { in: unitIds }, projectId: project.id, companyId: project.companyId },
    select: {
      id: true, unitCode: true, name: true, internalArea: true, saleableArea: true, rooms: true, bedrooms: true, bathrooms: true, orientation: true, salesPlanDocumentId: true,
      unitType: { select: { id: true, name: true, category: true } },
      floor: { select: { id: true, name: true, number: true, building: { select: { id: true, name: true, code: true } } } },
      commercialProfile: { select: { status: true } },
    },
  });
  if (unitRows.length !== unitIds.length) {
    throw new AccessError("CONFLICT", "The published 3D release is unavailable.", { code: "UNIT_REFERENCE_MISMATCH" });
  }

  const readableDocuments = filesVisible ? await buildDocumentAccessWhere(context) : null;
  const salesPlanIds = unitRows.map((unit) => unit.salesPlanDocumentId).filter((id): id is string => Boolean(id));
  const planVisible = planningOpen(context);
  const [commercialRows, salesPlanRows, mediaRows, phaseRows] = await Promise.all([
    commercialVisible && unitIds.length ? prisma.unitCommercialProfile.findMany({ where: { unitId: { in: unitIds }, projectId: project.id, companyId: project.companyId }, select: { unitId: true, askingPrice: true, currency: true } }) : [],
    readableDocuments && salesPlanIds.length ? prisma.document.findMany({ where: { AND: [readableDocuments, { id: { in: salesPlanIds }, companyId: project.companyId, status: "ACTIVE", storageStatus: "AVAILABLE" }] }, select: { id: true, name: true } }) : [],
    readableDocuments && unitIds.length ? prisma.unitMedia.findMany({
      where: { companyId: project.companyId, projectId: project.id, unitId: { in: unitIds }, document: { is: { AND: [readableDocuments, { status: "ACTIVE", storageStatus: "AVAILABLE" }] } } },
      orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, unitId: true, category: true, caption: true, isPrimary: true },
    }) : [],
    planVisible ? prisma.projectPhase.findMany({
      where: { companyId: project.companyId, projectId: project.id, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, sortOrder: true, status: true, progressPercent: true, plannedEndDate: true, forecastEndDate: true, actualEndDate: true },
    }) : [],
  ]);
  const commercialByUnit = new Map(commercialRows.map((row) => [row.unitId, row]));
  const salesPlans = new Map(salesPlanRows.map((row) => [row.id, row]));
  const mediaByUnit = new Map<string, typeof mediaRows>();
  for (const media of mediaRows) mediaByUnit.set(media.unitId, [...(mediaByUnit.get(media.unitId) ?? []), media]);

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
    project: { id: project.id, name: project.name, code: project.code, status: project.status, city: project.city, company: project.company },
    release: { id: release.id, number: release.releaseNumber, publishedAt: release.publishedAt.toISOString() },
    experience,
    models,
    units: unitRows.map((unit) => {
      const commercial = commercialByUnit.get(unit.id);
      const salesPlan = unit.salesPlanDocumentId ? salesPlans.get(unit.salesPlanDocumentId) : null;
      const pricePerSqm = commercial?.askingPrice && unit.saleableArea && unit.saleableArea.greaterThan(0) ? commercial.askingPrice.dividedBy(unit.saleableArea).toFixed(2) : null;
      return {
        id: unit.id,
        code: unit.unitCode,
        name: unitDetails ? unit.name : null,
        status: viewerUnitStatus(unit.commercialProfile?.status ?? null),
        building: unitDetails ? unit.floor.building : null,
        floor: unitDetails ? { id: unit.floor.id, name: unit.floor.name, number: unit.floor.number } : null,
        type: unitDetails ? unit.unitType : null,
        internalArea: unitDetails ? unit.internalArea?.toFixed(2) ?? null : null,
        saleableArea: unitDetails ? unit.saleableArea?.toFixed(2) ?? null : null,
        rooms: unitDetails ? unit.rooms : null,
        bedrooms: unitDetails ? unit.bedrooms : null,
        bathrooms: unitDetails ? unit.bathrooms : null,
        orientation: unitDetails ? unit.orientation : null,
        commercial: commercialVisible ? { askingPrice: commercial?.askingPrice?.toFixed(2) ?? null, currency: commercial?.currency ?? null, pricePerSqm } : null,
        salesPlan: salesPlan ? { documentId: salesPlan.id, name: salesPlan.name, href: `/documents/${salesPlan.id}` } : null,
        media: (mediaByUnit.get(unit.id) ?? []).slice(0, 6).map((media) => ({ id: media.id, category: media.category, caption: media.caption, isPrimary: media.isPrimary, thumbnailHref: `/api/project-units/${unit.id}/media/${media.id}/thumbnail` })),
      };
    }),
    construction: planVisible ? constructionFromPhases(phaseRows) : null,
    capabilities: {
      mapbox: Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN),
      unitDetails,
      commercial: commercialVisible,
      files: filesVisible,
    },
  });
}
