import { assignedCompanyId } from "@/lib/access/project-ownership";
import type { Prisma, ProjectPhaseStatus, UnitCommercialStatus } from "@prisma/client";

import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { project3DBootstrapSchema, type Project3DBootstrap } from "@/lib/3d/company/bootstrap.schema";
import { parseProject3DExperience } from "@/lib/3d/shared/experience";
import { companyEnvironmentBase, platformEnvironmentBase, resolveEnvironmentRefs } from "@/lib/3d/shared/environment-refs";
import { project3DReleaseManifestSchema } from "@/lib/3d/shared/release.schema";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import { planningOpen } from "@/lib/modules/project-planning/planning.permissions";
import { isProject3DEntitlementActive } from "./project-3d.entitlement";
import { project3DViewerToken, signProject3DAssetHandle } from "./project-3d.delivery";
import { assertProject3DStorageKey } from "./project-3d.storage";

/**
 * How long the browser treats a bootstrap as fresh. Handles do not expire on
 * their own — the accessEpoch and each request's checks revoke them — but the
 * viewer still refreshes its bootstrap on this cadence.
 */
const VIEWER_HANDLE_NOMINAL_SECONDS = 60 * 60;

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

/**
 * Signed-in company viewing is open when the experience is live and its
 * audience is Company login only — or Public, which never closes the internal
 * route to those it was already open to (ADM-04A §3). Offline and deleted
 * experiences are closed to everyone here.
 */
function companyAudience(config: { deletedAt: Date | null; visibility: string } | null | undefined): boolean {
  return Boolean(config && !config.deletedAt && (config.visibility === "COMPANY_ONLY" || config.visibility === "PUBLIC" || config.visibility === "PRIVATE"));
}

/**
 * Private (Admin Projects & 3D PRD #5 §50): beyond everything Company users
 * need, the person must be assigned to the project itself. Seeing the project
 * through a company-wide scope is not enough.
 */
async function privateAudienceAllows(context: UserContext, projectId: string, visibility: string | undefined): Promise<boolean> {
  if (visibility !== "PRIVATE") return true;
  return (await prisma.projectMember.count({ where: { projectId, companyId: context.companyId, companyMemberId: context.membershipId, status: "ACTIVE" } })) > 0;
}

/** Cheap navigation gate. It never signs assets or reads draft authoring data. */
export async function hasActiveProject3DViewer(context: UserContext, projectId: string): Promise<boolean> {
  if (!canOpenProjects(context)) return false;
  const project = await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId }] },
    select: {
      project3DEntitlement: true,
      project3DConfig: { select: { deletedAt: true, visibility: true, activeRelease: { select: { status: true } } } },
    },
  });
  return Boolean(project && isProject3DEntitlementActive(project.project3DEntitlement) && companyAudience(project.project3DConfig) && project.project3DConfig?.activeRelease?.status === "PUBLISHED" && await privateAudienceAllows(context, projectId, project.project3DConfig?.visibility));
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
      project3DConfig: { select: { id: true, deletedAt: true, visibility: true, activeRelease: { select: { id: true, status: true } } } },
    },
  }));
  const available = Boolean(
    project
    && isProject3DEntitlementActive(project.project3DEntitlement)
    && companyAudience(project.project3DConfig)
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
  const filesVisible = canAccessModule(context, "documents") && can(context, "document.view");
  return buildViewerBootstrap({ AND: [buildProjectScopeWhere(context), { id: projectId }] }, {
    audience: "company",
    unitDetails: can(context, "project.structure.view"),
    commercialVisible: can(context, "project.unit.sales.view"),
    readableDocuments: filesVisible ? () => buildDocumentAccessWhere(context) : null,
    planVisible: planningOpen(context),
    assetUrl: (id, handle) => `/api/projects/${encodeURIComponent(id)}/3d/assets/${handle}`,
  });
}

/**
 * Platform Admin's look at the Company viewer: the same published release a
 * company reader gets, with every unit fact shown and no company login.
 * Document links are left out — they open company pages a platform session
 * cannot reach. Test fixtures stay hidden, as in every Platform 3D view.
 */
export async function getProject3DPlatformViewerBootstrap(
  context: PlatformContext,
  projectId: string,
): Promise<Project3DBootstrap> {
  if (!canPlatform(context, "platform.3d.view")) throw new AccessError("FORBIDDEN");
  return buildViewerBootstrap({ id: projectId, company: { parentGroup: { isTestFixture: false } } }, {
    audience: "platform",
    unitDetails: true,
    commercialVisible: true,
    readableDocuments: null,
    planVisible: true,
    assetUrl: (id, handle) => `/api/platform/3d/projects/${encodeURIComponent(id)}/viewer/assets/${handle}`,
  });
}

