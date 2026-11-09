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

/**
 * The canonical area fields, square metres (E-05B §23). Never one generic `sqm`.
 * In the order the sums read (2026-11): internal + balcony + terrace is the net
 * area, and net + the common area allocation is the gross area.
 */
export const AREA_FIELDS = ["internalArea", "balconyArea", "terraceArea", "netArea", "commonAreaAllocation", "grossArea", "saleableArea", "outdoorArea", "gardenArea"] as const;
export type AreaField = (typeof AREA_FIELDS)[number];

/** The areas worked out on the server and never typed: the net area always, the gross area except for land. */
export const NET_AREA_PARTS = ["internalArea", "balconyArea", "terraceArea"] as const satisfies readonly AreaField[];

/** The areas a request may carry. The gross area is typed only for land; for every other unit it is the sum. */
export const ENTERED_AREA_FIELDS = AREA_FIELDS.filter((field): field is Exclude<AreaField, "netArea"> => field !== "netArea");
export type EnteredAreaField = (typeof ENTERED_AREA_FIELDS)[number];

export const AREA_LABELS: Record<AreaField, string> = {
  internalArea: "Internal area",
  balconyArea: "Balcony area",
  terraceArea: "Terrace area",
  netArea: "Net area",
  commonAreaAllocation: "Common area allocation",
  grossArea: "Gross area",
  saleableArea: "Saleable area",
  outdoorArea: "Outdoor area",
  gardenArea: "Garden area",
};

/**
 * The counts a unit carries, each chosen from a short list (2026-11): an
 * apartment has 0-3 bedrooms (0 is a studio), 1-3 bathrooms, and a storage
 * room or not. Rooms are no longer counted.
 */
export const COUNT_FIELDS = ["bedrooms", "bathrooms", "storage"] as const;
export type CountField = (typeof COUNT_FIELDS)[number];

export const COUNT_LABELS: Record<CountField, string> = { bedrooms: "Bedrooms", bathrooms: "Bathrooms", storage: "Storage" };

export const COUNT_CHOICES: Record<CountField, readonly number[]> = { bedrooms: [0, 1, 2, 3], bathrooms: [1, 2, 3], storage: [0, 1] };

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
  unitType: UnitTypeOption;
  building: { id: string; name: string; code: string | null };
  floor: { id: string; name: string; number: number | null; levelType: FloorLevelType };
  orientation: UnitOrientation | null;
  areas: Record<AreaField, string | null>;
  bedrooms: number | null;
  bathrooms: number | null;
  storage: number | null;
  attributes: UnitAttributes;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Where the unit stands in publishing (E-05D §13): Published (with its current version) or Archived — never its sales status. */
  publication: { status: UnitPublicationStatusKey; versionNumber: number | null };
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

/** A floor the building already has, as a range's preview shows it beside the floor the range would make. */
export type ExistingFloorMatch = { id: string; name: string; isActive: boolean; unitCount: number; version: number };

/**
 * Why a floor in a range cannot be written as sent. EXISTS: the building has
 * that floor and the batch says nothing about it. REPEATED: the batch names
 * the same floor twice. CHANGED: the batch keeps or updates a floor that has
 * since been changed, moved or removed — the preview is out of date.
 */
export type FloorBatchConflict = { index: number; value: string; reason: "EXISTS" | "REPEATED" | "CHANGED"; existing?: ExistingFloorMatch };

/**
 * A range of floors, previewed or written (E-05B §37-§39, §45). `matches` are
 * the entries the building already has, by index; `created` and `updated` the
 * floors a real run wrote. `count` is the entries sent on a preview and the
 * floors created on a real run.
 */
export type FloorBatchResult = { count: number; conflicts: FloorBatchConflict[]; matches: Array<{ index: number; floor: ExistingFloorMatch }>; created: string[]; updated: string[] };
