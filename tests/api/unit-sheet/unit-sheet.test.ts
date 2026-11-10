import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { localizeMessage } from "@/lib/i18n/errors";
import { parseUnitListQuery } from "@/lib/modules/project-structure/structure.schema";
import { updateUnit } from "@/lib/modules/project-structure/structure.units";
import { buildSheetDownload } from "@/lib/modules/unit-sheet/unit-sheet.service";
import type { SheetPreviewDTO } from "@/lib/modules/unit-sheet/unit-sheet.types";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";
import { readZip, sheetCells } from "../../unit/unit-sheet/xlsx-reader";

/**
 * The Units tab's Google Sheet (2026-11-10), over its routes, against the
 * real database — with a server on this machine standing in for Google, which
 * the reader is pointed at only because APP_ENV is "test" here
 * (`sheetFetchOrigin`; production ignores it, tests/unit/unit-sheet). The
 * stand-in answers the two exports Google does: the CSV, and the
 * Visualization API's typed JSON — with the decimal comma of a sheet set to
 * Albanian, and the minority-typed cells Google answers as null.
 *
 * A building "SHEET Block" (code SH) this suite adds to Riverside Residences
 * (project_a), removed after every test with everything its units gathered,
 * and the project's sheet link with it.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const sheetRoute = await import("@/app/api/projects/[projectId]/units/sheet/route");
const previewRoute = await import("@/app/api/projects/[projectId]/units/sheet/preview/route");
const applyRoute = await import("@/app/api/projects/[projectId]/units/sheet/apply/route");
const downloadRoute = await import("@/app/api/projects/[projectId]/units/sheet/download/route");

const RIVERSIDE = PROJECT.a;
const T = "SHEET";
const CODE = "SH";
const SHEET_ID = "1SheetFixtureRiversideUnits_abcdefghijklmn";
const PRIVATE_ID = "1SheetFixturePrivateSheet_abcdefghijklmnop";
const LINK = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;
const SHEET_ACTIONS = ["PROJECT_UNIT_SHEET_LINKED", "PROJECT_UNIT_SHEET_UNLINKED", "PROJECT_UNIT_SHEET_SYNCED"];

type Cell = string | number | null;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/* The stand-in for Google ------------------------------------------------------ */

let server: Server;
let requests = 0;
let sheet: Cell[][] = [];
const saved = { appEnv: process.env.APP_ENV, origin: process.env.NESTO_SHEET_FETCH_ORIGIN };

