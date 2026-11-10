import { createHash } from "node:crypto";

import { Prisma, type UnitOrientation } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { withAuditSource } from "@/lib/core/audit/audit-source";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { prisma } from "@/lib/database/prisma";
import type { Locale } from "@/lib/i18n/config";
import { moduleMessages } from "@/lib/i18n/modules";
import { floorName, unitTypeName } from "@/lib/i18n/stock-names";
import { readableUnitWhere, structureOpen } from "@/lib/modules/project-structure/structure.permissions";
import { unitLabel } from "@/lib/modules/project-structure/structure.rules";
import { createUnitSchema, updateUnitSchema, type UnitListQuery } from "@/lib/modules/project-structure/structure.schema";
import { listProjectUnitIds, loadStructureProject, type StructureProject } from "@/lib/modules/project-structure/structure.service";
import { createUnit, updateUnit } from "@/lib/modules/project-structure/structure.units";
import { BULK_CONCURRENCY, skipReasonOf } from "@/lib/modules/project-structure/unit-bulk.service";
import type { BulkSkipReason } from "@/lib/modules/project-structure/unit-bulk.rules";
import { bulkAskingPrice, saleArea, saleRate } from "@/lib/modules/sales/units/unit-pricing.rules";
import { salesCapabilities } from "@/lib/modules/sales/units/unit-sales.core";
import { listSalesUnitIds } from "@/lib/modules/sales/units/unit-sales.inventory";
import { saleStatusOf, salesExpectedVersion, sellability } from "@/lib/modules/sales/units/unit-sales.rules";
import type { InventoryQuery } from "@/lib/modules/sales/units/unit-sales.schema";
import { changeSaleStatus, updateCommercialDetails } from "@/lib/modules/sales/units/unit-sales.service";
import { IGNORED_COLUMNS, SHEET_COLUMNS, SHEET_HEADERS, type SheetColumn, WORKED_OUT_COLUMNS } from "./unit-sheet.columns";
import { changeId, diffSheet, type DiffUnit, type MatchedUnit, newUnitBaseline, nextBaseline, type NewUnitPlan, planUnits, sheetSkip, type SheetDiff, toPriceDTO, type UnitBaseline, type UnitPlan } from "./unit-sheet.diff";
import { readGoogleSheet, SheetReadError, type Fetcher } from "./unit-sheet.fetch";
import { exportFilename, sheetFilename } from "./unit-sheet.files";
import { parseSheetLink, type LinkProblem, type SheetRef } from "./unit-sheet.link";
import { SHEET_LIMITS, type SheetGrid } from "./unit-sheet.parse";
import type { SheetApplyInput, SheetLinkInput } from "./unit-sheet.schema";
import type { SheetApplyResultDTO, SheetCapabilitiesDTO, SheetCheckDTO, SheetField, SheetLinkDTO, SheetLinkResultDTO, SheetPreviewDTO, SheetSkipDTO, SheetSkipReason, SheetStatusDTO, SheetStructureField } from "./unit-sheet.types";
import { buildXlsx, type XlsxCell, type XlsxColumn } from "./unit-sheet.xlsx";
import { orientationName } from "./unit-sheet.values";

/**
 * A project's Units linked to a Google Sheet (2026-11-10).
 *
 * Linking, unlinking and syncing ask what editing a unit asks
 * (`project.unit.update`), through the project's door (E-05B §78-§82): a
 * project the reader cannot open is not found. Prices from the sheet ask
 * Sales' price grant as well, new units `project.unit.create`; without them
 * those rows are left out and say why. The download asks only to open the
 * Units tab.
 *
 * A sync reads the sheet and shows what would change; nothing changes until
 * the person confirms. Confirming reads the sheet again — a sheet changed in
 * between, or a sync somebody else confirmed in between, refuses the confirm
 * — and each unit is then changed by the service its own page uses, in its
 * own transaction, checked against the version the preview saw: `updateUnit`
 * for the technical fields (only the fields touched), `createUnit` for a new
 * unit (published on create), Sales' `updateCommercialDetails` and
 * `changeSaleStatus` for a price and "Also put newly priced units on sale".
 * Each of those writes its own audit event, and runs under the source
 * "GOOGLE_SHEET_SYNC", which every one of them records.
 */

export const SHEET_AUDIT_SOURCE = "GOOGLE_SHEET_SYNC";
/** What a price saved from the sheet records as its reason, in the price history. */
export const SHEET_PRICE_REASON = "Google Sheet sync";

type Deps = { fetcher?: Fetcher };

const LINK_MESSAGES: Record<LinkProblem, string> = {
  NOT_A_LINK: "Paste the sheet's link from Google Sheets: Share → Copy link.",
  NOT_GOOGLE_SHEETS: "That is not a Google Sheets link. Paste a link that starts with https://docs.google.com/spreadsheets/d/.",
  PUBLISHED_LINK: "That is a 'Publish to the web' link. Paste the sheet's own link instead: Share → Copy link.",
};

const READ_CODES = { NOT_SHARED: "SHEET_NOT_SHARED", NOT_FOUND: "SHEET_NOT_FOUND", UNAVAILABLE: "SHEET_UNAVAILABLE", TOO_LARGE: "SHEET_TOO_LARGE", UNREADABLE: "SHEET_UNREADABLE" } as const;

function notLinked(): AccessError {
  return new AccessError("NOT_FOUND", "No Google Sheet is linked to this project's units.", { code: "SHEET_NOT_LINKED" });
}

/* Who may do what ----------------------------------------------------------- */