type ViewerReader = {
  audience: "company" | "platform";
  unitDetails: boolean;
  commercialVisible: boolean;
  readableDocuments: (() => Promise<Prisma.DocumentWhereInput>) | null;
  planVisible: boolean;
  assetUrl: (projectId: string, handle: string) => string;
};

async function buildViewerBootstrap(where: Prisma.ProjectWhereInput, reader: ViewerReader): Promise<Project3DBootstrap> {
  const project = assertFound(await prisma.project.findFirst({
    where,
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
          id: true,
          accessEpoch: true,
          deletedAt: true,
          visibility: true,
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
  if (!isProject3DEntitlementActive(project.project3DEntitlement) || !companyAudience(project.project3DConfig) || !release || release.status !== "PUBLISHED") {
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
    // Stored backdrop photos and IES profiles are read through this audience's own route.
    experience = resolveEnvironmentRefs(experience, reader.audience === "platform" ? platformEnvironmentBase(project.id) : companyEnvironmentBase(project.id));
  } catch {
    throw new AccessError("CONFLICT", "The published 3D release is unavailable.", { code: "INVALID_EXPERIENCE" });
  }

  const unitIds = [...new Set(manifest.models.flatMap((model) => model.unitBindings.map((binding) => binding.unitId)))];
  const { unitDetails, commercialVisible, planVisible } = reader;
  const filesVisible = reader.readableDocuments !== null;
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

  const readableDocuments = reader.readableDocuments ? await reader.readableDocuments() : null;
  const salesPlanIds = unitRows.map((unit) => unit.salesPlanDocumentId).filter((id): id is string => Boolean(id));
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

  // Gated handles, never storage URLs (ADM-04A §8): each request re-checks this
  // reader's access, and any audience or release decision revokes them.
  const config = project.project3DConfig!;
  const handleValidUntil = new Date(Date.now() + VIEWER_HANDLE_NOMINAL_SECONDS * 1000).toISOString();
  const models = manifest.models.map((model) => {
    assertProject3DStorageKey(model.runtimeStorageKey, assignedCompanyId(project), project.id, "runtime");
    const handle = signProject3DAssetHandle({ c: config.id, r: release.id, a: model.versionId, au: reader.audience, e: config.accessEpoch });
    return {
      slotId: model.slotId,
      slotName: model.slotName,
      slotRole: model.slotRole,
      transformParentSlotId: model.transformParentSlotId,
      versionId: model.versionId,
      versionNumber: model.versionNumber,
      asset: {
        url: reader.assetUrl(project.id, handle),
        expiresAt: handleValidUntil,
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
  });

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

/**
 * The open company viewer's poll (ADM-04A §8): whether this reader may still
 * view, and a token that changes when the release or any grant changes — never
 * the epoch itself. Unavailable is an answer, not an error, so the viewer can
 * clear its scene.
 */
export async function getProject3DViewerStatus(context: UserContext, projectId: string): Promise<{ available: boolean; token: string | null }> {
  if (!await hasActiveProject3DViewer(context, projectId)) return { available: false, token: null };
  const config = await prisma.project3DConfig.findFirst({ where: { projectId, deletedAt: null }, select: { activeReleaseId: true, accessEpoch: true } });
  if (!config) return { available: false, token: null };
  return { available: true, token: project3DViewerToken(config.activeReleaseId, config.accessEpoch) };
}

/** The Platform viewer's poll: the same token a company reader gets, without the company checks. */
export async function getProject3DPlatformViewerStatus(context: PlatformContext, projectId: string): Promise<{ available: boolean; token: string | null }> {
  if (!canPlatform(context, "platform.3d.view")) return { available: false, token: null };
  const config = await prisma.project3DConfig.findFirst({
    where: { projectId, deletedAt: null, project: { company: { parentGroup: { isTestFixture: false } } } },
    select: { activeReleaseId: true, accessEpoch: true, activeRelease: { select: { status: true } } },
  });
  if (!config || config.activeRelease?.status !== "PUBLISHED") return { available: false, token: null };
  return { available: true, token: project3DViewerToken(config.activeReleaseId, config.accessEpoch) };
}