/** A number as a sheet set to Albanian shows it: a decimal comma. */
const shown = (value: number) => String(value).replace(".", ",");
const csvCell = (value: Cell) => {
  const text = value === null ? "" : typeof value === "number" ? shown(value) : value;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** What the Visualization API answers: each column typed by its majority, the minority answered null. */
function gviz(rows: Cell[][]): string {
  const [header = [], ...data] = rows;
  const width = Math.max(header.length, ...data.map((row) => row.length));
  const types = Array.from({ length: width }, (_, column) => {
    const values = data.map((row) => row[column]).filter((value) => value !== null && value !== undefined);
    const numbers = values.filter((value) => typeof value === "number").length;
    return numbers > values.length - numbers ? "number" : "string";
  });
  const table = {
    cols: types.map((type, column) => ({ id: String.fromCharCode(65 + column), label: String(header[column] ?? ""), type })),
    rows: data.map((row) => ({
      c: types.map((type, column) => {
        const value = row[column] ?? null;
        if (value === null) return null;
        if (type === "number") return typeof value === "number" ? { v: value, f: shown(value) } : null;
        return typeof value === "string" ? { v: value } : null;
      }),
    })),
  };
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ version: "0.6", reqId: "0", status: "ok", sig: "1", table })});`;
}

beforeAll(async () => {
  server = createServer((request, response) => {
    requests += 1;
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const match = /^\/spreadsheets\/d\/([^/]+)\/(export|gviz\/tq)$/.exec(url.pathname);
    if (url.pathname === `/download/${SHEET_ID}.csv`) {
      response.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=\"export.csv\"; filename*=UTF-8''Riverside%20units%20-%20Sheet1.csv" });
      response.end(sheet.map((row) => row.map(csvCell).join(",")).join("\r\n"));
      return;
    }
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    if (match[1] === PRIVATE_ID) {
      response.writeHead(302, { location: "https://accounts.google.com/ServiceLogin?continue=https://docs.google.com/" }).end();
      return;
    }
    if (match[1] !== SHEET_ID) {
      response.writeHead(404).end();
      return;
    }
    // Google hands the CSV over from another host; here, another path of the same origin.
    if (match[2] === "export") {
      response.writeHead(307, { location: `/download/${SHEET_ID}.csv` }).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(gviz(sheet));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.APP_ENV = "test";
  process.env.NESTO_SHEET_FETCH_ORIGIN = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  [owner, pm, viewer] = await Promise.all((["OWNER", "PROJECT_MANAGER", "VIEWER"] as const).map((role) => loginAs(role)));
  tenantOwner = await loginAsEmail(DEMO_EMAIL.tenantOwner);
  apartmentType = (await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY.a, code: "APARTMENT" }, select: { id: true } })).id;
  lastActivityAt = (await prisma.project.findUniqueOrThrow({ where: { id: RIVERSIDE }, select: { lastActivityAt: true } })).lastActivityAt;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$executeRaw`UPDATE "projects" SET "lastActivityAt" = ${lastActivityAt} WHERE "id" = ${RIVERSIDE}`;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (saved.appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = saved.appEnv;
  if (saved.origin === undefined) delete process.env.NESTO_SHEET_FETCH_ORIGIN;
  else process.env.NESTO_SHEET_FETCH_ORIGIN = saved.origin;
  await cleanupSessions();
  await prisma.$disconnect();
});

/* The project's side ------------------------------------------------------------- */

let owner: UserContext;
let pm: UserContext;
let viewer: UserContext;
let tenantOwner: UserContext;
let apartmentType: string;
let lastActivityAt: Date | null;
let floor5: string;
let floor6: string;
let unit501: string;
let unit502: string;

async function cleanup() {
  actAs(null);
  await prisma.projectUnitSheetBaseline.deleteMany({ where: { projectId: RIVERSIDE } });
  await prisma.projectUnitSheetLink.deleteMany({ where: { projectId: RIVERSIDE } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ projectId: RIVERSIDE, actionKey: { in: SHEET_ACTIONS } }, { entityId: { in: ["project_units_sheet", "project_units_units", "project_units_sales"] } }] } });
  const buildings = await prisma.projectBuilding.findMany({ where: { projectId: RIVERSIDE, nameKey: { startsWith: T } }, select: { id: true } });
  const floors = await prisma.projectFloor.findMany({ where: { buildingId: { in: buildings.map((row) => row.id) } }, select: { id: true } });
  const units = await prisma.projectUnit.findMany({ where: { floorId: { in: floors.map((row) => row.id) } }, select: { id: true } });
  const unitIds = units.map((row) => row.id);
  const ids = [...unitIds, ...floors.map((row) => row.id)];
  await prisma.unitPriceHistory.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitCommercialStatusHistory.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitCommercialProfile.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.projectUnit.updateMany({ where: { id: { in: unitIds } }, data: { currentPublicationId: null } });
  await prisma.unitPublication.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: unitIds } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.projectUnit.deleteMany({ where: { id: { in: unitIds } } });
  await prisma.projectFloor.deleteMany({ where: { id: { in: floors.map((row) => row.id) } } });
  await prisma.projectBuilding.deleteMany({ where: { id: { in: buildings.map((row) => row.id) } } });
}

beforeEach(async () => {
  const building = await prisma.projectBuilding.create({ data: { companyId: COMPANY.a, projectId: RIVERSIDE, name: `${T} Block`, nameKey: `${T} BLOCK`, code: CODE, codeKey: CODE, sortOrder: 92, createdBy: "test" } });
  floor5 = (await prisma.projectFloor.create({ data: { companyId: COMPANY.a, projectId: RIVERSIDE, buildingId: building.id, levelType: "STANDARD", number: 5, name: "Floor 5", floorKey: "STANDARD:5", sortOrder: 1, createdBy: "test" } })).id;
  floor6 = (await prisma.projectFloor.create({ data: { companyId: COMPANY.a, projectId: RIVERSIDE, buildingId: building.id, levelType: "STANDARD", number: 6, name: "Floor 6", floorKey: "STANDARD:6", sortOrder: 2, createdBy: "test" } })).id;
  const base = { companyId: COMPANY.a, projectId: RIVERSIDE, floorId: floor5, unitTypeId: apartmentType, createdBy: "test", publicationStatus: "PUBLISHED" as const };
  unit501 = (await prisma.projectUnit.create({ data: { ...base, unitCode: "501", unitCodeKey: "501", sortOrder: 1, internalArea: "64.72", balconyArea: "8.00", commonAreaAllocation: "10.00", netArea: "72.72", grossArea: "82.72", saleableArea: "80.00", bedrooms: 2, bathrooms: 1, orientation: "NE" } })).id;
  unit502 = (await prisma.projectUnit.create({ data: { ...base, unitCode: "502", unitCodeKey: "502", sortOrder: 2, internalArea: "50.00", netArea: "50.00", grossArea: "50.00", bedrooms: 1, bathrooms: 1 } })).id;
  await prisma.projectUnit.create({ data: { ...base, unitCode: "503", unitCodeKey: "503", sortOrder: 3, internalArea: "40.00", publicationStatus: "ARCHIVED" } });
  await prisma.unitCommercialProfile.create({ data: { companyId: COMPANY.a, projectId: RIVERSIDE, unitId: unit501, status: "FOR_SALE", askingPrice: "160000.00", currency: "EUR", priceBasis: "SALEABLE_AREA" } });
  requests = 0;
  sheet = [];
});

afterEach(cleanup);

/* Calling the routes ----------------------------------------------------------------- */

type Answer = { status: number; body: Json };

async function call(context: UserContext, handler: (request: Request, init: { params: Promise<{ projectId: string }> }) => Promise<Response>, method: string, body?: unknown, projectId: string = RIVERSIDE): Promise<Answer> {
  actAs(context);
  const response = await handler(new Request(`http://localhost/api/projects/${projectId}/units/sheet`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ projectId }) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const link = (context: UserContext, url = LINK, dryRun = false) => call(context, sheetRoute.PUT, "PUT", { url, dryRun });