export function sheetCapabilities(context: UserContext): SheetCapabilitiesDTO {
  const open = structureOpen(context);
  const sales = salesCapabilities(context);
  const edit = open && can(context, "project.unit.update");
  return {
    canLink: edit,
    canSync: edit,
    canDownload: open,
    canManagePrice: sales.canManagePrice,
    canCreateUnit: open && can(context, "project.unit.create"),
    canPutOnSale: sales.canManageStatus,
  };
}

/**
 * Whether the download carries prices: exactly when the Units table shows
 * them, which is to everyone who can open it (2026-11, the user's decision;
 * `toUnitDTO`). Kept as its own rule so the two cannot drift apart unnoticed.
 */
function unitPricesVisible(context: UserContext): boolean {
  return structureOpen(context);
}

/* The link -------------------------------------------------------------------- */

const LINK_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  spreadsheetId: true,
  sheetGid: true,
  sourceUrl: true,
  title: true,
  linkedByMemberId: true,
  linkedAt: true,
  lastSyncedByMemberId: true,
  lastSyncedAt: true,
  version: true,
} satisfies Prisma.ProjectUnitSheetLinkSelect;
type LinkRow = Prisma.ProjectUnitSheetLinkGetPayload<{ select: typeof LINK_SELECT }>;

async function findLink(context: UserContext, project: StructureProject): Promise<LinkRow | null> {
  return prisma.projectUnitSheetLink.findFirst({ where: { companyId: context.companyId, projectId: project.id }, select: LINK_SELECT });
}

async function memberNames(companyId: string, ids: Array<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { companyId, id: { in: wanted } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, `${row.user.firstName} ${row.user.lastName}`.trim()]));
}

async function linkDTO(context: UserContext, link: LinkRow): Promise<SheetLinkDTO> {
  const names = await memberNames(context.companyId, [link.linkedByMemberId, link.lastSyncedByMemberId]);
  return {
    spreadsheetId: link.spreadsheetId,
    gid: link.sheetGid,
    url: sheetCapabilities(context).canLink ? link.sourceUrl : null,
    title: link.title,
    linkedAt: link.linkedAt.toISOString(),
    linkedBy: { memberId: link.linkedByMemberId, name: names.get(link.linkedByMemberId) ?? null },
    lastSyncedAt: link.lastSyncedAt?.toISOString() ?? null,
    lastSyncedBy: link.lastSyncedByMemberId ? { memberId: link.lastSyncedByMemberId, name: names.get(link.lastSyncedByMemberId) ?? null } : null,
    version: link.version,
  };
}

/** Whether the project's Units are linked to a sheet, and what the reader may do about it. */
export async function getSheetStatus(context: UserContext, projectId: string): Promise<SheetStatusDTO> {
  const project = await loadStructureProject(context, projectId);
  const link = await findLink(context, project);
  return { link: link ? await linkDTO(context, link) : null, capabilities: sheetCapabilities(context) };
}

/* Reading ---------------------------------------------------------------------- */

function readFailure(error: unknown, field?: "url"): never {
  if (error instanceof SheetReadError) {
    const status = error.problem === "UNAVAILABLE" ? "TEMPORARILY_UNAVAILABLE" : "VALIDATION_ERROR";
    throw new AccessError(status, error.message, { code: READ_CODES[error.problem], ...(field ? { field } : {}) });
  }
  throw error;
}

async function readSheet(ref: SheetRef, deps: Deps, field?: "url"): Promise<{ grid: SheetGrid; title: string | null; hash: string }> {
  try {
    const read = await readGoogleSheet(ref, { fetcher: deps.fetcher });
    return { ...read, hash: gridHash(read.grid) };
  } catch (error) {
    return readFailure(error, field);
  }
}

/** What a preview read, fingerprinted, so a confirm can tell the sheet changed in between. */
export function gridHash(grid: SheetGrid): string {
  return createHash("sha256").update(JSON.stringify({ header: grid.header, rows: grid.rows })).digest("hex");
}

/* NESTO's side ------------------------------------------------------------------ */

const UNIT_SELECT = {
  id: true,
  unitCode: true,
  floorId: true,
  unitTypeId: true,
  orientation: true,
  internalArea: true,
  balconyArea: true,
  terraceArea: true,
  netArea: true,
  commonAreaAllocation: true,
  grossArea: true,
  saleableArea: true,
  outdoorArea: true,
  gardenArea: true,
  bedrooms: true,
  bathrooms: true,
  storage: true,
  sortOrder: true,
  version: true,
  isActive: true,
  publicationStatus: true,
  unitCodeKey: true,
  unitType: { select: { category: true } },
  floor: { select: { sortOrder: true, building: { select: { id: true, code: true, sortOrder: true } } } },
  commercialProfile: { select: { status: true, askingPrice: true, currency: true, version: true } },
} satisfies Prisma.ProjectUnitSelect;
type UnitRow = Prisma.ProjectUnitGetPayload<{ select: typeof UNIT_SELECT }>;

const decimal = (value: Prisma.Decimal | null) => value?.toFixed(2) ?? null;

function valuesOf(row: UnitRow): Record<SheetField, string | null> {
  return {
    type: row.unitTypeId,
    orientation: row.orientation,
    internalArea: decimal(row.internalArea),
    balconyArea: decimal(row.balconyArea),
    terraceArea: decimal(row.terraceArea),
    commonAreaAllocation: decimal(row.commonAreaAllocation),
    grossArea: decimal(row.grossArea),
    saleableArea: decimal(row.saleableArea),
    outdoorArea: decimal(row.outdoorArea),
    gardenArea: decimal(row.gardenArea),
    bedrooms: row.bedrooms === null ? null : String(row.bedrooms),
    bathrooms: row.bathrooms === null ? null : String(row.bathrooms),
    storage: row.storage === null ? null : String(row.storage),
    price: decimal(row.commercialProfile?.askingPrice ?? null),
  };
}

