import type { UnitTypeCategory } from "@/config/unit-types";

/**
 * The physical project: buildings, floors, units (E-05B §3). Client-safe —
 * constants, labels and the shapes the API answers with.
 */

export const FLOOR_LEVEL_TYPES = ["BASEMENT", "GROUND", "STANDARD", "MEZZANINE", "TECHNICAL", "ROOF", "OTHER"] as const;
export type FloorLevelType = (typeof FLOOR_LEVEL_TYPES)[number];

export const FLOOR_LEVEL_LABELS: Record<FloorLevelType, string> = {
  BASEMENT: "Basement",
  GROUND: "Ground",
  STANDARD: "Standard",
  MEZZANINE: "Mezzanine",
  TECHNICAL: "Technical",
  ROOF: "Roof",
  OTHER: "Other",
};

export const UNIT_ORIENTATIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "MULTI", "UNKNOWN"] as const;
export type UnitOrientation = (typeof UNIT_ORIENTATIONS)[number];

export const ORIENTATION_LABELS: Record<UnitOrientation, string> = {
  N: "North",
  NE: "North-east",
  E: "East",
  SE: "South-east",
  S: "South",
  SW: "South-west",
  W: "West",
  NW: "North-west",
  MULTI: "Several",
  UNKNOWN: "Unknown",
};

export const UNIT_POSITIONS = ["FRONT", "REAR", "CORNER", "INTERNAL", "LEFT", "RIGHT", "CENTER", "OTHER"] as const;
export type UnitPosition = (typeof UNIT_POSITIONS)[number];

export const POSITION_LABELS: Record<UnitPosition, string> = {
  FRONT: "Front",
  REAR: "Rear",
  CORNER: "Corner",
  INTERNAL: "Internal",
  LEFT: "Left",
  RIGHT: "Right",
  CENTER: "Centre",
  OTHER: "Other",
};

/** The canonical area fields, square metres (E-05B §23). Never one generic `sqm`. */
export const AREA_FIELDS = ["internalArea", "grossArea", "saleableArea", "outdoorArea", "balconyArea", "terraceArea", "gardenArea", "commonAreaAllocation"] as const;
export type AreaField = (typeof AREA_FIELDS)[number];

export const AREA_LABELS: Record<AreaField, string> = {
  internalArea: "Internal area",
  grossArea: "Gross area",
  saleableArea: "Saleable area",
  outdoorArea: "Outdoor area",
  balconyArea: "Balcony area",
  terraceArea: "Terrace area",
  gardenArea: "Garden area",
  commonAreaAllocation: "Common area allocation",
};

export const COUNT_FIELDS = ["rooms", "bedrooms", "bathrooms"] as const;
export type CountField = (typeof COUNT_FIELDS)[number];

export const COUNT_LABELS: Record<CountField, string> = { rooms: "Rooms", bedrooms: "Bedrooms", bathrooms: "Bathrooms" };

/**
 * The type-specific details with no column of their own (E-05B §22, §71). A
 * fixed list, validated on the server; a category shows only its own.
 */
export const UNIT_ATTRIBUTES = {
  covered: { label: "Covered", kind: "boolean", categories: ["PARKING"] },
  evReady: { label: "EV ready", kind: "boolean", categories: ["PARKING"] },
  frontage: { label: "Frontage (m)", kind: "metres", categories: ["COMMERCIAL"] },
  ceilingHeight: { label: "Ceiling height (m)", kind: "metres", categories: ["COMMERCIAL", "STORAGE"] },
} as const satisfies Record<string, { label: string; kind: "boolean" | "metres"; categories: readonly UnitTypeCategory[] }>;
export type UnitAttributeKey = keyof typeof UNIT_ATTRIBUTES;
export type UnitAttributes = Partial<{ covered: boolean; evReady: boolean; frontage: string; ceilingHeight: string }>;

export const UNIT_PAGE_SIZE = 50;
export const MAX_BULK_FLOORS = 200;
/** Above this, a bulk floor batch asks to be confirmed (E-05B §39). */
export const CONFIRM_FLOORS_ABOVE = 50;
export const MAX_BULK_UNITS = 500;