const preview = async (context: UserContext): Promise<{ status: number; body: Json; data: SheetPreviewDTO }> => {
  const answer = await call(context, previewRoute.POST, "POST");
  return { ...answer, data: answer.body?.data as SheetPreviewDTO };
};

/** Everything the preview offers, ticked; every clash as `pick` says. */
function confirmAll(data: SheetPreviewDTO, pick: Record<string, "SHEET" | "NESTO"> = {}, putOnSale = true) {
  const units = [...data.changes, ...data.clashes].map((unit) => ({ id: unit.unitId, version: unit.version, salesVersion: unit.salesVersion }));
  return {
    sheetHash: data.sheetHash,
    linkVersion: data.linkVersion,
    units: [...new Map(units.map((unit) => [unit.id, unit])).values()],
    accept: [...data.changes.flatMap((unit) => unit.fields.map((field) => field.id)), ...data.newUnits.map((unit) => unit.id)],
    clashes: pick,
    putOnSale,
  };
}
const apply = (context: UserContext, body: unknown) => call(context, applyRoute.POST, "POST", body);

const HEADER: Cell[] = ["Unit", "Building", "Floor", "Type", "Internal area (m²)", "Balcony area (m²)", "Bedrooms", "Total price", "Price per m²", "Notes"];

/* Linking ------------------------------------------------------------------------------- */