function toDiffUnit(row: UnitRow): DiffUnit {
  return {
    id: row.id,
    unitCode: row.unitCode,
    label: unitLabel(row.floor.building.code, row.unitCode),
    buildingId: row.floor.building.id,
    floorId: row.floorId,
    category: row.unitType.category,
    archived: row.publicationStatus === "ARCHIVED",
    version: row.version,
    salesVersion: row.commercialProfile?.version ?? 0,
    status: row.commercialProfile?.status ?? "NOT_FOR_SALE",
    currency: row.commercialProfile?.currency ?? null,
    values: valuesOf(row),
  };
}

/** The Units table's own order: building, floor, the unit's place on it, then its code (`unitListOrder`). */
function byStructure(a: UnitRow, b: UnitRow): number {
  return a.floor.building.sortOrder - b.floor.building.sortOrder || a.floor.sortOrder - b.floor.sortOrder || a.sortOrder - b.sortOrder || (a.unitCodeKey < b.unitCodeKey ? -1 : a.unitCodeKey > b.unitCodeKey ? 1 : 0) || (a.id < b.id ? -1 : 1);
}

async function loadUnits(context: UserContext, project: StructureProject, ids?: string[]): Promise<UnitRow[]> {
  const rows = await prisma.projectUnit.findMany({ where: { AND: [readableUnitWhere(context), { projectId: project.id }, ...(ids ? [{ id: { in: ids } }] : [])] }, select: UNIT_SELECT });
  return rows.sort(byStructure);
}

async function loadStructure(context: UserContext, project: StructureProject) {
  const where = { companyId: context.companyId, projectId: project.id };
  const [buildings, floors, types] = await Promise.all([
    prisma.projectBuilding.findMany({ where, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, code: true } }),
    prisma.projectFloor.findMany({ where, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, buildingId: true, name: true, number: true } }),
    prisma.projectUnitType.findMany({ where: { companyId: context.companyId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, code: true, category: true, isActive: true } }),
  ]);
  return {
    buildings: buildings.map((building) => ({ ...building, floors: floors.filter((floor) => floor.buildingId === building.id).map(({ id, name, number }) => ({ id, name, number })) })),
    floors,
    types,
  };
}

function isBaseline(value: unknown): value is UnitBaseline {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function loadBaselines(context: UserContext, link: LinkRow | null): Promise<Map<string, UnitBaseline>> {
  if (!link) return new Map();
  const rows = await prisma.projectUnitSheetBaseline.findMany({ where: { companyId: context.companyId, linkId: link.id }, select: { unitId: true, fields: true } });
  return new Map(rows.flatMap((row) => (isBaseline(row.fields) ? [[row.unitId, row.fields] as [string, UnitBaseline]] : [])));
}

type Compared = { diff: SheetDiff; rows: UnitRow[]; units: DiffUnit[]; baselines: Map<string, UnitBaseline>; types: Array<{ id: string; name: string; code: string }> };

async function compare(context: UserContext, project: StructureProject, link: LinkRow | null, grid: SheetGrid): Promise<Compared> {
  const [rows, structure, baselines] = await Promise.all([loadUnits(context, project), loadStructure(context, project), loadBaselines(context, link)]);
  const units = rows.map(toDiffUnit);
  const capabilities = sheetCapabilities(context);
  const diff = diffSheet({ grid, units, buildings: structure.buildings, types: structure.types, baselines, can: { managePrice: capabilities.canManagePrice, createUnit: capabilities.canCreateUnit } });
  return { diff, rows, units, baselines, types: structure.types.map(({ id, name, code }) => ({ id, name, code })) };
}

/* Linking ------------------------------------------------------------------------- */

/**
 * Links the project's Units to a sheet, or replaces the link. The sheet is
 * read first, so a link that cannot be read is never saved, and the answer
 * says what was found: its rows and columns. `dryRun` only reads. A link to
 * another spreadsheet or tab starts again with no baseline; the same sheet
 * pasted again keeps it.
 */
export async function linkSheet(context: UserContext, projectId: string, input: SheetLinkInput, deps: Deps = {}): Promise<SheetLinkResultDTO> {
  const project = await loadStructureProject(context, projectId);
  assertPermission(context, "project.unit.update");
  const parsed = parseSheetLink(input.url);
  if (!parsed.ok) throw new AccessError("VALIDATION_ERROR", LINK_MESSAGES[parsed.problem], { code: "SHEET_LINK_INVALID", field: "url" });
  const read = await readSheet(parsed.ref, deps, "url");
  const existing = await findLink(context, project);
  const { diff } = await compare(context, project, null, read.grid);
  const check: SheetCheckDTO = { ...diff.check, title: read.title };
  if (input.dryRun) return { link: existing ? await linkDTO(context, existing) : null, check };

  const sameSheet = existing !== null && existing.spreadsheetId === parsed.ref.spreadsheetId && existing.sheetGid === parsed.ref.gid;
  const saved = await prisma
    .$transaction(async (tx) => {
      let row: LinkRow;
      if (existing && sameSheet) {
        const moved = await tx.projectUnitSheetLink.updateMany({ where: { companyId: context.companyId, id: existing.id, version: existing.version }, data: { sourceUrl: parsed.url, title: read.title } });
        if (!moved.count) throw relinkConflict();
        row = { ...existing, sourceUrl: parsed.url, title: read.title };
      } else if (existing) {
        await tx.projectUnitSheetBaseline.deleteMany({ where: { companyId: context.companyId, linkId: existing.id } });
        const moved = await tx.projectUnitSheetLink.updateMany({
          where: { companyId: context.companyId, id: existing.id, version: existing.version },
          data: { spreadsheetId: parsed.ref.spreadsheetId, sheetGid: parsed.ref.gid, sourceUrl: parsed.url, title: read.title, linkedByMemberId: context.membershipId, linkedAt: new Date(), lastSyncedAt: null, lastSyncedByMemberId: null, version: { increment: 1 } },
        });
        if (!moved.count) throw relinkConflict();
        row = (await tx.projectUnitSheetLink.findFirst({ where: { companyId: context.companyId, id: existing.id }, select: LINK_SELECT }))!;
      } else {
        row = await tx.projectUnitSheetLink.create({
          data: { companyId: context.companyId, projectId: project.id, spreadsheetId: parsed.ref.spreadsheetId, sheetGid: parsed.ref.gid, sourceUrl: parsed.url, title: read.title, linkedByMemberId: context.membershipId },
          select: LINK_SELECT,
        });
      }
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.PROJECT_UNIT_SHEET_LINKED,
          entity: { type: "Project", id: project.id, label: project.name },
          projectId: project.id,
          before: existing ? { spreadsheetId: existing.spreadsheetId, sheetGid: existing.sheetGid, title: existing.title } : null,
          after: { spreadsheetId: row.spreadsheetId, sheetGid: row.sheetGid, title: row.title },
          metadata: { rows: check.rows, keptBaseline: sameSheet },
        },
        { tx },
      );
      return row;
    })
    .catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw relinkConflict();
      throw error;
    });
  return { link: await linkDTO(context, saved), check };
}

