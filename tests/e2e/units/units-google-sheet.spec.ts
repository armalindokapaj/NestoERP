import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";

import { expect, test, type Download, type Page } from "@playwright/test";

import { readZip, sheetCells } from "../../unit/unit-sheet/xlsx-reader";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { createSpareProject, removeSpareProject } from "../structure-fixtures";

/**
 * Units linked to a Google Sheet, and Export (2026-11-10): from the Units tab
 * and from the Sales tab, on a desktop and at phone width.
 *
 * Link a sheet that is not shared (refused, with how to share it) and one
 * that is; Sync now shows a change, a new unit and skipped rows, and applies
 * them; a second sync has nothing to do; a clash is kept as NESTO has it and
 * comes back as newer in NESTO; Download for Google Sheets; Unlink. Linking
 * from Sales shows linked on Units. Export takes the tab's filter, with the
 * sale status for a reader who may see sales and prices exactly when the
 * reader's Units table shows them.
 *
 * Google is never reached: a server in this process stands in for it, and the
 * app reads sheets from it because it runs with APP_ENV=development (or test)
 * and NESTO_SHEET_FETCH_ORIGIN pointing here — production ignores the setting
 * (lib/modules/unit-sheet/unit-sheet.link.ts). Start the app under test with
 *
 *   APP_ENV=test NESTO_SHEET_FETCH_ORIGIN=http://127.0.0.1:3247
 *
 * (or set NESTO_SHEET_FETCH_ORIGIN for both the app and this run).
 *
 * Built on a spare Aurelia project with a building of its own, removed again
 * afterwards with the link, its baseline and every unit a sync added.
 */

const COMPANY = "company_demo_a";
const PROJECT = "project_e2e_gsheet";
const BUILDING = "bld_gsheet_e2e";
const FLOOR_1 = "flr_gsheet_e2e_1";
const FLOOR_2 = "flr_gsheet_e2e_2";
const U101 = "unit_gsheet_e2e_101";
const U102 = "unit_gsheet_e2e_102";
const U103 = "unit_gsheet_e2e_103";

const ORIGIN = process.env.NESTO_SHEET_FETCH_ORIGIN ?? "http://127.0.0.1:3247";
const SHEET_ID = "1GsheetE2eRiverUnits_abcdefghijklmnopqrstu";
const PRIVATE_ID = "1GsheetE2ePrivateSheet_abcdefghijklmnopqrs";
const LINK = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;
const PRIVATE_LINK = `https://docs.google.com/spreadsheets/d/${PRIVATE_ID}/edit`;

test.describe.configure({ mode: "serial" });

/* The stand-in for Google ------------------------------------------------------ */

type Cell = string | number | null;
let sheet: Cell[][] = [];
let server: Server;

const HEADER: Cell[] = ["Unit", "Building", "Floor", "Type", "Internal area (m²)", "Bedrooms", "Bathrooms", "Total price", "Notes"];
/** The first sheet: GS-101 gains a bedroom, GS-102's "7" bedrooms is refused, GS-103 is archived, GS-201 is new. */
const FIRST: Cell[][] = [
  HEADER,
  ["GS-101", "GS Tower", "Floor 1", "Apartment", 60, 3, 1, 120000, "corner"],
  ["GS-102", "GS Tower", "Floor 1", "Apartment", 50, 7, 1, null, null],
  ["GS-103", "GS Tower", "Floor 1", "Apartment", 40, 1, 1, null, null],
  ["GS-201", "GS Tower", "Floor 2", "Apartment", 45, 1, 1, 90000, null],
];