describe("linking a sheet", () => {
  it("reads it first and reports what it found; a dry run saves nothing", async () => {
    sheet = [HEADER, ["SH-501", "SHEET Block", "Floor 5", "Apartment", 64.72, 8, 2, 160000, 2000, "corner"], ["SH-502", "SH", "Floor 5", "Apartment", 50, null, 1, null, null, null]];
    const dry = await link(owner, LINK, true);
    expect(dry.status).toBe(200);
    expect(dry.body.data.link).toBeNull();
    expect(dry.body.data.check).toMatchObject({ title: "Riverside units - Sheet1", rows: 2, hasCodeColumn: true, typed: true, unknownColumns: [{ column: "J", header: "Notes" }] });
    expect(await prisma.projectUnitSheetLink.count({ where: { projectId: RIVERSIDE } })).toBe(0);

    const saved = await link(owner);
    expect(saved.status).toBe(200);
    expect(saved.body.data.link).toMatchObject({ spreadsheetId: SHEET_ID, gid: "0", url: LINK, title: "Riverside units - Sheet1", lastSyncedAt: null, version: 1 });
    expect(saved.body.data.link.linkedBy.name).toBeTruthy();
    const status = await call(owner, sheetRoute.GET, "GET");
    expect(status.body.data).toMatchObject({ link: { spreadsheetId: SHEET_ID }, capabilities: { canLink: true, canSync: true, canDownload: true, canManagePrice: true, canCreateUnit: true, canPutOnSale: true } });
    expect(await prisma.auditEvent.count({ where: { projectId: RIVERSIDE, actionKey: "PROJECT_UNIT_SHEET_LINKED" } })).toBe(1);
  });

  it("refuses a link that is not a Google Sheet's without fetching anything, and a sheet that is not shared with the words to fix it", async () => {
    const wrong = await link(owner, "https://example.com/spreadsheets/d/x");
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details.code).toBe("SHEET_LINK_INVALID");
    expect(requests).toBe(0);

    const closed = await link(owner, `https://docs.google.com/spreadsheets/d/${PRIVATE_ID}/edit`);
    expect(closed.status).toBe(422);
    expect(closed.body.error.details.code).toBe("SHEET_NOT_SHARED");
    expect(closed.body.error.message).toBe("NESTO can't read this sheet. In Google Sheets, open Share → General access → 'Anyone with the link' (Viewer), then try again.");
    expect(localizeMessage(closed.body.error.message, "sq")).toContain("NESTO nuk mund ta lexojë këtë fletë.");
    expect(await prisma.projectUnitSheetLink.count({ where: { projectId: RIVERSIDE } })).toBe(0);
  });

  it("lets a viewer see the link but not its address, and change nothing", async () => {
    sheet = [HEADER];
    await link(owner);
    const seen = await call(viewer, sheetRoute.GET, "GET");
    expect(seen.status).toBe(200);
    expect(seen.body.data.link).toMatchObject({ spreadsheetId: SHEET_ID, url: null });
    expect(seen.body.data.capabilities).toMatchObject({ canLink: false, canSync: false, canDownload: true });
    expect((await link(viewer)).status).toBe(403);
    expect((await call(viewer, sheetRoute.DELETE, "DELETE")).status).toBe(403);
    expect((await preview(viewer)).status).toBe(403);
    expect((await apply(viewer, { sheetHash: "a".repeat(64), linkVersion: 1, units: [], accept: [], clashes: {} })).status).toBe(403);
  });

  it("answers a project of another company as not found, before reading any sheet", async () => {
    sheet = [HEADER];
    expect((await call(tenantOwner, sheetRoute.GET, "GET")).status).toBe(404);
    expect((await link(tenantOwner)).status).toBe(404);
    expect((await call(owner, sheetRoute.GET, "GET", undefined, PROJECT.companyB)).status).toBe(404);
    expect((await call(owner, sheetRoute.PUT, "PUT", { url: LINK }, PROJECT.companyB)).status).toBe(404);
    expect((await call(owner, previewRoute.POST, "POST", undefined, PROJECT.companyB)).status).toBe(404);
    expect((await call(owner, downloadRoute.GET, "GET", undefined, PROJECT.companyB)).status).toBe(404);
    expect(requests).toBe(0);
  });

  it("unlinking removes the link and its baseline; the units stay", async () => {
    sheet = [HEADER, ["SH-501", "", "", "Apartment", 64.72, 8, 2, 160000, 2000, null]];
    await link(owner);
    const first = await preview(owner);
    expect((await apply(owner, confirmAll(first.data))).status).toBe(200);
    expect(await prisma.projectUnitSheetBaseline.count({ where: { projectId: RIVERSIDE } })).toBeGreaterThan(0);
    expect((await call(owner, sheetRoute.DELETE, "DELETE")).status).toBe(200);
    expect(await prisma.projectUnitSheetLink.count({ where: { projectId: RIVERSIDE } })).toBe(0);
    expect(await prisma.projectUnitSheetBaseline.count({ where: { projectId: RIVERSIDE } })).toBe(0);
    expect(await prisma.projectUnit.count({ where: { id: unit501 } })).toBe(1);
    expect((await call(owner, sheetRoute.DELETE, "DELETE")).status).toBe(404);
    expect((await preview(owner)).body.error.details.code).toBe("SHEET_NOT_LINKED");
  });
});

/* Syncing --------------------------------------------------------------------------------- */