function relinkConflict(): AccessError {
  return new AccessError("CONFLICT", "Somebody changed this project's Google Sheet link a moment ago. Refresh and try again.", { code: "SHEET_LINK_STALE" });
}

/** Removes the link, and with it everything the syncs remembered. The units stay as they are. */
export async function unlinkSheet(context: UserContext, projectId: string): Promise<void> {
  const project = await loadStructureProject(context, projectId);
  assertPermission(context, "project.unit.update");
  const link = await findLink(context, project);
  if (!link) throw notLinked();
  await prisma.$transaction(async (tx) => {
    await tx.projectUnitSheetBaseline.deleteMany({ where: { companyId: context.companyId, linkId: link.id } });
    await tx.projectUnitSheetLink.deleteMany({ where: { companyId: context.companyId, id: link.id } });
    await recordUserAction(
      context,
      { actionKey: AuditAction.PROJECT_UNIT_SHEET_UNLINKED, entity: { type: "Project", id: project.id, label: project.name }, projectId: project.id, before: { spreadsheetId: link.spreadsheetId, sheetGid: link.sheetGid, title: link.title }, after: null },
      { tx },
    );
  });
}

/* The preview ------------------------------------------------------------------------ */

function previewOf(compared: Compared, input: { link: SheetLinkDTO; linkRow: LinkRow; hash: string; title: string | null; capabilities: SheetCapabilitiesDTO }): SheetPreviewDTO {
  const { diff } = compared;
  const head = (matched: MatchedUnit) => ({ unitId: matched.unit.id, label: matched.unit.label, row: matched.row, currency: matched.unit.currency });
  const versions = (matched: MatchedUnit) => ({ version: matched.unit.version, salesVersion: matched.unit.salesVersion, status: matched.unit.status });
  const changes: SheetPreviewDTO["changes"] = [];
  const clashes: SheetPreviewDTO["clashes"] = [];
  const newer: SheetPreviewDTO["newerInNesto"] = [];
  let unchangedUnits = 0;
  let candidates = 0;
  for (const matched of diff.matched) {
    const changed = matched.outcomes.flatMap((outcome) => (outcome.kind === "change" ? [{ id: changeId(matched.unit.id, outcome.field), field: outcome.field, from: outcome.from, to: outcome.to, price: toPriceDTO(outcome.price) }] : []));
    const clashing = matched.outcomes.flatMap((outcome) => (outcome.kind === "clash" ? [{ id: changeId(matched.unit.id, outcome.field), field: outcome.field, sheet: outcome.sheet, nesto: outcome.nesto, price: toPriceDTO(outcome.price) }] : []));
    const behind = matched.outcomes.flatMap((outcome) => (outcome.kind === "newer" ? [{ field: outcome.field, sheet: outcome.sheet, nesto: outcome.nesto }] : []));
    if (changed.length) changes.push({ ...head(matched), ...versions(matched), fields: changed });
    if (clashing.length) clashes.push({ ...head(matched), ...versions(matched), fields: clashing });
    if (behind.length) newer.push({ ...head(matched), fields: behind });
    if (!changed.length && !clashing.length && !behind.length) unchangedUnits += 1;
    const priced = [...changed, ...clashing].some((field) => field.field === "price" && field.price?.total !== null && field.price?.total !== undefined);
    if (priced && matched.unit.status === "NOT_FOR_SALE") candidates += 1;
  }
  candidates += diff.newUnits.filter((plan) => plan.price !== null).length;
  const newUnits: SheetPreviewDTO["newUnits"] = diff.newUnits.map((plan) => ({
    id: plan.id,
    row: plan.row,
    code: plan.unitCode,
    label: plan.label,
    building: plan.building,
    floor: plan.floor,
    type: { id: plan.type.id, name: plan.type.name },
    fields: (Object.keys(plan.values) as Array<keyof NewUnitPlan["values"]>).map((field) => ({ field, value: plan.values[field] ?? null })),
    price: toPriceDTO(plan.price),
  }));
  return {
    link: input.link,
    linkVersion: input.linkRow.version,
    sheetHash: input.hash,
    readAt: new Date().toISOString(),
    sheet: { ...diff.check, title: input.title },
    firstSync: input.linkRow.lastSyncedAt === null,
    counts: {
      changes: changes.reduce((sum, unit) => sum + unit.fields.length, 0),
      changedUnits: changes.length,
      clashes: clashes.reduce((sum, unit) => sum + unit.fields.length, 0),
      newUnits: newUnits.length,
      newerInNesto: newer.reduce((sum, unit) => sum + unit.fields.length, 0),
      skipped: diff.skipped.length,
      notInSheet: diff.notInSheet.length,
      unchangedUnits,
    },
    changes,
    clashes,
    newUnits,
    newerInNesto: newer,
    skipped: diff.skipped,
    notInSheet: diff.notInSheet.map((unit) => ({ unitId: unit.id, label: unit.label })),
    unknownColumns: diff.check.unknownColumns,
    unitTypes: compared.types,
    putOnSale: { allowed: input.capabilities.canPutOnSale, candidates: input.capabilities.canPutOnSale ? candidates : 0 },
    capabilities: input.capabilities,
  };
}