const csvCell = (value: Cell) => {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The Visualization API's answer: each column typed by its majority, the minority answered null. */
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
        if (type === "number") return typeof value === "number" ? { v: value, f: String(value) } : null;
        return typeof value === "string" ? { v: value } : null;
      }),
    })),
  };
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ version: "0.6", reqId: "0", status: "ok", sig: "1", table })});`;
}

function startGoogle(): Promise<Server> {
  const port = Number(new URL(ORIGIN).port || 80);
  const google = createServer((request, response) => {
    const url = new URL(request.url ?? "/", ORIGIN);
    if (url.pathname === `/download/${SHEET_ID}.csv`) {
      response.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=\"export.csv\"; filename*=UTF-8''GS%20units%20-%20Sheet1.csv" });
      response.end(sheet.map((row) => row.map(csvCell).join(",")).join("\r\n"));
      return;
    }
    const match = /^\/spreadsheets\/d\/([^/]+)\/(export|gviz\/tq)$/.exec(url.pathname);
    if (match?.[1] === PRIVATE_ID) {
      response.writeHead(302, { location: "https://accounts.google.com/ServiceLogin?continue=https://docs.google.com/" }).end();
      return;
    }
    if (match?.[1] !== SHEET_ID) {
      response.writeHead(404).end();
      return;
    }
    if (match[2] === "export") {
      response.writeHead(307, { location: `/download/${SHEET_ID}.csv` }).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(gviz(sheet));
  });
  return new Promise((resolve) => google.listen(port, "127.0.0.1", () => resolve(google)));
}

/* The project's side ------------------------------------------------------------- */

async function clear() {
  await db.projectUnitSheetBaseline.deleteMany({ where: { projectId: PROJECT } });
  await db.projectUnitSheetLink.deleteMany({ where: { projectId: PROJECT } });
  const units = (await db.projectUnit.findMany({ where: { projectId: PROJECT }, select: { id: true } })).map((row) => row.id);
  await db.unitPriceHistory.deleteMany({ where: { unitId: { in: units } } });
  await db.unitCommercialStatusHistory.deleteMany({ where: { unitId: { in: units } } });
  await db.unitCommercialProfile.deleteMany({ where: { unitId: { in: units } } });
  await db.notificationEventOutbox.deleteMany({ where: { entityId: { in: [...units, BUILDING, FLOOR_1, FLOOR_2] } } });
  await db.activity.deleteMany({ where: { entityId: { in: [...units, BUILDING, FLOOR_1, FLOOR_2, PROJECT] } } });
}

async function seed() {
  const apartment = await db.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY, code: "APARTMENT" }, select: { id: true } });
  await db.projectBuilding.create({ data: { id: BUILDING, companyId: COMPANY, projectId: PROJECT, name: "GS Tower", nameKey: "GS TOWER", code: "GS", codeKey: "GS", sortOrder: 1, createdBy: "seed" } });
  await db.projectFloor.createMany({
    data: [
      { id: FLOOR_1, companyId: COMPANY, projectId: PROJECT, buildingId: BUILDING, levelType: "STANDARD", number: 1, name: "Floor 1", floorKey: "STANDARD:1", sortOrder: 1, createdBy: "seed" },
      { id: FLOOR_2, companyId: COMPANY, projectId: PROJECT, buildingId: BUILDING, levelType: "STANDARD", number: 2, name: "Floor 2", floorKey: "STANDARD:2", sortOrder: 2, createdBy: "seed" },
    ],
  });
  const base = { companyId: COMPANY, projectId: PROJECT, floorId: FLOOR_1, unitTypeId: apartment.id, createdBy: "seed", bathrooms: 1 };
  await db.projectUnit.createMany({
    data: [
      { ...base, id: U101, unitCode: "101", unitCodeKey: "101", sortOrder: 1, internalArea: "60.00", netArea: "60.00", grossArea: "60.00", bedrooms: 2, publicationStatus: "PUBLISHED" },
      { ...base, id: U102, unitCode: "102", unitCodeKey: "102", sortOrder: 2, internalArea: "50.00", netArea: "50.00", grossArea: "50.00", bedrooms: 1, publicationStatus: "PUBLISHED" },
      { ...base, id: U103, unitCode: "103", unitCodeKey: "103", sortOrder: 3, internalArea: "40.00", netArea: "40.00", grossArea: "40.00", bedrooms: 1, publicationStatus: "ARCHIVED" },
    ],
  });
  await db.unitCommercialProfile.create({ data: { companyId: COMPANY, projectId: PROJECT, unitId: U101, status: "FOR_SALE", askingPrice: "120000.00", currency: "EUR", statusChangedAt: new Date() } });
}

/** Back to the three seeded units, no link, no baseline, the first sheet. */
async function reset() {
  await clear();
  await removeSpareProject(PROJECT);
  await createSpareProject(PROJECT, "A-E2E-GS", "Sheet Residences GS");
  await seed();
  sheet = FIRST.map((row) => [...row]);
}

test.beforeAll(async () => {
  server = await startGoogle();
  await reset();
});

test.afterAll(async () => {
  await clear();
  await removeSpareProject(PROJECT);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.$disconnect();
});

/* Helpers ------------------------------------------------------------------------- */

const unitsUrl = `/projects/${PROJECT}/units`;
const salesUrl = `/projects/${PROJECT}/sales`;

function control(page: Page) {
  return mainRegion(page).getByTestId("sheet-control");
}

async function openSheetMenu(page: Page) {
  await control(page).click();
  const menu = page.getByTestId("sheet-menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function linkSheet(page: Page) {
  await openSheetMenu(page);
  await page.getByTestId("sheet-link-open").click();
  const dialog = page.getByTestId("sheet-link-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("sheet-url").fill(LINK);
  await dialog.getByTestId("sheet-link-check").click();
  await expect(dialog.getByTestId("sheet-check-rows")).toHaveText(/\d+ rows?/);
  await dialog.getByTestId("sheet-link-confirm").click();
  await expect(dialog).toBeHidden();
  await expect(control(page)).toHaveAttribute("data-linked", "true");
}

async function syncNow(page: Page) {
  await openSheetMenu(page);
  await page.getByTestId("sheet-sync-open").click();
  const dialog = page.getByTestId("sheet-sync-dialog");
  await expect(dialog).toHaveAttribute("data-stage", "preview");
  return dialog;
}

async function confirmSync(page: Page) {
  const dialog = page.getByTestId("sheet-sync-dialog");
  await dialog.getByTestId("sheet-sync-confirm").click();
  await expect(dialog).toHaveAttribute("data-stage", "done");
  return dialog;
}

/** The rows of a downloaded .xlsx, each a list of cell texts by column. */
async function xlsxRows(download: Download): Promise<string[][]> {
  const cells = sheetCells(readZip(new Uint8Array(readFileSync((await download.path())!))).get("xl/worksheets/sheet1.xml")!);
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

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

/* Desktop: the Units tab ------------------------------------------------------------- */

test("Units: a sheet that is not shared is refused with how to share it; a shared one is checked, then linked", async ({ page }) => {
  await reset();
  await signIn(page, "OWNER", { company: COMPANY, to: unitsUrl });
  // [Prices] [Export] [Google Sheet ▾] [+ Add units], in that order.
  const header = mainRegion(page).locator("[data-testid=units-prices-link], [data-testid=units-export], [data-testid=sheet-control], [data-testid=add-units]");
  await expect(header).toHaveCount(4);
  expect(await header.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")))).toEqual(["units-prices-link", "units-export", "sheet-control", "add-units"]);
  await expect(control(page)).toHaveAttribute("data-linked", "false");

  const menu = await openSheetMenu(page);
  await expect(menu.getByTestId("sheet-status")).toContainText("No Google Sheet linked");
  await page.getByTestId("sheet-link-open").click();
  const dialog = page.getByTestId("sheet-link-dialog");
  await expect(dialog.getByTestId("sheet-how-to").locator("li")).toHaveCount(3);
  await dialog.getByTestId("sheet-url").fill(PRIVATE_LINK);
  await dialog.getByTestId("sheet-link-check").click();
  await expect(dialog.getByTestId("sheet-link-error")).toHaveText("NESTO can't read this sheet. In Google Sheets, open Share → General access → 'Anyone with the link' (Viewer), then try again.");
  await expect(dialog.getByTestId("sheet-link-confirm")).toHaveCount(0);

  await dialog.getByTestId("sheet-url").fill(LINK);
  await dialog.getByTestId("sheet-link-check").click();
  await expect(dialog.getByTestId("sheet-check-title")).toHaveText("GS units - Sheet1");
  await expect(dialog.getByTestId("sheet-check-rows")).toHaveText("4 rows");
  await expect(dialog.getByTestId("sheet-check-unknown")).toContainText("Notes");
  await dialog.getByTestId("sheet-link-confirm").click();
  await expect(dialog).toBeHidden();
  await expect(control(page)).toHaveAttribute("data-linked", "true");
  await openSheetMenu(page);
  await expect(page.getByTestId("sheet-status-title")).toHaveText("Linked to GS units - Sheet1");
  await expect(page.getByTestId("sheet-status-synced")).toHaveText("Not synced yet");
  await page.keyboard.press("Escape");
  expect(await db.projectUnitSheetLink.count({ where: { projectId: PROJECT } })).toBe(1);
});

test("Units: Sync now previews a change, a new unit and skipped rows, applies them, and a second sync has nothing to do", async ({ page }) => {
  await signIn(page, "OWNER", { company: COMPANY, to: unitsUrl });
  const dialog = await syncNow(page);
  await expect(dialog.getByTestId("sheet-count-changes")).toHaveAttribute("data-count", "1");
  await expect(dialog.getByTestId("sheet-count-newUnits")).toHaveAttribute("data-count", "1");
  await expect(dialog.getByTestId("sheet-count-skipped")).toHaveAttribute("data-count", "2");

  const change = dialog.getByTestId("sheet-change-unit").filter({ has: page.locator("[data-field=bedrooms]") });
  await expect(change).toHaveAttribute("data-unit", "GS-101");
  await expect(change.getByTestId("sheet-change-field")).toContainText("2");
  await expect(change.getByTestId("sheet-change-field")).toContainText("3");
  await expect(dialog.getByTestId("sheet-new-unit")).toHaveAttribute("data-unit", "GS-201");
  await expect(dialog.getByTestId("sheet-new-unit")).toContainText("GS Tower · Floor 2 · Apartment");
  const skipped = dialog.getByTestId("sheet-skipped-item");
  await expect(skipped.filter({ hasText: "GS-102" })).toHaveAttribute("data-reason", "invalid_value");
  await expect(skipped.filter({ hasText: "GS-103" })).toHaveAttribute("data-reason", "archived");
  await expect(dialog.getByTestId("sheet-unknown-columns")).toContainText("Notes");
  await expect(dialog.getByTestId("sheet-put-on-sale").getByRole("checkbox")).toBeChecked();

  const done = await confirmSync(page);
  await expect(done.getByTestId("sheet-result-summary")).toContainText("1 unit changed.");
  await expect(done.getByTestId("sheet-result-created")).toHaveText("GS-201");
  await done.getByTestId("sheet-result-close").click();
  expect((await db.projectUnit.findUniqueOrThrow({ where: { id: U101 }, select: { bedrooms: true } })).bedrooms).toBe(3);
  const created = await db.projectUnit.findFirstOrThrow({ where: { projectId: PROJECT, unitCode: "201" }, select: { floorId: true, commercialProfile: { select: { askingPrice: true, status: true } } } });
  expect([created.floorId, created.commercialProfile?.askingPrice?.toFixed(2), created.commercialProfile?.status]).toEqual([FLOOR_2, "90000.00", "FOR_SALE"]);
  // The list read the units again: the new one is on it.
  await expect(mainRegion(page).getByText("GS-201").first()).toBeVisible();

  const again = await syncNow(page);
  await expect(again.getByTestId("sheet-sync-nothing")).toBeVisible();
  await expect(again.getByTestId("sheet-count-changes")).toHaveAttribute("data-count", "0");
  await again.getByRole("button", { name: "Cancel" }).click();
  await openSheetMenu(page);
  await expect(page.getByTestId("sheet-status-synced")).toContainText("Last synced");
  await page.keyboard.press("Escape");
});

test("Units: a clash shows both values; kept as NESTO has it, it comes back as newer in NESTO", async ({ page }) => {
  // Both sides move: NESTO to 1 bedroom, the sheet to 2.
  await db.projectUnit.update({ where: { id: U101 }, data: { bedrooms: 1, version: { increment: 1 } } });
  sheet = sheet.map((row) => (row[0] === "GS-101" ? row.map((value, index) => (index === 5 ? 2 : value)) : row));
  await signIn(page, "OWNER", { company: COMPANY, to: unitsUrl });
  const dialog = await syncNow(page);
  const clash = dialog.getByTestId("sheet-clash-field").filter({ has: page.locator("[data-testid=sheet-clash-nesto]") }).first();
  await expect(clash).toHaveAttribute("data-field", "bedrooms");
  await expect(clash.getByTestId("sheet-clash-sheet")).toContainText("2");
  await expect(clash.getByTestId("sheet-clash-nesto")).toContainText("1");
  await expect(clash.getByTestId("sheet-clash-status")).toHaveText("Not picked: waits for the next sync");
  await clash.getByTestId("sheet-clash-nesto").click();
  await expect(clash).toHaveAttribute("data-pick", "NESTO");
  await expect(clash.getByTestId("sheet-clash-status")).toHaveText("Keeps NESTO's value");
  await confirmSync(page);
  await page.getByTestId("sheet-result-close").click();
  expect((await db.projectUnit.findUniqueOrThrow({ where: { id: U101 }, select: { bedrooms: true } })).bedrooms).toBe(1);

  const next = await syncNow(page);
  await expect(next.getByTestId("sheet-section-clashes")).toHaveCount(0);
  await expect(next.getByTestId("sheet-newer-unit")).toHaveAttribute("data-unit", "GS-101");
  // Newer in NESTO offers the download that brings the sheet up to date.
  const download = page.waitForEvent("download");
  await next.getByTestId("sheet-newer-download").click();
  expect((await download).suggestedFilename()).toMatch(/^A-E2E-GS-units-\d{4}-\d{2}-\d{2}\.xlsx$/);
  await next.getByRole("button", { name: "Cancel" }).click();
});

test("Units: Download for Google Sheets, then Unlink", async ({ page }) => {
  await signIn(page, "OWNER", { company: COMPANY, to: unitsUrl });
  await openSheetMenu(page);
  const download = page.waitForEvent("download");
  await page.getByTestId("sheet-download").click();
  const rows = await xlsxRows(await download);
  expect(rows[0]!.slice(0, 4)).toEqual(["Unit", "Building", "Floor", "Type"]);
  expect(rows[0]).not.toContain("Status");
  expect(rows.slice(1).map((row) => row[0])).toEqual(["GS-101", "GS-102", "GS-201"]);

  await openSheetMenu(page);
  await page.getByTestId("sheet-unlink").click();
  const confirm = page.getByRole("dialog", { name: "Unlink the Google Sheet?" });
  await confirm.getByRole("button", { name: "Unlink" }).click();
  await expect(confirm).toBeHidden();
  await expect(control(page)).toHaveAttribute("data-linked", "false");
  expect(await db.projectUnitSheetLink.count({ where: { projectId: PROJECT } })).toBe(0);
  expect(await db.projectUnitSheetBaseline.count({ where: { projectId: PROJECT } })).toBe(0);
});

/* Desktop: the Sales tab ------------------------------------------------------------- */

test("Sales: the same control; linking from Sales shows linked on Units", async ({ page }) => {
  await reset();
  await signIn(page, "OWNER", { company: COMPANY, to: salesUrl });
  await expect(mainRegion(page).getByTestId("units-export")).toHaveAttribute("data-view", "sales");
  await expect(control(page)).toHaveAttribute("data-linked", "false");
  await linkSheet(page);

  await page.goto(unitsUrl);
  await expect(control(page)).toHaveAttribute("data-linked", "true");
  await openSheetMenu(page);
  await expect(page.getByTestId("sheet-status-title")).toHaveText("Linked to GS units - Sheet1");
  await page.keyboard.press("Escape");

  // And back: Sync now from Sales applies the same preview.
  await page.goto(salesUrl);
  const dialog = await syncNow(page);
  await expect(dialog.getByTestId("sheet-new-unit")).toHaveAttribute("data-unit", "GS-201");
  await confirmSync(page);
  await page.getByTestId("sheet-result-close").click();
  await expect(mainRegion(page).getByText("GS-201").first()).toBeVisible();
});

test("Export takes the tab's filter: only those units, the sale status, and prices as the reader's table shows them", async ({ page }) => {
  // Sales, Not Priced: GS-102 alone (GS-101 is for sale, GS-201 went on sale with its price, GS-103 is archived).
  await signIn(page, "OWNER", { company: COMPANY, to: `${salesUrl}?commercialStatus=NOT_PRICED` });
  let download = page.waitForEvent("download");
  await mainRegion(page).getByTestId("units-export").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Sheet Residences GS – units – \d{4}-\d{2}-\d{2}\.xlsx$/);
  let rows = await xlsxRows(file);
  expect(rows[0]!.at(-1)).toBe("Status");
  expect(rows.slice(1).map((row) => [row[0], row.at(-1)])).toEqual([["GS-102", "Not Priced"]]);

  // Units, searched: the search narrows the file; every match, not one page.
  await page.goto(`${unitsUrl}?q=10`);
  download = page.waitForEvent("download");
  await mainRegion(page).getByTestId("units-export").click();
  rows = await xlsxRows(await download);
  expect(rows.slice(1).map((row) => row[0])).toEqual(["GS-101", "GS-102"]);

  // A reader who may not see sales: no Status, and prices exactly when their Units table shows them.
  await signIn(page, "ARCHITECT", { company: COMPANY, to: `${unitsUrl}?q=10` });
  await expect(control(page)).toHaveAttribute("data-linked", "true");
  const tablePrices = (await mainRegion(page).getByTestId("unit-price").count()) > 0;
  download = page.waitForEvent("download");
  await mainRegion(page).getByTestId("units-export").click();
  rows = await xlsxRows(await download);
  expect(rows[0]).not.toContain("Status");
  expect(rows[0]!.includes("Total price")).toBe(tablePrices);
  expect(rows.slice(1).map((row) => row[0])).toEqual(["GS-101", "GS-102"]);
  // The architect may not edit units: a linked sheet is shown, but no Sync now, Change link or Unlink.
  await openSheetMenu(page);
  await expect(page.getByTestId("sheet-sync-open")).toHaveCount(0);
  await expect(page.getByTestId("sheet-unlink")).toHaveCount(0);
  await expect(page.getByTestId("sheet-open-google")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

/* A phone ---------------------------------------------------------------------------- */

test.describe("at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Export and Google Sheet are in the page's ⋯; link, Sync now in a full-height sheet, nothing scrolls sideways", async ({ page }) => {
    await reset();
    await signIn(page, "OWNER", { company: COMPANY, to: unitsUrl });
    await expect(mainRegion(page).getByTestId("units-export")).toBeHidden();
    await expect(mainRegion(page).getByTestId("sheet-control")).toBeHidden();

    await page.getByTestId("page-menu").click();
    await expect(page.getByTestId("page-menu-action").filter({ hasText: "Export" })).toBeVisible();
    await page.getByTestId("page-menu-action").filter({ hasText: "Link a Google Sheet" }).click();
    const linkDialog = page.getByTestId("sheet-link-dialog");
    await expect(linkDialog).toBeVisible();
    await noSidewaysScroll(page);
    await linkDialog.getByTestId("sheet-url").fill(LINK);
    await linkDialog.getByTestId("sheet-link-check").click();
    await linkDialog.getByTestId("sheet-link-confirm").click();
    await expect(linkDialog).toBeHidden();

    await page.getByTestId("page-menu").click();
    await page.getByTestId("page-menu-action").filter({ hasText: "Google Sheet" }).click();
    const sheetPanel = page.getByTestId("sheet-phone-sheet");
    await expect(sheetPanel).toContainText("Linked to GS units - Sheet1");
    await sheetPanel.getByRole("button", { name: "Sync now" }).click();

    const dialog = page.getByTestId("sheet-sync-dialog");
    await expect(dialog).toHaveAttribute("data-stage", "preview");
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(389);
    expect(box.height).toBeGreaterThanOrEqual(843);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await noSidewaysScroll(page);
    await confirmSync(page);
    await page.getByTestId("sheet-result-close").click();
    expect((await db.projectUnit.findUniqueOrThrow({ where: { id: U101 }, select: { bedrooms: true } })).bedrooms).toBe(3);

    await page.getByTestId("page-menu").click();
    const download = page.waitForEvent("download");
    await page.getByTestId("page-menu-action").filter({ hasText: "Export" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  });
});
