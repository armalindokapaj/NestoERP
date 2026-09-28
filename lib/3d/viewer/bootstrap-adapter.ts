import type { Project3DBootstrap } from "@/lib/3d/company/bootstrap.schema";
import type { Public3DBootstrap } from "@/lib/3d/public/public-manifest";
import type { DetailModelSlotRole, Project3DConfig, ProjectDetailModel } from "@/lib/3d/runtime/types";
import type { ProjectViewerRuntimeBootstrap } from "@/lib/3d/viewer/runtimeTypes";
import {
  UNIT_ORIENTATIONS,
  type ConstructionStage,
  type Project,
  type ProjectStatus,
  type PropertyType,
  type Unit,
  type UnitOrientation,
} from "@/lib/3d/viewer/types";

/**
 * Company bootstrap → the shape the ported Rozaris viewer reads.
 *
 * Pure and browser-safe. It never widens what the server sent: a field the
 * bootstrap withheld from this reader (commercial data without
 * project.unit.sales.view, structure without project.structure.view, the plan
 * without project_planning.view) stays absent here too — a hidden price is
 * `null`, which the viewer prints as "Price on request".
 */

export interface ProjectDetailModelSlotEntry {
  slotId: string;
  slotName: string;
  slotRole: DetailModelSlotRole;
  transformParentSlotId: string | null;
  model: ProjectDetailModel;
}

type BootstrapUnit = Project3DBootstrap["units"][number];

function modelForRuntime(model: Project3DBootstrap["models"][number], publishedAt: string): ProjectDetailModel {
  return {
    glbUrl: model.asset.url,
    fileName: model.asset.fileName,
    fileSize: 0,
    ...model.transform,
    enabled: true,
    visible: model.visible,
    castShadow: model.castShadow,
    receiveShadow: model.receiveShadow,
    selectable: model.selectable,
    transformLocked: true,
    updatedAt: publishedAt,
    unitLinks: model.unitBindings,
    sceneManifest: model.sceneManifest.map((node) => ({
      nodeId: node.nodeId,
      name: node.name,
      meshIndex: node.meshIndex,
      parentNodeId: node.parentNodeId,
      depth: node.depth,
      isMesh: node.isMesh,
      autoClassification: node.autoClassification,
    })),
    nodeOverrides: model.nodeOverrides.map(({ nodeId, ...override }) => ({ ...override, nodeId })),
    triangleCount: null,
    meshCount: null,
    materialCount: null,
    textureCount: null,
  };
}

/** The published experience, with the map-backed site off when this deployment has no Mapbox token. */
export function viewerConfigFromBootstrap(bootstrap: Project3DBootstrap): Project3DConfig {
  const authored = bootstrap.experience as unknown as Project3DConfig;
  return bootstrap.capabilities.mapbox ? authored : { ...authored, mapViewEnabled: false, siteEnabled: false };
}