async function requireSyncable(context: UserContext, projectId: string): Promise<{ project: StructureProject; link: LinkRow }> {
  const project = await loadStructureProject(context, projectId);
  assertPermission(context, "project.unit.update");
  const link = await findLink(context, project);
  if (!link) throw notLinked();
  return { project, link };
}

/** Sync now: reads the sheet and answers every change it would make. Writes nothing. */
export async function previewSheetSync(context: UserContext, projectId: string, deps: Deps = {}): Promise<SheetPreviewDTO> {
  const { project, link } = await requireSyncable(context, projectId);
  const read = await readSheet({ spreadsheetId: link.spreadsheetId, gid: link.sheetGid }, deps);
  const compared = await compare(context, project, link, read.grid);
  if (!compared.diff.check.hasCodeColumn) throw noCodeColumn();
  return previewOf(compared, { link: await linkDTO(context, link), linkRow: link, hash: read.hash, title: read.title, capabilities: sheetCapabilities(context) });
}

function noCodeColumn(): AccessError {
  return new AccessError("VALIDATION_ERROR", "The sheet has no Unit column, so NESTO cannot tell which row is which unit. Start from NESTO's units: download the file and import it into the sheet.", { code: "SHEET_NO_CODE_COLUMN" });
}

/* Confirming ------------------------------------------------------------------------ */

const SKIP_OF_BULK: Record<BulkSkipReason, SheetSkipReason> = {
  not_found: "not_found",
  not_allowed: "not_allowed",
  changed: "changed",
  sold: "sold",
  reserved: "invalid",
  on_hold: "invalid",
  no_area: "no_area",
  not_sellable: "not_sellable",
  on_sale: "invalid",
  already: "invalid",
  wrong_status: "invalid",
  invalid: "invalid",
  failed: "failed",
};

/** Why a unit's own service refused a change, as a skipped value says it; its message is kept, it says the specific thing. */
function refusal(error: unknown, operation: string, unitId: string | null): { reason: SheetSkipReason; message: string } {
  if (error instanceof AccessError && (error.details as { code?: unknown } | undefined)?.code === "UNIT_CODE_TAKEN") return { reason: "code_taken", message: error.message };
  const { reason, message } = skipReasonOf(error);
  if (reason === "failed") logger.error(`${operation}.failed`, { unitId, ...serialiseError(error) });
  return { reason: SKIP_OF_BULK[reason], message };
}

/** The technical fields to save, as the unit forms send them: the type is `unitTypeId`. */
function structureInput(structure: Partial<Record<SheetStructureField, string | null>>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [field, value] of Object.entries(structure)) {
    if (field === "type") continue;
    out[field] = field === "bedrooms" || field === "bathrooms" || field === "storage" ? (value === null || value === undefined ? null : Number(value)) : (value ?? null);
  }
  return out;
}

type UnitOutcome = { saved: Set<SheetField>; skipped: SheetSkipDTO[]; wentOnSale: boolean; stayedOff: SheetSkipDTO | null };

type PriceStep = { unit: { id: string; label: string }; row: number; code: string; status: DiffUnit["status"]; sellable: boolean; expectedSalesVersion: number; proposal: NonNullable<UnitPlan["price"]> };

async function savePrice(context: UserContext, step: PriceStep, options: { putOnSale: boolean; capabilities: SheetCapabilitiesDTO }, outcome: UnitOutcome): Promise<void> {
  const { unit, row, code, proposal } = step;
  try {
    if (!options.capabilities.canManagePrice) {
      outcome.skipped.push(sheetSkip({ reason: "price_not_allowed", row, code, unit, field: "price", value: proposal.total }));
      return;
    }
    // The area the unit has now, after this sync's own area changes: a price per m² is on it.
    const areas = await prisma.projectUnit.findFirst({ where: { companyId: context.companyId, id: unit.id }, select: { saleableArea: true, grossArea: true } });
    if (!areas) throw new AccessError("NOT_FOUND", "That unit could not be found.");
    const sale = { saleableArea: decimal(areas.saleableArea), grossArea: decimal(areas.grossArea) };
    const price = proposal.amount === null ? { askingPrice: null, priceBasis: saleArea(sale).basis } : bulkAskingPrice(proposal.entry, proposal.amount, sale);
    if (!price) {
      outcome.skipped.push(sheetSkip({ reason: "no_area", row, code, unit, field: "price" }));
      return;
    }
    const saved = await updateCommercialDetails(context, unit.id, { ...price, reason: SHEET_PRICE_REASON, expectedVersion: salesExpectedVersion(step.expectedSalesVersion) });
    outcome.saved.add("price");
    if (!options.putOnSale || price.askingPrice === null || step.status !== "NOT_FOR_SALE") return;
    if (!options.capabilities.canPutOnSale) {
      outcome.stayedOff = sheetSkip({ reason: "not_allowed", row, code, unit, message: "You cannot put units on sale, so this unit stays off sale with its new price." });
      return;
    }
    if (!step.sellable) {
      outcome.stayedOff = sheetSkip({ reason: "not_sellable", row, code, unit });
      return;
    }
    try {
      await changeSaleStatus(context, unit.id, { action: "put_on_sale", reason: null, expectedVersion: saved.version });
      outcome.wentOnSale = true;
    } catch (error) {
      const { reason, message } = refusal(error, "unit_sheet.put_on_sale", unit.id);
      outcome.stayedOff = sheetSkip({ reason, row, code, unit, message });
    }
  } catch (error) {
    const { reason, message } = refusal(error, "unit_sheet.price", unit.id);
    outcome.skipped.push(sheetSkip({ reason, row, code, unit, field: "price", message, value: proposal.total }));
  }
}

