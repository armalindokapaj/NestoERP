import type { UnitCommercialStatusKey } from "@/lib/modules/project-structure/structure.types";

/**
 * A project's Units linked to a Google Sheet (2026-11-10). Client-safe: the
 * shapes the API answers with and the codes a skipped row or value carries,
 * so the Units tab can word them in its reader's language.
 *
 * Values travel as canonical strings, never floats: an area "64.72", a count
 * "2", an orientation key "NE", a unit type's id, a price "130000.00". The
 * page formats them as it formats every other area, count and price.
 */

/** What the sheet can set on a unit. `price` is the asking price, read from the Total price or the Price per m² column. */
export const SHEET_FIELDS = [
  "type",
  "orientation",
  "internalArea",
  "balconyArea",
  "terraceArea",
  "commonAreaAllocation",
  "grossArea",
  "saleableArea",
  "outdoorArea",
  "gardenArea",
  "bedrooms",
  "bathrooms",
  "storage",
  "price",
] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];

/** The technical fields: everything but the price, which belongs to Sales. */
export type SheetStructureField = Exclude<SheetField, "price">;

/**
 * Why a row, or one value of a row, was left out. Row level: the row says
 * nothing NESTO can act on. Field level (`field` set): the rest of the row
 * still counts. Apply level: the change was confirmed but its unit's own
 * service refused it, or the unit changed after the preview.
 */
export const SHEET_SKIP_REASONS = [
  // Rows
  "no_code",
  "invalid_code",
  "ambiguous_code",
  "duplicate_row",
  "building_mismatch",
  "archived",
  // New units
  "missing_building",
  "unknown_building",
  "ambiguous_building",
  "missing_floor",
  "unknown_floor",
  "missing_type",
  "unknown_type",
  "retired_type",
  "code_taken",
  "not_allowed_create",
  // Values
  "invalid_value",
  "price_inconsistent",
  "no_area",
  "price_not_allowed",
  "sold",
  // Confirming
  "changed",
  "not_allowed",
  "not_found",
  "not_sellable",
  "invalid",
  "failed",
] as const;
export type SheetSkipReason = (typeof SHEET_SKIP_REASONS)[number];

/** A row or value left out, and why. `row` is the sheet's own row number (the header is row 1); `value` the cell as read. */
export type SheetSkipDTO = {
  row: number | null;
  code: string | null;
  unitId: string | null;
  label: string | null;
  field: SheetField | null;
  reason: SheetSkipReason;
  /** The same in English, for logs and for a reason the page has no words for. */
  message: string;
  value: string | null;
};

/** How a new price is put: the total itself, or a price per m² of the unit's sale area (saleable when typed, else gross). */
export type SheetPriceDTO = {
  entry: "TOTAL" | "PER_SQM";
  /** The total that will be saved; null clears the price. */
  total: string | null;
  /** The price per m² the sheet gave, for PER_SQM; else the total's rate on `area`, when there is one. */
  rate: string | null;
  /** The sale area the rate is on, as it will be after this sync's area changes. */
  area: string | null;
};

export type SheetLinkDTO = {
  spreadsheetId: string;
  gid: string | null;
  /** The link as it was pasted; only for a reader who may change or remove it. */
  url: string | null;
  title: string | null;
  linkedAt: string;
  linkedBy: { memberId: string; name: string | null };
  lastSyncedAt: string | null;
  lastSyncedBy: { memberId: string; name: string | null } | null;
  /** What a sync is confirmed against (`linkVersion`). */
  version: number;
};

export type SheetCapabilitiesDTO = {
  /** Link, change the link, unlink, sync: `project.unit.update`. */
  canLink: boolean;
  canSync: boolean;
  /** Download for Google Sheets: anyone who can open the Units tab. */
  canDownload: boolean;
  /** Prices from the sheet: Sales' price grant (sales view + `project.unit.price.manage`). */
  canManagePrice: boolean;
  /** New units from the sheet: `project.unit.create`. */
  canCreateUnit: boolean;
  /** "Also put newly priced units on sale": Sales' status grant. */
  canPutOnSale: boolean;
};

export type SheetStatusDTO = { link: SheetLinkDTO | null; capabilities: SheetCapabilitiesDTO };

/** A column of the sheet: its letter, its header as written, the field it was read as (null: not one NESTO knows). */
export type SheetColumnDTO = { column: string; header: string; key: string | null; readOnly: boolean };

/** What reading the sheet found, before anything is compared. */
export type SheetCheckDTO = {
  title: string | null;
  /** Rows with something in them, the header aside. */
  rows: number;
  columns: SheetColumnDTO[];
  unknownColumns: Array<{ column: string; header: string }>;
  /** Whether the sheet has the Unit column a sync matches rows by. */
  hasCodeColumn: boolean;
  /** Whether Google gave typed values (numbers as numbers); false when only the CSV export could be read. */
  typed: boolean;
};

export type SheetLinkResultDTO = { link: SheetLinkDTO | null; check: SheetCheckDTO };

type UnitRef = { unitId: string; label: string; row: number; currency: string | null };
/** The versions a confirm sends back for a unit, so a unit changed after the preview is skipped rather than overwritten. */
type Versioned = { version: number; salesVersion: number };

export type SheetChangeDTO = { id: string; field: SheetField; from: string | null; to: string | null; price: SheetPriceDTO | null };
export type SheetClashDTO = { id: string; field: SheetField; sheet: string | null; nesto: string | null; price: SheetPriceDTO | null };
export type SheetNewerDTO = { field: SheetField; sheet: string | null; nesto: string | null };

export type SheetPreviewDTO = {
  link: SheetLinkDTO;
  /** Send both back to confirm: a sheet that changed since, or a sync confirmed by somebody else since, refuses the confirm. */
  linkVersion: number;
  sheetHash: string;
  readAt: string;
  sheet: SheetCheckDTO;
  /** No sync has been confirmed yet: every difference is offered as a change from the sheet. */
  firstSync: boolean;
  counts: {
    changes: number;
    changedUnits: number;
    clashes: number;
    newUnits: number;
    newerInNesto: number;
    skipped: number;
    notInSheet: number;
    unchangedUnits: number;
  };
  changes: Array<UnitRef & Versioned & { status: UnitCommercialStatusKey; fields: SheetChangeDTO[] }>;
  clashes: Array<UnitRef & Versioned & { status: UnitCommercialStatusKey; fields: SheetClashDTO[] }>;
  newUnits: Array<{
    id: string;
    row: number;
    code: string;
    label: string;
    building: { id: string; name: string };
    floor: { id: string; name: string };
    type: { id: string; name: string };
    fields: Array<{ field: SheetField; value: string | null }>;
    price: SheetPriceDTO | null;
  }>;
  newerInNesto: Array<UnitRef & { fields: SheetNewerDTO[] }>;
  skipped: SheetSkipDTO[];
  notInSheet: Array<{ unitId: string; label: string }>;
  unknownColumns: Array<{ column: string; header: string }>;
  /** The company's unit types, to name a `type` value. */
  unitTypes: Array<{ id: string; name: string; code: string }>;
  putOnSale: { allowed: boolean; candidates: number };
  capabilities: SheetCapabilitiesDTO;
};

export type SheetApplyResultDTO = {
  applied: {
    units: Array<{ unitId: string; label: string; fields: SheetField[] }>;
    newUnits: Array<{ unitId: string; label: string; row: number }>;
  };
  skipped: SheetSkipDTO[];
  putOnSale: { moved: Array<{ unitId: string; label: string }>; skipped: SheetSkipDTO[] };
  link: SheetLinkDTO;
};
