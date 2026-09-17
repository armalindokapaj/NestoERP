import type { UnitTypeCategory } from "@/config/unit-types";
import { AREA_FIELDS, AREA_LABELS, type AreaField, type UnitAttributes, type UnitOrientation, type UnitPosition } from "./structure.types";
import type { Readiness, ReadinessItem, UnitDisplay, UnitSnapshot } from "./unit-publishing.types";

/**
 * The publishing rules the unit page previews and the server enforces (E-05D
 * §11, §16, §17, §27-§30, §73). Pure and client-safe: the readiness panel and the
 * refusal of a publish can never disagree.
 */

/* Display (§10, §11) --------------------------------------------------------- */

const ALL_AREAS = AREA_FIELDS;

const DISPLAY: Record<UnitTypeCategory, UnitDisplay> = {
  RESIDENTIAL: { counts: ["rooms", "bedrooms", "bathrooms"], areas: ALL_AREAS, orientation: true, position: true },
  COMMERCIAL: { counts: ["rooms", "bathrooms"], areas: ["internalArea", "grossArea", "saleableArea", "outdoorArea", "commonAreaAllocation"], orientation: true, position: true },
  PARKING: { counts: [], areas: ["internalArea", "grossArea", "saleableArea"], orientation: false, position: true },
  STORAGE: { counts: [], areas: ["internalArea", "grossArea", "saleableArea"], orientation: false, position: true },
  LAND: { counts: [], areas: ["grossArea", "saleableArea", "outdoorArea", "gardenArea"], orientation: true, position: true },
  OTHER: { counts: ["rooms", "bedrooms", "bathrooms"], areas: ALL_AREAS, orientation: true, position: true },
};

export function unitDisplay(category: UnitTypeCategory): UnitDisplay {
  return DISPLAY[category];
}

/* Readiness (§16, §17, §45, §80) --------------------------------------------- */

/**
 * The area a kind of unit is published by (§16: "normally Saleable Area"). A
 * parking space or a store room is often measured only as internal or gross
 * area, so any of the three will do there; land by its saleable or gross area.
 */
const PRIMARY_AREAS: Record<UnitTypeCategory, readonly AreaField[]> = {
  RESIDENTIAL: ["saleableArea"],
  COMMERCIAL: ["saleableArea"],
  OTHER: ["saleableArea"],
  PARKING: ["saleableArea", "internalArea", "grossArea"],
  STORAGE: ["saleableArea", "internalArea", "grossArea"],
  LAND: ["saleableArea", "grossArea"],
};

/** "Saleable area", or "Saleable, internal or gross area" where any of several will do. */
export function primaryAreaLabel(category: UnitTypeCategory): string {
  const fields = PRIMARY_AREAS[category];
  if (fields.length === 1) return AREA_LABELS[fields[0]];
  const words = fields.map((field) => AREA_LABELS[field].replace(/ area$/, "").toLowerCase());
  const list = `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} area`;
}

export type ReadinessInput = {
  unitCode: string;
  unitType: { name: string; category: UnitTypeCategory } | null;
  building: { name: string } | null;
  floor: { name: string } | null;
  areas: Record<AreaField, string | null>;
  bedrooms: number | null;
  bathrooms: number | null;
  orientation: UnitOrientation | null;
  isActive: boolean;
  /** The unit's Sales Plan: whether it exists, and whether its current version is an available PDF. */
  salesPlan: { available: boolean } | null;
  /** The primary image: whether it exists, and whether its file is available. */
  primaryImage: { available: boolean } | null;
  /** Documents and images the unit points at that are archived or no longer available (§17). */
  unavailableReferences: number;
};

/**
 * What a unit needs before it can be submitted or published (§16, §17). Apartments
 * and other homes also need bedrooms, bathrooms and an orientation (§45, §80);
 * other kinds of unit are not held to fields they do not have.
 */
export function evaluateReadiness(input: ReadinessInput): Readiness {
  const category = input.unitType?.category ?? "OTHER";
  const items: ReadinessItem[] = [];
  const add = (key: ReadinessItem["key"], label: string, ok: boolean, hint: string) => items.push({ key, label, ok, hint: ok ? null : hint });

  add("unitCode", "Unit code", input.unitCode.trim().length > 0, "Give the unit a code.");
  add("unitType", "Unit type", input.unitType !== null, "Choose the unit type.");
  add("location", "Building and floor", input.building !== null && input.floor !== null, "Place the unit on a floor.");
  add("primaryArea", primaryAreaLabel(category), PRIMARY_AREAS[category].some((field) => input.areas[field] !== null), `Enter the ${primaryAreaLabel(category).toLowerCase()}.`);
  if (category === "RESIDENTIAL") {
    add("bedrooms", "Bedrooms", input.bedrooms !== null, "Enter the number of bedrooms (0 for a studio).");
    add("bathrooms", "Bathrooms", input.bathrooms !== null, "Enter the number of bathrooms.");
    add("orientation", "Orientation", input.orientation !== null, "Choose which way the unit faces.");
  }
  add(
    "salesPlan",
    "Sales Plan",
    input.salesPlan?.available === true,
    input.salesPlan ? "The Sales Plan is still being checked, or is not an available PDF." : "Upload the Sales Plan PDF.",
  );
  add(
    "primaryImage",
    "Primary image",
    input.primaryImage?.available === true,
    input.primaryImage ? "The primary image is still being checked or is no longer available." : "Add an image and mark it primary.",
  );
  add("active", "Unit is active", input.isActive, "Reactivate the unit.");
  add(
    "references",
    "Attached files available",
    input.unavailableReferences === 0,
    input.unavailableReferences === 1 ? "One attached file is archived or unavailable. Remove it from the unit." : `${input.unavailableReferences} attached files are archived or unavailable. Remove them from the unit.`,
  );

  const complete = items.filter((item) => item.ok).length;
  return { ready: complete === items.length, items, complete, required: items.length, missing: items.filter((item) => !item.ok).map((item) => item.label) };
}