/** A few units side by side, each in its own transactions, in the order given. */
async function eachUnit<T, R>(items: readonly T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker()));
  return results;
}

/**
 * Confirms a preview with the person's choices: the changes and new units
 * kept ticked, each clash's pick, "Also put newly priced units on sale".
 * Returns what was saved and what was skipped, and why. A unit changed since
 * the preview is skipped whole ("changed since the preview — sync again"),
 * and its baseline is left as it was.
 */
export async function applySheetSync(context: UserContext, projectId: string, input: SheetApplyInput, deps: Deps = {}): Promise<SheetApplyResultDTO> {
  const { project, link } = await requireSyncable(context, projectId);
  if (link.version !== input.linkVersion) throw syncStale();
  const read = await readSheet({ spreadsheetId: link.spreadsheetId, gid: link.sheetGid }, deps);
  if (read.hash !== input.sheetHash) throw new AccessError("CONFLICT", "The sheet changed since the preview. Sync again to see what it says now.", { code: "SHEET_CHANGED" });
  const compared = await compare(context, project, link, read.grid);
  if (!compared.diff.check.hasCodeColumn) throw noCodeColumn();

  // One confirm per preview: the first to move the link's version on writes; another is refused before writing anything.
  const claimed = await prisma.projectUnitSheetLink.updateMany({ where: { companyId: context.companyId, id: link.id, version: link.version }, data: { version: { increment: 1 } } });
  if (!claimed.count) throw syncStale();

  const capabilities = sheetCapabilities(context);
  const choices = { accept: new Set(input.accept), clashes: new Map(Object.entries(input.clashes)) };
  const plans = planUnits(compared.diff, choices);
  const seen = new Map(input.units.map((unit) => [unit.id, unit]));
  const sellableOf = new Map(compared.rows.map((row) => [row.id, sellability({ isActive: row.isActive, publicationStatus: row.publicationStatus }).sellable]));
  const outcomes = new Map<string, UnitOutcome>();
  const stale = new Set<string>();
  const skipped: SheetSkipDTO[] = [];

  return withAuditSource(SHEET_AUDIT_SOURCE, async () => {
    await eachUnit(plans, BULK_CONCURRENCY, async (plan) => {
      const { unit, row } = plan;
      const code = unit.label;
      const touchesStructure = Object.keys(plan.structure).length > 0 || plan.keepNesto.some((field) => field !== "price");
      const touchesPrice = plan.price !== null || plan.keepNesto.includes("price");
      const was = seen.get(unit.id);
      if (!was || (touchesStructure && was.version !== unit.version) || (touchesPrice && was.salesVersion !== unit.salesVersion)) {
        stale.add(unit.id);
        skipped.push(sheetSkip({ reason: "changed", row, code, unit }));
        return;
      }
      const outcome: UnitOutcome = { saved: new Set(), skipped: [], wentOnSale: false, stayedOff: null };
      outcomes.set(unit.id, outcome);
      const fields = Object.keys(plan.structure) as SheetStructureField[];
      let structureStale = false;
      if (fields.length) {
        try {
          const change = updateUnitSchema.parse({ unitCode: unit.unitCode, unitTypeId: plan.structure.type ?? unit.values.type, expectedVersion: was.version, ...structureInput(plan.structure) });
          await updateUnit(context, unit.id, change);
          for (const field of fields) outcome.saved.add(field);
        } catch (error) {
          const { reason, message } = refusal(error, "unit_sheet.structure", unit.id);
          structureStale = reason === "changed";
          for (const field of fields) outcome.skipped.push(sheetSkip({ reason, row, code, unit, field, message, value: plan.structure[field] ?? null }));
        }
      }
      if (plan.price) {
        if (structureStale) outcome.skipped.push(sheetSkip({ reason: "changed", row, code, unit, field: "price", value: plan.price.total }));
        else await savePrice(context, { unit, row, code, status: unit.status, sellable: sellableOf.get(unit.id) ?? false, expectedSalesVersion: was.salesVersion, proposal: plan.price }, { putOnSale: input.putOnSale, capabilities }, outcome);
      }
    });

    // New units, one at a time and in the sheet's order: each joins the end of its floor.
    const created: Array<{ plan: NewUnitPlan; unitId: string; outcome: UnitOutcome }> = [];
    for (const plan of compared.diff.newUnits) {
      if (!choices.accept.has(plan.id)) continue;
      const outcome: UnitOutcome = { saved: new Set(), skipped: [], wentOnSale: false, stayedOff: null };
      try {
        const values = plan.values;
        const createInput = createUnitSchema.parse({
          unitCode: plan.unitCode,
          unitTypeId: plan.type.id,
          ...structureInput({ ...values }),
          attributes: null,
          description: null,
        });
        const unit = await createUnit(context, plan.floor.id, createInput);
        for (const field of Object.keys(plan.sheet) as SheetField[]) if (field !== "price") outcome.saved.add(field);
        created.push({ plan, unitId: unit.id, outcome });
        if (plan.price) await savePrice(context, { unit: { id: unit.id, label: plan.label }, row: plan.row, code: plan.label, status: "NOT_FOR_SALE", sellable: true, expectedSalesVersion: 0, proposal: plan.price }, { putOnSale: input.putOnSale, capabilities }, outcome);
      } catch (error) {
        const { reason, message } = refusal(error, "unit_sheet.create", null);
        skipped.push(sheetSkip({ reason, row: plan.row, code: plan.label, message }));
      }
    }

    // The baseline: what the sheet and NESTO agree on now (unit-sheet.diff.ts `nextBaseline`).
    const freshIds = [...compared.diff.matched.filter((matched) => !stale.has(matched.unit.id)).map((matched) => matched.unit.id), ...created.map((one) => one.unitId)];
    const fresh = new Map((await loadUnits(context, project, freshIds)).map((row) => [row.id, valuesOf(row)]));
    const keptNesto = new Map(plans.map((plan) => [plan.unit.id, new Set(plan.keepNesto)]));
    const baselines: Array<{ unitId: string; fields: UnitBaseline }> = [];
    for (const matched of compared.diff.matched) {
      const current = fresh.get(matched.unit.id);
      if (stale.has(matched.unit.id) || !current) continue;
      baselines.push({
        unitId: matched.unit.id,
        fields: nextBaseline({ previous: compared.baselines.get(matched.unit.id), outcomes: matched.outcomes, sheet: matched.sheet, saved: outcomes.get(matched.unit.id)?.saved ?? new Set(), keptNesto: keptNesto.get(matched.unit.id) ?? new Set(), current }),
      });
    }
    for (const one of created) {
      const current = fresh.get(one.unitId);
      if (current) baselines.push({ unitId: one.unitId, fields: newUnitBaseline(one.plan.sheet, current, one.outcome.saved) });
    }

    const applied = [
      ...compared.diff.matched.flatMap((matched) => {
        const saved = outcomes.get(matched.unit.id)?.saved;
        return saved && saved.size ? [{ unitId: matched.unit.id, label: matched.unit.label, fields: [...saved] }] : [];
      }),
    ];
    const allOutcomes = [...outcomes.values(), ...created.map((one) => one.outcome)];
    for (const outcome of allOutcomes) skipped.push(...outcome.skipped);
    const moved = [
      ...plans.flatMap((plan) => (outcomes.get(plan.unit.id)?.wentOnSale ? [{ unitId: plan.unit.id, label: plan.unit.label }] : [])),
      ...created.flatMap((one) => (one.outcome.wentOnSale ? [{ unitId: one.unitId, label: one.plan.label }] : [])),
    ];
    const stayedOff = allOutcomes.flatMap((outcome) => (outcome.stayedOff ? [outcome.stayedOff] : []));

    const synced = await prisma.$transaction(async (tx) => {
      const ids = baselines.map((baseline) => baseline.unitId);
      if (ids.length) {
        await tx.projectUnitSheetBaseline.deleteMany({ where: { companyId: context.companyId, linkId: link.id, unitId: { in: ids } } });
        const rows = baselines.filter((baseline) => Object.keys(baseline.fields).length > 0);
        if (rows.length) {
          await tx.projectUnitSheetBaseline.createMany({
            data: rows.map((baseline) => ({ companyId: context.companyId, projectId: project.id, linkId: link.id, unitId: baseline.unitId, fields: baseline.fields as Prisma.InputJsonValue })),
          });
        }
      }
      await tx.projectUnitSheetLink.updateMany({ where: { companyId: context.companyId, id: link.id }, data: { lastSyncedAt: new Date(), lastSyncedByMemberId: context.membershipId, title: read.title ?? link.title } });
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.PROJECT_UNIT_SHEET_SYNCED,
          entity: { type: "Project", id: project.id, label: project.name },
          projectId: project.id,
          metadata: {
            spreadsheetId: link.spreadsheetId,
            sheetGid: link.sheetGid,
            changedUnits: applied.map((unit) => unit.unitId),
            createdUnits: created.map((one) => one.unitId),
            keptNesto: plans.filter((plan) => plan.keepNesto.length && !stale.has(plan.unit.id)).map((plan) => plan.unit.id),
            wentOnSale: moved.map((unit) => unit.unitId),
            skipped: skipped.length,
          },
        },
        { tx },
      );
      return tx.projectUnitSheetLink.findFirst({ where: { companyId: context.companyId, id: link.id }, select: LINK_SELECT });
    });

    skipped.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
    stayedOff.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
    return {
      applied: { units: applied, newUnits: created.map((one) => ({ unitId: one.unitId, label: one.plan.label, row: one.plan.row })) },
      skipped,
      putOnSale: { moved, skipped: stayedOff },
      link: await linkDTO(context, synced ?? link),
    };
  });
}