describe("sync now", () => {
  it("previews every change, applies the ticked ones through each unit's own services, and agrees afterwards", async () => {
    sheet = [
      HEADER,
      ["SH-501", "SHEET Block", "Floor 5", "Apartment", 70, 8, 3, 160000, 2000, "corner"],
      ["SH-502", "SH", "Floor 5", "Apartament", 50, null, 1, 90000, null, null],
      ["SH-503", "SH", "Floor 5", "Apartment", 41, null, 1, null, null, null],
      ["SH-504", "SH", "Kati 6", "Apartament", 45.5, null, 1, null, 1500, null],
    ];
    await link(owner);
    const first = await preview(owner);
    expect(first.status).toBe(200);
    const data = first.data;
    expect(data.firstSync).toBe(true);
    expect(data.changes.map((unit) => [unit.label, unit.fields.map((field) => [field.field, field.from, field.to])])).toEqual([
      ["SH-501", [["internalArea", "64.72", "70.00"], ["bedrooms", "2", "3"]]],
      ["SH-502", [["price", null, "90000.00"]]],
    ]);
    expect(data.newUnits).toMatchObject([{ id: "new:504", label: "SH-504", code: "504", floor: { id: floor6 }, type: { id: apartmentType }, price: { entry: "PER_SQM", total: "68250.00", rate: "1500.00", area: "45.50" } }]);
    expect(data.skipped.map((skip) => [skip.row, skip.reason])).toEqual([[4, "archived"]]);
    expect(data.unknownColumns).toEqual([{ column: "J", header: "Notes" }]);
    expect(data.notInSheet.every((unit) => !unit.label.startsWith("SH-"))).toBe(true);
    expect(data.putOnSale).toEqual({ allowed: true, candidates: 2 });
    expect(data.counts).toMatchObject({ changes: 3, changedUnits: 2, clashes: 0, newUnits: 1, newerInNesto: 0, skipped: 1 });

    const done = await apply(owner, confirmAll(data));
    expect(done.status).toBe(200);
    expect(done.body.data.skipped).toEqual([]);
    expect(done.body.data.applied.units.map((unit: Json) => [unit.label, [...unit.fields].sort()])).toEqual([
      ["SH-501", ["bedrooms", "internalArea"]],
      ["SH-502", ["price"]],
    ]);
    const created = done.body.data.applied.newUnits[0];
    expect(created).toMatchObject({ label: "SH-504", row: 5 });
    expect(done.body.data.putOnSale.moved.map((unit: Json) => unit.label).sort()).toEqual(["SH-502", "SH-504"]);

    // Only the touched fields changed; net and gross were worked out again; nothing else moved.
    const a = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit501 }, select: { internalArea: true, netArea: true, grossArea: true, bedrooms: true, bathrooms: true, orientation: true, version: true } });
    expect([a.internalArea?.toFixed(2), a.netArea?.toFixed(2), a.grossArea?.toFixed(2), a.bedrooms, a.bathrooms, a.orientation, a.version]).toEqual(["70.00", "78.00", "88.00", 3, 1, "NE", 2]);
    const b = await prisma.unitCommercialProfile.findFirstOrThrow({ where: { unitId: unit502 }, select: { askingPrice: true, status: true, priceBasis: true } });
    expect([b.askingPrice?.toFixed(2), b.status, b.priceBasis]).toEqual(["90000.00", "FOR_SALE", "GROSS_AREA"]);
    expect((await prisma.unitPriceHistory.findFirstOrThrow({ where: { unitId: unit502 }, select: { reason: true } })).reason).toBe("Google Sheet sync");
    const c = await prisma.projectUnit.findUniqueOrThrow({ where: { id: created.unitId }, select: { unitCode: true, floorId: true, internalArea: true, grossArea: true, publicationStatus: true, commercialProfile: { select: { askingPrice: true, status: true } } } });
    expect([c.unitCode, c.floorId, c.internalArea?.toFixed(2), c.grossArea?.toFixed(2), c.publicationStatus, c.commercialProfile?.askingPrice?.toFixed(2), c.commercialProfile?.status]).toEqual(["504", floor6, "45.50", "45.50", "PUBLISHED", "68250.00", "FOR_SALE"]);

    // Every write is audited by its own service, noting where it came from.
    const audits = await prisma.auditEvent.findMany({ where: { entityId: { in: [unit501, unit502, created.unitId] }, actionKey: { in: ["PROJECT_UNIT_UPDATED", "UNIT_PRICE_CHANGED", "PROJECT_UNIT_CREATED", "UNIT_COMMERCIAL_STATUS_CHANGED"] } }, select: { actionKey: true, metadataJson: true } });
    expect(audits.length).toBeGreaterThanOrEqual(5);
    expect(audits.every((event) => (event.metadataJson as Json | null)?.source === "GOOGLE_SHEET_SYNC")).toBe(true);
    const synced = await prisma.auditEvent.findFirstOrThrow({ where: { projectId: RIVERSIDE, actionKey: "PROJECT_UNIT_SHEET_SYNCED" }, select: { metadataJson: true } });
    expect(synced.metadataJson).toMatchObject({ changedUnits: [unit501, unit502], createdUnits: [created.unitId] });
    expect(done.body.data.link).toMatchObject({ version: 2, lastSyncedBy: { memberId: owner.membershipId } });

    // The same sheet again: nothing left to do.
    const again = await preview(owner);
    expect(again.data.firstSync).toBe(false);
    expect(again.data.counts).toMatchObject({ changes: 0, clashes: 0, newUnits: 0, newerInNesto: 0 });
  });

  it("a reader without the price grant has the prices left out with the reason, and the rest saved", async () => {
    sheet = [HEADER, ["SH-501", "", "", "Apartment", 64.72, 8, 3, 170000, null, null]];
    await link(owner);
    const seen = await preview(pm);
    expect(seen.status).toBe(200);
    expect(seen.data.capabilities).toMatchObject({ canManagePrice: false, canPutOnSale: false });
    expect(seen.data.changes[0]!.fields.map((field) => field.field)).toEqual(["bedrooms"]);
    expect(seen.data.skipped.map((skip) => [skip.label, skip.reason, skip.field])).toEqual([["SH-501", "price_not_allowed", "price"]]);
    const done = await apply(pm, confirmAll(seen.data));
    expect(done.status).toBe(200);
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit501 }, select: { bedrooms: true } })).bedrooms).toBe(3);
    expect((await prisma.unitCommercialProfile.findFirstOrThrow({ where: { unitId: unit501 }, select: { askingPrice: true } })).askingPrice?.toFixed(2)).toBe("160000.00");
    // The price was not agreed, so it is offered again to someone who may set it.
    expect((await preview(owner)).data.changes[0]?.fields.map((field) => [field.field, field.to])).toEqual([["price", "170000.00"]]);
  });

  it("leaves the price alone with 'Also put on sale' unticked", async () => {
    sheet = [HEADER, ["SH-502", "", "", "Apartment", 50, null, 1, 90000, null, null]];
    await link(owner);
    const seen = await preview(owner);
    const done = await apply(owner, confirmAll(seen.data, {}, false));
    expect(done.body.data.putOnSale.moved).toEqual([]);
    expect((await prisma.unitCommercialProfile.findFirstOrThrow({ where: { unitId: unit502 }, select: { status: true, askingPrice: true } })).status).toBe("NOT_FOR_SALE");
  });

  it("asks about a clash, and a clash kept as NESTO has it comes back as newer in NESTO", async () => {
    sheet = [HEADER, ["SH-501", "", "", "Apartment", 64.72, 8, 2, 160000, 2000, null]];
    await link(owner);
    expect((await apply(owner, confirmAll((await preview(owner)).data))).status).toBe(200);
    // Both sides move: NESTO to 1 bedroom, the sheet to 3.
    const unit = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit501 }, select: { version: true } });
    await updateUnit(owner, unit501, { unitCode: "501", unitTypeId: apartmentType, bedrooms: 1, expectedVersion: unit.version });
    sheet = [HEADER, ["SH-501", "", "", "Apartment", 64.72, 8, 3, 160000, 2000, null]];
    const clash = await preview(owner);
    expect(clash.data.clashes).toMatchObject([{ label: "SH-501", fields: [{ field: "bedrooms", sheet: "3", nesto: "1" }] }]);
    const id = clash.data.clashes[0]!.fields[0]!.id;
    expect((await apply(owner, confirmAll(clash.data, { [id]: "NESTO" }))).status).toBe(200);
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit501 }, select: { bedrooms: true } })).bedrooms).toBe(1);
    const after = await preview(owner);
    expect(after.data.clashes).toEqual([]);
    expect(after.data.newerInNesto).toMatchObject([{ label: "SH-501", fields: [{ field: "bedrooms", sheet: "3", nesto: "1" }] }]);
  });

  it("skips a unit changed since the preview, refuses a sheet changed since, and a preview confirmed twice", async () => {
    sheet = [HEADER, ["SH-501", "", "", "Apartment", 70, 8, 2, 160000, null, null], ["SH-502", "", "", "Apartment", 55, null, 1, null, null, null]];
    await link(owner);
    const seen = await preview(owner);
    const unit = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit501 }, select: { version: true } });
    await updateUnit(owner, unit501, { unitCode: "501", unitTypeId: apartmentType, bathrooms: 2, expectedVersion: unit.version });
    const done = await apply(owner, confirmAll(seen.data));
    expect(done.status).toBe(200);
    expect(done.body.data.skipped.map((skip: Json) => [skip.label, skip.reason])).toEqual([["SH-501", "changed"]]);
    expect(done.body.data.applied.units.map((one: Json) => one.label)).toEqual(["SH-502"]);
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit501 }, select: { internalArea: true } })).internalArea?.toFixed(2)).toBe("64.72");
    // The same preview again: the link moved on with the confirm.
    expect((await apply(owner, confirmAll(seen.data))).body.error.details.code).toBe("SHEET_SYNC_STALE");

    const next = await preview(owner);
    sheet = [HEADER, ["SH-501", "", "", "Apartment", 71, 8, 2, 160000, null, null]];
    const refused = await apply(owner, confirmAll(next.data));
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.code).toBe("SHEET_CHANGED");
  });

  it("refuses a sheet with no Unit column, and says how to start one", async () => {
    sheet = [["Code", "Bedrooms"], ["SH-501", 2]];
    await link(owner);
    const answer = await preview(owner);
    expect(answer.status).toBe(422);
    expect(answer.body.error.details.code).toBe("SHEET_NO_CODE_COLUMN");
  });
});