/** The refusal a publish or a submission gives when something is missing (§46, §81). */
export function notReadyMessage(readiness: Readiness, action: "published" | "submitted"): string {
  return `This unit cannot be ${action}. Missing: ${readiness.missing.join(", ")}.`;
}

/* Snapshot and unpublished changes (§24, §27-§30, §73) ----------------------- */

export type LiveUnitFacts = {
  unitCode: string;
  name: string | null;
  unitType: { id: string; name: string; category: UnitTypeCategory };
  building: { id: string; name: string; code: string | null };
  floor: { id: string; name: string; number: number | null; levelType: UnitSnapshot["floor"]["levelType"] };
  position: UnitPosition | null;
  orientation: UnitOrientation | null;
  areas: Record<AreaField, string | null>;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  attributes: UnitAttributes;
  description: string | null;
  salesPlan: UnitSnapshot["salesPlan"];
  primaryImage: UnitSnapshot["primaryImage"];
};

/**
 * What a publication keeps (§73): the publish-relevant data and the exact file
 * versions, never audit metadata or anything internal (§30).
 */
export function buildSnapshot(facts: LiveUnitFacts): UnitSnapshot {
  return {
    unitCode: facts.unitCode,
    name: facts.name,
    unitType: { id: facts.unitType.id, name: facts.unitType.name, category: facts.unitType.category },
    building: { id: facts.building.id, name: facts.building.name, code: facts.building.code },
    floor: { id: facts.floor.id, name: facts.floor.name, number: facts.floor.number, levelType: facts.floor.levelType },
    position: facts.position,
    orientation: facts.orientation,
    areas: Object.fromEntries(AREA_FIELDS.map((field) => [field, facts.areas[field]])) as Record<AreaField, string | null>,
    rooms: facts.rooms,
    bedrooms: facts.bedrooms,
    bathrooms: facts.bathrooms,
    attributes: sortedAttributes(facts.attributes),
    description: facts.description,
    salesPlan: facts.salesPlan,
    primaryImage: facts.primaryImage,
  };
}

function sortedAttributes(attributes: UnitAttributes): UnitAttributes {
  return Object.fromEntries(Object.entries(attributes ?? {}).filter(([, value]) => value !== null && value !== undefined).sort(([a], [b]) => a.localeCompare(b))) as UnitAttributes;
}

/**
 * The publish-relevant identity of a unit's data (§29). Two snapshots with the
 * same fingerprint publish the same thing. Names of the building, floor and type
 * are left out: renaming Block A changes no unit's approved facts, while moving a
 * unit to another floor, changing its type or uploading a new Sales Plan version
 * does. So does a new primary image, or a new version of it.
 */
export function publishFingerprint(snapshot: UnitSnapshot): string {
  return JSON.stringify([
    snapshot.unitCode,
    snapshot.name,
    snapshot.unitType.id,
    snapshot.building.id,
    snapshot.floor.id,
    snapshot.position,
    snapshot.orientation,
    AREA_FIELDS.map((field) => normaliseArea(snapshot.areas[field])),
    snapshot.rooms,
    snapshot.bedrooms,
    snapshot.bathrooms,
    Object.entries(sortedAttributes(snapshot.attributes)),
    snapshot.description,
    snapshot.salesPlan?.documentVersionId ?? null,
    snapshot.primaryImage?.documentVersionId ?? null,
  ]);
}

function normaliseArea(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : Number(value).toFixed(2);
}

/**
 * Whether the live unit differs from its current publication (§27, §28). A unit
 * never published has nothing to differ from.
 */
export function hasUnpublishedChanges(live: LiveUnitFacts, published: UnitSnapshot | null): boolean {
  if (!published) return false;
  return publishFingerprint(buildSnapshot(live)) !== publishFingerprint(published);
}

export function isUnitImage(mimeType: string | null | undefined): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp";
}

export function isPdf(mimeType: string | null | undefined, extension: string | null | undefined): boolean {
  return mimeType === "application/pdf" || (extension ?? "").toLowerCase().replace(/^\./, "") === "pdf";
}