function syncStale(): AccessError {
  return new AccessError("CONFLICT", "Somebody confirmed a sync of this sheet since your preview. Sync again.", { code: "SHEET_SYNC_STALE" });
}

/* The download -------------------------------------------------------------------- */

const WIDTHS: Record<SheetColumn, number> = {
  code: 12,
  building: 18,
  floor: 14,
  type: 14,
  orientation: 13,
  internalArea: 14,
  balconyArea: 14,
  terraceArea: 14,
  netArea: 16,
  commonAreaAllocation: 16,
  grossArea: 18,
  saleableArea: 14,
  outdoorArea: 14,
  gardenArea: 14,
  bedrooms: 10,
  bathrooms: 10,
  storage: 9,
  totalPrice: 14,
  pricePerSqm: 13,
  status: 14,
};
const TEXT_COLUMNS: ReadonlySet<SheetColumn> = new Set(["code", "building", "floor", "type", "orientation", "status"]);

/** What Export narrows the file to: the tab it is pressed on and that tab's search and filters. */
export type UnitExportScope = { view: "units"; query: UnitListQuery } | { view: "sales"; query: InventoryQuery };

export type SheetDownload = { filename: string; filenameUtf8: string; body: Uint8Array; rows: number };

function tooManyToExport(total: number): AccessError {
  return new AccessError("VALIDATION_ERROR", "More units match than one file holds (5,000). Narrow the search or the filters.", { code: "EXPORT_TOO_LARGE", total, limit: SHEET_LIMITS.maxRows });
}