export const UNIT_SORTS = ["structure", "code", "-code", "floor", "type", "saleableArea", "-saleableArea", "internalArea", "-internalArea"] as const;
export type UnitSort = (typeof UNIT_SORTS)[number];

export const UNIT_SORT_LABELS: Record<UnitSort, string> = {
  structure: "Building, floor and order",
  code: "Unit code A–Z",
  "-code": "Unit code Z–A",
  floor: "Floor",
  type: "Type",
  saleableArea: "Saleable area, smallest first",
  "-saleableArea": "Saleable area, largest first",
  internalArea: "Internal area, smallest first",
  "-internalArea": "Internal area, largest first",
};

export type StructureCapabilities = {
  canManageStructure: boolean;
  canCreateBuilding: boolean;
  canUpdateBuilding: boolean;
  canDeleteBuilding: boolean;
  canCreateFloor: boolean;
  canUpdateFloor: boolean;
  canDeleteFloor: boolean;
  canCreateUnit: boolean;
  canUpdateUnit: boolean;
  canDeleteUnit: boolean;
  canMoveUnit: boolean;
};

export type UnitTypeOption = { id: string; name: string; code: string; category: UnitTypeCategory; isActive: boolean };

export type FloorNodeDTO = {
  id: string;
  buildingId: string;
  number: number | null;
  name: string;
  levelType: FloorLevelType;
  sortOrder: number;
  elevation: string | null;
  description: string | null;
  isActive: boolean;
  version: number;
  unitCount: number;
};

export type BuildingNodeDTO = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
  floorCount: number;
  unitCount: number;
  floors: FloorNodeDTO[];
};

/** The tree: buildings, floors and counts — never the units themselves (E-05B §65, §108). */
export type ProjectStructureDTO = {
  project: { id: string; name: string; code: string; companyId: string };
  totals: { buildings: number; floors: number; units: number };
  buildings: BuildingNodeDTO[];
  unitTypes: UnitTypeOption[];
  capabilities: StructureCapabilities;
};

export type UnitDTO = {
  id: string;
  projectId: string;
  unitCode: string;
  name: string | null;
  unitType: UnitTypeOption;
  building: { id: string; name: string; code: string | null };
  floor: { id: string; name: string; number: number | null; levelType: FloorLevelType };
  position: UnitPosition | null;
  orientation: UnitOrientation | null;
  areas: Record<AreaField, string | null>;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  attributes: UnitAttributes;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Where the unit stands in publishing (E-05D §13, §28): never its sales status. */
  publication: { status: UnitPublicationStatusKey; versionNumber: number | null; hasUnpublishedChanges: boolean };
  /** Whether it is for sale, reserved or sold (E-05E §7, §33) — the status only; prices and clients need Sales' grant. */
  commercialStatus: UnitCommercialStatusKey;
};

export type UnitListDTO = {
  items: UnitDTO[];
  page: number;
  pageSize: number;
  total: number;
};

export type UnitDetailDTO = UnitDTO & {
  project: { id: string; name: string; code: string };
  capabilities: Pick<StructureCapabilities, "canUpdateUnit" | "canDeleteUnit" | "canMoveUnit">;
};

/** The publication states, repeated here so this file stays free of the publishing module (E-05D §13). */
export type UnitPublicationStatusKey = "DRAFT" | "READY_FOR_PUBLISHING" | "PUBLISHED" | "REVISION_REQUIRED" | "ARCHIVED";

/** The commercial states, repeated here so this file stays free of the Sales module (E-05E §7). */
export type UnitCommercialStatusKey = "NOT_FOR_SALE" | "FOR_SALE" | "ON_HOLD" | "RESERVED" | "SOLD";

/** A proposed batch, checked against the project before anything is written (E-05B §44). */
export type BatchConflict = { index: number; value: string; reason: "EXISTS" | "REPEATED" };
export type BatchPreview = { count: number; conflicts: BatchConflict[] };