function toNumber(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unitType(category: string | undefined): Unit["type"] {
  switch (category) {
    case "COMMERCIAL":
      return "commercial";
    case "PARKING":
      return "parking";
    case "STORAGE":
      return "storage";
    default:
      return "residential";
  }
}

function orientation(code: string | null): { orientation?: UnitOrientation; orientationCode?: string } {
  if (!code || code === "UNKNOWN") return {};
  if (UNIT_ORIENTATIONS.includes(code as UnitOrientation)) return { orientation: code as UnitOrientation };
  return { orientationCode: code === "MULTI" ? "Multi" : code };
}

export function unitFromBootstrap(unit: BootstrapUnit, projectId: string, unitDetails: boolean): Unit {
  const commercialPrice = unit.commercial ? toNumber(unit.commercial.askingPrice) : null;
  const floorPlan = unit.media.find((media) => media.category === "FLOOR_PLAN_IMAGE");
  const facade = unit.media.find((media) => media.category === "EXTERIOR_RENDER");
  const photos = unit.media.filter((media) => media !== floorPlan && media !== facade).map((media) => media.thumbnailHref);
  return {
    id: unit.id,
    code: unit.code,
    type: unitType(unit.type?.category),
    buildingName: unit.building?.name ?? "",
    floor: unit.floor?.number ?? 0,
    area: toNumber(unit.saleableArea) ?? toNumber(unit.internalArea) ?? 0,
    bedrooms: unit.bedrooms ?? 0,
    bathrooms: unit.bathrooms ?? 0,
    price: commercialPrice,
    currency: unit.commercial?.currency ?? "EUR",
    transaction: "sale",
    status: unit.status,
    images: photos,
    floorPlanImage: floorPlan?.thumbnailHref ?? "",
    facadeImage: facade?.thumbnailHref,
    ...orientation(unit.orientation),
    href: unitDetails ? `/projects/${projectId}/units/${unit.id}` : null,
  };
}

function projectStatus(status: Project3DBootstrap["project"]["status"]): ProjectStatus {
  if (status === "PENDING") return "coming_soon";
  if (status === "ACTIVE") return "under_construction";
  return "completed";
}

/** Rozaris labels stages and completion by quarter ("Q3 2026"). */
export function quarterLabel(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
}

function propertyType(units: Unit[]): PropertyType {
  const commercial = units.filter((unit) => unit.type === "commercial").length;
  return commercial > units.length / 2 ? "commercial" : "apartment";
}

export function adaptProjectViewerBootstrap(bootstrap: Project3DBootstrap): ProjectViewerRuntimeBootstrap {
  const viewerConfig = viewerConfigFromBootstrap(bootstrap);
  const units = bootstrap.units.map((unit) => unitFromBootstrap(unit, bootstrap.project.id, bootstrap.capabilities.unitDetails));
  const stages: ConstructionStage[] = (bootstrap.construction?.stages ?? []).map((stage) => ({
    id: stage.id,
    name: stage.name,
    order: stage.order,
    status: stage.status,
    progressPercent: stage.progressPercent,
    dateLabel: quarterLabel(stage.endDate),
  }));
  const progressPercent = bootstrap.construction?.progressPercent ?? 0;
  const lastStageEnd = bootstrap.construction?.stages.at(-1)?.endDate ?? null;
  const company = bootstrap.project.company;
  const phone = company.phone?.trim() ?? "";
  const latitude = viewerConfig.mapViewLatitude;
  const longitude = viewerConfig.mapViewLongitude;

  const project: Project = {
    id: bootstrap.project.id,
    slug: bootstrap.project.code,
    name: bootstrap.project.name,
    developer: {
      id: company.id,
      slug: company.id,
      name: company.name,
      type: "developer",
      verified: false,
      phone,
      whatsapp: phone,
    },
    status: projectStatus(bootstrap.project.status),
    progressPercent,
    coords: latitude != null && longitude != null ? { lat: latitude, lng: longitude } : null,
    city: bootstrap.project.city ?? "",
    propertyType: propertyType(units),
    availableUnits: units.filter((unit) => unit.status === "available").length,
    totalUnits: units.length,
    buildings: [...new Set(units.map((unit) => unit.buildingName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    completionLabel: quarterLabel(lastStageEnd),
    units,
    constructionStages: stages,
    commercialVisible: bootstrap.capabilities.commercial,
    backHref: `/projects/${bootstrap.project.id}`,
  };

  const detailModels: ProjectDetailModelSlotEntry[] = bootstrap.models.map((entry) => ({
    slotId: entry.slotId,
    slotName: entry.slotName,
    slotRole: entry.slotRole.toLocaleLowerCase() as DetailModelSlotRole,
    transformParentSlotId: entry.transformParentSlotId,
    model: modelForRuntime(entry, bootstrap.release.publishedAt),
  }));

  return {
    project,
    construction: { progressPercent, stages },
    detailModels,
    viewerConfig,
    units,
  };
}

/**
 * Public bootstrap → the same runtime shape (ADM-04A §7). Everything the
 * public projection withheld stays neutral here: no developer contact, no
 * prices, no unit pages, no map, no construction timeline. Unit ids are the
 * release-local refs (u1…), never canonical ids.
 */
export function adaptPublicViewerBootstrap(bootstrap: Public3DBootstrap, publicId: string): ProjectViewerRuntimeBootstrap {
  const viewerConfig = bootstrap.experience as unknown as Project3DConfig;
  const units: Unit[] = bootstrap.units.map((unit) => ({
    id: unit.ref,
    code: unit.label,
    type: unit.type ?? "residential",
    buildingName: "",
    floor: unit.floor ?? 0,
    area: unit.area ?? 0,
    bedrooms: 0,
    bathrooms: 0,
    price: null,
    currency: "EUR",
    transaction: "sale",
    // Without the availability field every unit reads alike; status colours are off in that case.
    status: unit.status ?? "available",
    images: [],
    floorPlanImage: "",
    href: null,
  }));
  const project: Project = {
    id: publicId,
    slug: publicId,
    name: bootstrap.title,
    developer: { id: "public", slug: "public", name: "", type: "developer", verified: false, phone: "", whatsapp: "" },
    status: "under_construction",
    progressPercent: 0,
    coords: null,
    city: bootstrap.city ?? "",
    propertyType: propertyType(units),
    availableUnits: units.filter((unit) => unit.status === "available").length,
    totalUnits: units.length,
    buildings: [],
    completionLabel: "—",
    units,
    constructionStages: [],
    commercialVisible: false,
    backHref: "/",
  };
  const detailModels: ProjectDetailModelSlotEntry[] = bootstrap.models.map((model) => ({
    slotId: model.assetId,
    slotName: model.assetId,
    slotRole: model.role.toLocaleLowerCase() as DetailModelSlotRole,
    transformParentSlotId: model.parentAssetId,
    model: {
      glbUrl: model.assetUrl,
      fileName: `${model.assetId}.glb`,
      fileSize: 0,
      ...model.transform,
      enabled: true,
      visible: model.visible,
      castShadow: model.castShadow,
      receiveShadow: model.receiveShadow,
      selectable: model.selectable,
      transformLocked: true,
      updatedAt: new Date(0).toISOString(),
      unitLinks: model.unitBindings.map((binding) => ({ meshName: binding.meshName, unitId: binding.unitRef, unitCode: binding.unitRef, poiYawDeg: binding.poiYawDeg, poiEnabled: binding.poiEnabled, poiDistanceOverride: binding.poiDistanceOverride, poiHeightOverride: binding.poiHeightOverride })),
      sceneManifest: model.sceneManifest,
      nodeOverrides: model.nodeOverrides,
      triangleCount: null,
      meshCount: null,
      materialCount: null,
      textureCount: null,
    },
  }));
  return { project, construction: { progressPercent: 0, stages: [] }, detailModels, viewerConfig, units };
}