/**
 * "Download for Google Sheets": every unit of the project in use, in the
 * Units table's order, with the header in the reader's language and the
 * columns a sync reads — so a downloaded file is read back as it is. Net and
 * gross areas come as worked-out columns; prices as the Units table shows
 * them. Also "Start from NESTO's units" when a sheet is first linked.
 *
 * With a `scope`, Export (2026-11-10): the same builder and columns, narrowed
 * to the units the tab's search and filters match — every one of them, not
 * one page — in the tab's order, plus a Status column (the sale status as the
 * Sales tab words it) for a reader who may see sales. A sync never reads
 * Status, so an exported file can be imported into a sheet and linked.
 */
export async function buildSheetDownload(context: UserContext, projectId: string, locale: Locale, scope?: UnitExportScope): Promise<SheetDownload> {
  const project = await loadStructureProject(context, projectId);
  let rows: UnitRow[];
  if (scope) {
    const limit = SHEET_LIMITS.maxRows;
    const found = scope.view === "units" ? await listProjectUnitIds(context, project.id, scope.query, limit + 1) : await listSalesUnitIds(context, project.id, scope.query, limit + 1);
    if (found.total > limit) throw tooManyToExport(found.total);
    const byId = new Map((found.ids.length ? await loadUnits(context, project, found.ids) : []).map((row) => [row.id, row]));
    rows = found.ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  } else {
    rows = (await loadUnits(context, project)).filter((row) => row.publicationStatus !== "ARCHIVED");
  }
  const structure = await loadStructure(context, project);
  const buildings = new Map(structure.buildings.map((building) => [building.id, building]));
  const floors = new Map(structure.floors.map((floor) => [floor.id, floor]));
  const types = new Map(structure.types.map((type) => [type.id, type]));
  const prices = unitPricesVisible(context);
  // The sale status, as the Sales tab says it, only on Export and only for a reader who may see sales.
  const status = Boolean(scope) && salesCapabilities(context).canView;
  const statusWords = moduleMessages[locale].sales.labels.commercialStatus;
  const columns = SHEET_COLUMNS.filter((column) => (prices || (column !== "totalPrice" && column !== "pricePerSqm")) && (status || !IGNORED_COLUMNS.has(column)));
  const xlsxColumns: XlsxColumn[] = columns.map((column) => ({ header: SHEET_HEADERS[column][locale], width: WIDTHS[column], text: TEXT_COLUMNS.has(column), muted: WORKED_OUT_COLUMNS.has(column) }));
  const text = (value: string | null | undefined): XlsxCell => (value ? { kind: "text", text: value } : null);
  const number = (value: string | null, format: "decimal" | "integer" = "decimal"): XlsxCell => (value === null ? null : { kind: "number", value, format });
  const body = rows.map((row) => {
    const values = valuesOf(row);
    const building = buildings.get(row.floor.building.id);
    const floor = floors.get(row.floorId);
    const type = types.get(row.unitTypeId);
    const cells: Record<SheetColumn, XlsxCell> = {
      code: text(unitLabel(row.floor.building.code, row.unitCode)),
      building: text(building?.name),
      floor: text(floor ? floorName(floor.name, locale) : null),
      type: text(type ? unitTypeName(type.name, locale) : null),
      orientation: text(row.orientation ? orientationName(row.orientation as UnitOrientation, locale) : null),
      internalArea: number(values.internalArea),
      balconyArea: number(values.balconyArea),
      terraceArea: number(values.terraceArea),
      netArea: number(decimal(row.netArea)),
      commonAreaAllocation: number(values.commonAreaAllocation),
      grossArea: number(values.grossArea),
      saleableArea: number(values.saleableArea),
      outdoorArea: number(values.outdoorArea),
      gardenArea: number(values.gardenArea),
      bedrooms: number(values.bedrooms, "integer"),
      bathrooms: number(values.bathrooms, "integer"),
      storage: number(values.storage, "integer"),
      totalPrice: number(values.price),
      pricePerSqm: number(saleRate({ saleableArea: values.saleableArea, grossArea: values.grossArea }, values.price)),
      status: text(statusWords[saleStatusOf(row.commercialProfile?.status, values.price)]),
    };
    return columns.map((column) => cells[column]);
  });
  const file = buildXlsx({ sheetName: locale === "sq" ? "Njësitë" : "Units", columns: xlsxColumns, rows: body });
  const names = scope ? exportFilename(project.name, locale) : null;
  const filename = names?.ascii ?? sheetFilename(project.code);
  await recordUserAction(context, {
    actionKey: AuditAction.REPORT_EXPORTED_XLSX,
    entity: { type: "export", id: scope ? `project_units_${scope.view}` : "project_units_sheet", label: filename },
    projectId: project.id,
    metadata: { module: "projects", rows: body.length, prices, ...(scope ? { view: scope.view, status, filters: exportFilters(scope) } : {}) },
  });
  return { filename, filenameUtf8: names?.utf8 ?? filename, body: file, rows: body.length };
}

/** The filters an export was narrowed by, for its audit event: only those set. */
function exportFilters(scope: UnitExportScope): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(scope.query)) {
    if (key === "page" || key === "limit" || value === undefined || value === null || value === "") continue;
    if (typeof value === "string" || typeof value === "number") out[key] = value;
  }
  return out;
}