/* The download ------------------------------------------------------------------------------- */

describe("download for Google Sheets", () => {
  function rowsOf(file: Uint8Array): string[][] {
    const cells = sheetCells(readZip(file).get("xl/worksheets/sheet1.xml")!);
    const rows = new Map<number, string[]>();
    for (const cell of cells) {
      const [, column, row] = /^([A-Z]+)(\d+)$/.exec(cell.ref)!;
      const list = rows.get(Number(row)) ?? [];
      list[column!.charCodeAt(0) - 65] = cell.value;
      rows.set(Number(row), list);
    }
    const width = rows.get(1)?.length ?? 0;
    return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => Array.from({ length: width }, (_, index) => list[index] ?? ""));
  }

  it("is an .xlsx of the units in use, in the Units table's order, with worked-out areas and prices, that a viewer may take too", async () => {
    actAs(viewer);
    const response = await downloadRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ projectId: RIVERSIDE }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="A-PRJ-001-units-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const rows = rowsOf(new Uint8Array(await response.arrayBuffer()));
    expect(rows[0]).toEqual(["Unit", "Building", "Floor", "Type", "Orientation", "Internal area (m²)", "Balcony area (m²)", "Terrace area (m²)", "Net area (m²) – worked out", "Common area allocation (m²)", "Gross area (m²) – worked out, typed for land", "Saleable area (m²)", "Outdoor area (m²)", "Garden area (m²)", "Bedrooms", "Bathrooms", "Storage", "Total price", "Price per m²"]);
    const ours = rows.filter((row) => row[0]!.startsWith("SH-"));
    expect(ours).toEqual([
      ["SH-501", "SHEET Block", "Floor 5", "Apartment", "North-east", "64.72", "8.00", "", "72.72", "10.00", "82.72", "80.00", "", "", "2", "1", "", "160000.00", "2000.00"],
      ["SH-502", "SHEET Block", "Floor 5", "Apartment", "", "50.00", "", "", "50.00", "", "50.00", "", "", "", "1", "1", "", "", ""],
    ]);
    expect(rows.length - 1).toBe(await prisma.projectUnit.count({ where: { projectId: RIVERSIDE, publicationStatus: { not: "ARCHIVED" } } }));
    expect(await prisma.auditEvent.count({ where: { entityId: "project_units_sheet", actionKey: "REPORT_EXPORTED_XLSX" } })).toBe(1);
  });

  it("writes the header in Albanian for an Albanian reader, and a downloaded file is read back with nothing to change", async () => {
    const file = await buildSheetDownload(owner, RIVERSIDE, "sq");
    const rows = rowsOf(file.body);
    expect(rows[0]!.slice(0, 6)).toEqual(["Njësia", "Ndërtesa", "Kati", "Lloji", "Orientimi", "Sipërfaqja e brendshme (m²)"]);
    expect(rows.find((row) => row[0] === "SH-501")!.slice(1, 5)).toEqual(["SHEET Block", "Kati 5", "Apartament", "Verilindje"]);
    // Imported into the sheet: numbers stay numbers, everything else text.
    const numeric = new Set(rows[0]!.map((_, index) => index).filter((index) => index >= 5));
    sheet = rows.map((row, rowIndex) => row.map((value, index) => (value === "" ? null : rowIndex > 0 && numeric.has(index) ? Number(value) : value)));
    await link(owner);
    const seen = await preview(owner);
    expect(seen.status).toBe(200);
    expect(seen.data.unknownColumns).toEqual([]);
    expect(seen.data.counts).toMatchObject({ changes: 0, clashes: 0, newUnits: 0, newerInNesto: 0, notInSheet: 0 });
    expect(seen.data.skipped).toEqual([]);
  });
});

