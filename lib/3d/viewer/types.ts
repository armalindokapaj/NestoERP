/**
 * The Project viewer's browser types (the Rozaris marketplace viewer, ported).
 *
 * The runtime's own types (camera presets, sections, lighting…) are NESTO's
 * copies in lib/3d/runtime; this file adds the marketplace-shaped Project and
 * Unit the viewer's panels read. They are filled from the Company bootstrap by
 * bootstrap-adapter.ts, never from marketplace data.
 */
import type { Unit as RuntimeUnit } from "@/lib/3d/runtime/types";

export type {
  CameraPreset,
  DetailModelSlotRole,
  LightingConfig,
  Project3DConfig,
  ProjectDetailModel,
  QualityPreset,
  RenderingConfig,
  Section,
} from "@/lib/3d/runtime/types";

export type Locale = "en" | "sq";

/** The display currency the viewer's settings switch between (Rozaris: EUR/ALL). */
export type Currency = "EUR" | "ALL";

export type PropertyType = "apartment" | "house" | "villa" | "studio" | "land" | "commercial" | "office";

export type ProjectStatus = "coming_soon" | "under_construction" | "completed";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Publisher {
  id: string;
  slug: string;
  name: string;
  type: "private_owner" | "agency" | "developer";
  verified: boolean;
  /** Empty when the company has no phone on record; the contact buttons then hide. */
  phone: string;
  whatsapp: string;
}

export interface ConstructionStage {
  id: string;
  name: string;
  order: number;
  status: "done" | "active" | "upcoming";
  progressPercent: number;
  dateLabel: string;
}

export interface ConstructionTimelineDraft {
  progressPercent: number;
  stages: ConstructionStage[];
}

export type UnitOrientation = "N" | "E" | "S" | "W";

export const UNIT_ORIENTATIONS: readonly UnitOrientation[] = ["N", "E", "S", "W"];

export interface Unit extends RuntimeUnit {
  id: string;
  code: string;
  type: "residential" | "commercial" | "parking" | "storage";
  buildingName: string;
  floor: number;
  area: number;
  bedrooms: number;
  bathrooms: number;
  /**
   * Asking price in `currency`. Null when the reader may not see commercial
   * data (project.unit.sales.view) or no price is set: the viewer then shows
   * "Price on request" and leaves the unit out of price filters and sorts.
   */
  price: number | null;
  currency: string;
  transaction: "sale";
  status: "available" | "reserved" | "sold";
  images: string[];
  floorPlanImage: string;
  facadeImage?: string;
  videoUrl?: string;
  orientation?: UnitOrientation;
  /** NESTO: the compound orientation (NE, SW…) Rozaris' four points cannot name. */
  orientationCode?: string;
  /** NESTO: the canonical unit record, when the reader may open it. */
  href: string | null;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  developer: Publisher;
  status: ProjectStatus;
  progressPercent: number;
  coords: GeoPoint | null;
  city: string;
  propertyType: PropertyType;
  availableUnits: number;
  totalUnits: number;
  buildings: string[];
  completionLabel: string;
  units: Unit[];
  constructionStages: ConstructionStage[];
  /** NESTO: whether prices may be shown at all (project.unit.sales.view). */
  commercialVisible: boolean;
  /** NESTO: where Back returns to. */
  backHref: string;
}