/* Export (2026-11-10) ------------------------------------------------------------------------ */

describe("Export from the Units and Sales tabs", () => {
  function rowsOf(file: Uint8Array): string[][] {
    const cells = sheetCells(readZip(file).get("xl/worksheets/sheet1.xml")!);
    const rows = new Map<number, string[]>();
    for (const cell of cells) {
      const [, column, row] = /^([A-Z]+)(\d+)$/.exec(cell.ref)!;
      const list = rows.get(Number(row)) ?? [];
      list[column!.charCodeAt(0) - 65] = cell.value;
      rows.set(Number(row), list);
    }
    const width = rows.get(1)?.length ?? 0;
    return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => Array.from({ length: width }, (_, index) => list[index] ?? ""));
  }
  async function exported(context: UserContext, query: string) {
    actAs(context);
    const response = await downloadRoute.GET(new Request(`http://localhost/api/projects/${RIVERSIDE}/units/sheet/download?${query}`), { params: Promise.resolve({ projectId: RIVERSIDE }) });
    return { response, rows: response.ok ? rowsOf(new Uint8Array(await response.arrayBuffer())) : [] };
  }
  const withoutSales = (context: UserContext): UserContext => ({ ...context, permissions: context.permissions.filter((permission) => permission !== "project.unit.sales.view") });

  it("narrows the file to the Units tab's filters, adds the sale status, and names the file after the project", async () => {
    const { name } = await prisma.project.findUniqueOrThrow({ where: { id: RIVERSIDE }, select: { name: true } });
    const { response, rows } = await exported(owner, `view=units&floorId=${floor5}&page=3`);
    expect(response.status).toBe(200);
    const day = new Date().toISOString().slice(0, 10);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${name} - units - ${day}.xlsx"; filename*=UTF-8''${encodeURIComponent(`${name} – units – ${day}.xlsx`)}`);
    expect(response.headers.get("x-export-row-count")).toBe("2");
    expect(rows[0]!.at(-1)).toBe("Status");
    expect(rows[0]!.slice(-3, -1)).toEqual(["Total price", "Price per m²"]);
    // Every unit the filter matches, not one page; the archived SH-503 is not in use.
    expect(rows.slice(1).map((row) => [row[0], row.at(-1)])).toEqual([
      ["SH-501", "For Sale"],
      ["SH-502", "Not Priced"],
    ]);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: "project_units_units", actionKey: "REPORT_EXPORTED_XLSX" }, select: { metadataJson: true } });
    expect(audit.metadataJson).toMatchObject({ rows: 2, view: "units", status: true, filters: { floorId: floor5 } });
  });

  it("narrows it to the Sales tab's status chip, and a sheet made from it reads Status as known and changes nothing", async () => {
    const { rows } = await exported(owner, `view=sales&floorId=${floor5}&commercialStatus=FOR_SALE`);
    expect(rows.slice(1).map((row) => row[0])).toEqual(["SH-501"]);
    const numeric = new Set(rows[0]!.map((_, index) => index).filter((index) => index >= 5 && index < rows[0]!.length - 1));
    sheet = rows.map((row, rowIndex) => row.map((value, index) => (value === "" ? null : rowIndex > 0 && numeric.has(index) ? Number(value) : value)));
    await link(owner);
    const seen = await preview(owner);
    expect(seen.status).toBe(200);
    expect(seen.data.unknownColumns).toEqual([]);
    expect(seen.data.sheet.columns.find((column) => column.key === "status")).toMatchObject({ readOnly: true });
    expect(seen.data.counts).toMatchObject({ changes: 0, clashes: 0, newUnits: 0, newerInNesto: 0 });
    expect(seen.data.skipped).toEqual([]);
  });

  it("leaves Status out for a reader who may not see sales, keeps the prices the Units table shows them, and refuses them the Sales tab's export", async () => {
    const reader = withoutSales(owner);
    const { response, rows } = await exported(reader, `view=units&floorId=${floor5}`);
    expect(response.status).toBe(200);
    expect(rows[0]).not.toContain("Status");
    expect(rows[0]!.at(-1)).toBe("Price per m²");
    expect(rows.find((row) => row[0] === "SH-501")!.at(-2)).toBe("160000.00");
    expect((await exported(reader, `view=sales&floorId=${floor5}`)).response.status).toBe(403);
  });

  it("writes Status in the reader's language", async () => {
    const file = await buildSheetDownload(owner, RIVERSIDE, "sq", { view: "units", query: parseUnitListQuery(new URLSearchParams({ floorId: floor5 })) });
    const rows = rowsOf(file.body);
    expect(rows[0]!.at(-1)).toBe("Statusi");
    expect(file.filenameUtf8).toMatch(/ – njësitë – \d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
