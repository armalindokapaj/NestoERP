import { expect, test, type Page } from "@playwright/test";

import { db } from "../db";
import { createSpareProject, removeSpareProject } from "../structure-fixtures";
import { mainRegion, signIn } from "../fixtures";

/**
 * Selling a unit, desktop (E-05E §13-§31, §55, §59, §60): Sales prices a unit,
 * puts it on sale, reserves it for a client and deal created in the same form,
 * extends the reservation and marks it Sold; the Sales Manager reopens the sale,
 * reserves a unit for an existing client and releases it. The inventory filters
 * and searches, a draft unit cannot be offered, and an Architect sees a unit's
 * commercial status but not its sale.
 *
 * Built on a building of its own on a spare Aurelia project, removed again afterwards
 * with every client, deal and trail the run created.
 */

const COMPANY = "company_demo_a";
/** A bare Aurelia project of the spec's own (see createSpareProject). */
const PROJECT = "project_e2e_harbour_05e";
const BUILDING = "bld_e05e_e2e";
const FLOOR = "flr_e05e_e2e_1";
const OFFER = "unit_e05e_e2e_101";
const SECOND = "unit_e05e_e2e_102";
const DRAFT = "unit_e05e_e2e_103";
/** Published, never priced: the side panel prices it and puts it on sale (2026-11-09). Its code stays out of the "Q-10" searches. */
const SPARE = "unit_e05e_e2e_201";
const UNITS = [OFFER, SECOND, DRAFT, SPARE];
const PREFIX = "E05E E2E";

test.describe.configure({ mode: "serial" });

async function clear() {
  const reservations = await db.unitReservation.findMany({ where: { unitId: { in: UNITS } }, select: { id: true } });
  await db.unitReservationExtension.deleteMany({ where: { reservationId: { in: reservations.map((row) => row.id) } } });
  await db.unitReservation.deleteMany({ where: { unitId: { in: UNITS } } });
  await db.opportunityUnit.deleteMany({ where: { unitId: { in: UNITS } } });
  await db.unitPriceHistory.deleteMany({ where: { unitId: { in: UNITS } } });
  await db.unitCommercialStatusHistory.deleteMany({ where: { unitId: { in: UNITS } } });
  await db.unitCommercialProfile.deleteMany({ where: { unitId: { in: UNITS } } });
  const deals = await db.opportunity.findMany({ where: { companyId: COMPANY, name: { contains: PREFIX } }, select: { id: true } });
  const clients = await db.client.findMany({ where: { companyId: COMPANY, name: { startsWith: PREFIX } }, select: { id: true } });
  const trail = [...UNITS, BUILDING, FLOOR, ...deals.map((row) => row.id), ...clients.map((row) => row.id)];
  await db.notification.deleteMany({ where: { entityId: { in: trail } } });
  await db.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
  await db.attentionItem.deleteMany({ where: { entityId: { in: trail } } });
  await db.activity.deleteMany({ where: { entityId: { in: trail } } });
  await db.opportunity.deleteMany({ where: { id: { in: deals.map((row) => row.id) } } });
  await db.contact.deleteMany({ where: { clientId: { in: clients.map((row) => row.id) } } });
  await db.client.deleteMany({ where: { id: { in: clients.map((row) => row.id) } } });
  await db.projectUnit.deleteMany({ where: { id: { in: UNITS } } });
  await db.projectFloor.deleteMany({ where: { id: FLOOR } });
  await db.projectBuilding.deleteMany({ where: { id: BUILDING } });
}

let soldRule: "RESERVATION" | "SIGNED_CONTRACT" | "DEPOSIT_RECEIVED" | "SIGNED_CONTRACT_AND_DEPOSIT" | "MANUAL_APPROVAL" = "SIGNED_CONTRACT";

test.beforeAll(async () => {
  await createSpareProject(PROJECT, "A-E2E-05E", "Harbour Residences 05E");
  // E-05E's own Sold check is the reservation; the company's stronger rules are E-05F's, tested with it.
  soldRule = (await db.companySettings.findUniqueOrThrow({ where: { companyId: COMPANY }, select: { unitSoldRule: true } })).unitSoldRule;
  await db.companySettings.update({ where: { companyId: COMPANY }, data: { unitSoldRule: "RESERVATION" } });
  await clear();
  const apartment = await db.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY, code: "APARTMENT" }, select: { id: true } });
  await db.projectBuilding.create({ data: { id: BUILDING, companyId: COMPANY, projectId: PROJECT, name: "E05E Quay", nameKey: "E05E QUAY", sortOrder: 98, createdBy: "seed" } });
  await db.projectFloor.create({ data: { id: FLOOR, companyId: COMPANY, projectId: PROJECT, buildingId: BUILDING, levelType: "STANDARD", number: 1, name: "Floor 1", floorKey: "STANDARD:1", sortOrder: 1, createdBy: "seed" } });
  const unit = (id: string, code: string, sortOrder: number, publicationStatus: "PUBLISHED" | "DRAFT") => ({ id, companyId: COMPANY, projectId: PROJECT, floorId: FLOOR, unitCode: code, unitCodeKey: code, unitTypeId: apartment.id, sortOrder, createdBy: "seed", saleableArea: "105.00", internalArea: "90.00", grossArea: "105.00", bedrooms: 2, bathrooms: 1, publicationStatus });
  await db.projectUnit.createMany({ data: [unit(OFFER, "Q-101", 1, "PUBLISHED"), unit(SECOND, "Q-102", 2, "PUBLISHED"), unit(DRAFT, "Q-103", 3, "DRAFT"), unit(SPARE, "R-201", 4, "PUBLISHED")] });
  // Q-102 is already on sale, priced, for the Sales Manager's reservation.
  await db.unitCommercialProfile.create({ data: { companyId: COMPANY, projectId: PROJECT, unitId: SECOND, status: "FOR_SALE", askingPrice: "160000.00", currency: "EUR", statusChangedAt: new Date() } });
});

test.afterAll(async () => {
  await db.companySettings.update({ where: { companyId: COMPANY }, data: { unitSoldRule: soldRule } });
  await clear();
  await removeSpareProject(PROJECT);
  await db.$disconnect();
});

const salesUrl = (unitId: string) => `/projects/${PROJECT}/units/${unitId}/sales`;
// Scoped to the main region: the panel streams, and for a moment React's parked copy is in the document too (see mainRegion).
const status = (page: Page) => mainRegion(page).getByTestId("unit-sales-summary").getByTestId("commercial-status");
const actions = (page: Page) => page.getByTestId("unit-sales-actions");
const inFuture = (days: number) => {
  const date = new Date(Date.now() + days * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

test("Sales prices a unit, puts it on sale, reserves it for a new client and deal, extends it and sells it", async ({ page }) => {
  await signIn(page, "SALES", { to: salesUrl(OFFER) });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Q-101");
  // Nobody has priced it yet: Not Priced, not Not For Sale (2026-11-09).
  await expect(status(page)).toHaveText("Not Priced");
  await expect(actions(page).getByRole("button", { name: "Reserve" })).toHaveCount(0);

  // The price, and the price per m² worked out from it (§10, §12). Typed as a
  // total or per m² of the sale area — the saleable area here — and the dialog
  // opens on Per m²; only the total is saved (2026-11-09).
  await actions(page).getByRole("button", { name: "Set price" }).click();
  const price = page.getByTestId("price-dialog");
  await expect(price.getByRole("textbox", { name: "Price per m² of saleable area" })).toBeVisible();
  await price.getByText("Total price", { exact: true }).click();
  await price.getByRole("textbox", { name: "Total price" }).fill("200000");
  await price.getByText("Price per m²", { exact: true }).click();
  const rate = price.getByRole("textbox", { name: "Price per m² of saleable area" });
  await expect(rate).toHaveValue("1904.76");
  await rate.fill("2000");
  await expect(price.getByTestId("price-per-sqm-total")).toHaveText("105.00 m² saleable × €2,000 = €210,000");
  await price.getByLabel("Reason for the change").fill("Launch price list");
  await price.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByTestId("asking-price")).toHaveText("€210,000");
  await expect(page.getByTestId("price-per-sqm")).toHaveText("€2,000/m²");
  await expect(page.getByTestId("sale-area")).toHaveText("105.00 m² · saleable");
  await expect(page.getByTestId("price-history")).toContainText("Launch price list");
  // Priced but not yet on sale.
  await expect(status(page)).toHaveText("Not For Sale");

  await actions(page).getByRole("button", { name: "Put on sale" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Put on sale" }).click();
  await expect(status(page)).toHaveText("For Sale");

  // A client and a deal that do not exist yet, created with the reservation (§16, §17, §23).
  await actions(page).getByRole("button", { name: "Reserve" }).click();
  const reserve = page.getByTestId("reserve-dialog");
  await reserve.getByRole("button", { name: "New client" }).click();
  await reserve.getByLabel("Client name").fill(`${PREFIX} Jane Doe`);
  await reserve.getByLabel("Agreed price").fill("205000");
  await reserve.getByRole("button", { name: "Reserve", exact: true }).click();
  await expect(status(page)).toHaveText("Reserved");
  await expect(page.getByTestId("reservation-client")).toHaveText(`${PREFIX} Jane Doe`);
  await expect(page.getByTestId("reservation-deal")).toHaveText(`Q-101 — ${PREFIX} Jane Doe`);
  await expect(page.getByTestId("agreed-price")).toHaveText("€205,000");
  // Asking and agreed prices stay distinct (§30).
  await expect(page.getByTestId("asking-price")).toHaveText("€210,000");

  await actions(page).getByRole("button", { name: "Extend" }).click();
  const extend = page.getByTestId("extend-dialog");
  await extend.getByLabel("New expiry date").fill(inFuture(20));
  await extend.getByLabel("Reason").fill("Waiting for the mortgage offer");
  await extend.getByRole("button", { name: "Extend" }).click();
  await expect(page.getByTestId("active-reservation")).toContainText("Waiting for the mortgage offer");

  await actions(page).getByRole("button", { name: "Mark Sold" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark Sold" }).click();
  await expect(status(page)).toHaveText("Sold");
  await expect(page.getByTestId("reservation-history")).toContainText("Converted to sale");
  // Reopening a sale is the Sales Manager's (§31).
  await expect(mainRegion(page).getByRole("button", { name: "Reopen sale" })).toHaveCount(0);
});

test("the Sales Manager reopens the sale, reserves a unit for an existing client and releases it", async ({ page }) => {
  await signIn(page, "SALES_HEAD", { to: salesUrl(OFFER) });
  await expect(status(page)).toHaveText("Sold");
  await actions(page).getByRole("button", { name: "Reopen sale" }).click();
  const reopen = page.getByTestId("reopen-dialog");
  await reopen.getByLabel("Reason").fill("The buyer withdrew before signing");
  await reopen.getByRole("button", { name: "Reopen sale" }).click();
  await expect(status(page)).toHaveText("For Sale");

  await page.goto(salesUrl(SECOND));
  await actions(page).getByRole("button", { name: "Reserve" }).click();
  const reserve = page.getByTestId("reserve-dialog");
  await reserve.getByRole("searchbox", { name: "Search clients" }).fill("ACME");
  await reserve.getByTestId("reserve-client-results").getByRole("button", { name: /ACME Developments/ }).click();
  await expect(reserve.getByTestId("reserve-client")).toContainText("ACME Developments");
  await expect(reserve.getByLabel("Deal")).not.toHaveValue("");
  await reserve.getByRole("button", { name: "Reserve", exact: true }).click();
  await expect(status(page)).toHaveText("Reserved");
  await expect(page.getByTestId("reservation-client")).toHaveText("ACME Developments");

  await actions(page).getByRole("button", { name: "Release" }).click();
  const release = page.getByTestId("release-dialog");
  await release.getByRole("button", { name: "Release" }).click();
  await expect(release.getByText("Give a reason.")).toBeVisible();
  await release.getByLabel("Reason").fill("Client chose a larger unit");
  await release.getByRole("button", { name: "Release" }).click();
  await expect(status(page)).toHaveText("For Sale");
  await expect(page.getByTestId("reservation-history")).toContainText("Released");
  await expect(page.getByTestId("reservation-history")).toContainText("Client chose a larger unit");
});

test("the inventory filters by status and searches, and a draft unit cannot be offered", async ({ page }) => {
  await signIn(page, "SALES", { to: `/projects/${PROJECT}/sales` });
  await page.getByRole("searchbox", { name: "Search units" }).fill("Q-10");
  const rows = page.getByTestId("sales-table").getByTestId("sales-row");
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId("sales-quick-filter").and(page.locator('[data-status="FOR_SALE"]'))).toContainText("2");

  // Q-103 has no price and is not on sale: Not Priced, with its own filter (2026-11-09).
  await expect(page.getByTestId("sales-quick-filter").and(page.locator('[data-status="NOT_FOR_SALE"]'))).toContainText("0");
  await page.getByTestId("sales-quick-filter").and(page.locator('[data-status="NOT_PRICED"]')).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-unit-code", "Q-103");
  await expect(rows.first().getByTestId("commercial-status")).toHaveText("Not Priced");
  expect(new URL(page.url()).searchParams.get("commercialStatus")).toBe("NOT_PRICED");
  // Nothing on screen is reserved or sold, so there are no Client, Deal or Expires columns.
  await expect(page.getByTestId("sales-table").getByRole("columnheader", { name: "Expires" })).toHaveCount(0);

  // A row opens the unit in the side panel; Open full page goes on to its Sales section, where it is sold (2026-11-09).
  await rows.first().getByRole("link", { name: "Q-103" }).click();
  const panel = page.getByTestId("unit-panel");
  await expect(panel.getByTestId("unit-panel-title")).toContainText("Q-103");
  await expect(panel.getByTestId("commercial-status")).toHaveText("Not Priced");
  // A draft cannot be offered, from the panel either.
  await expect(panel.getByTestId("unit-panel-putOnSale")).toHaveCount(0);
  await panel.getByTestId("unit-panel-open-page").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Q-103");
  await expect(page).toHaveURL(/\/units\/[^/]+\/sales$/);
  await expect(page.getByTestId("unit-not-sellable")).toContainText("This Unit is not published for Sales use.");
  await expect(mainRegion(page).getByRole("button", { name: "Put on sale" })).toHaveCount(0);
});

test("Sales offers a row's own actions, and prices ticked units together (2026-11-09)", async ({ page }) => {
  await signIn(page, "SALES", { to: `/projects/${PROJECT}/sales` });
  await page.getByRole("searchbox", { name: "Search units" }).fill("Q-10");
  const rows = page.getByTestId("sales-table").getByTestId("sales-row");
  await expect(rows).toHaveCount(3);

  // A unit for sale: open it, set its price, take it off sale, reserve it.
  await rows.filter({ hasText: "Q-102" }).getByTestId("sales-row-menu").click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Open unit", "Set price", "Take off sale", "Reserve"]);
  await page.keyboard.press("Escape");
  // A draft unit cannot be offered, so its menu has no Put on sale.
  await rows.filter({ hasText: "Q-103" }).getByTestId("sales-row-menu").click();
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Put on sale" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Tick the draft and price it: the price saves, and the unit stays off sale, named with the reason.
  await rows.filter({ hasText: "Q-103" }).getByTestId("unit-tick").click();
  const bar = mainRegion(page).getByTestId("unit-selection-bar");
  await expect(bar.getByTestId("unit-selection-count")).toHaveText("1 unit selected");
  await bar.getByTestId("bulk-price").click();
  const price = page.getByRole("dialog", { name: "Set the price of 1 unit" });
  await expect(price.getByTestId("bulk-price-entry-per-sqm")).toBeChecked();
  await price.getByText("Total price").first().click();
  await price.getByTestId("bulk-price-amount").fill("150000");
  await expect(price.getByTestId("bulk-price-put-on-sale").getByRole("checkbox")).toBeChecked();
  await price.getByTestId("bulk-price-apply").click();
  const result = page.getByTestId("bulk-result");
  await expect(result).toContainText("1 priced unit stayed off sale");
  await expect(result.getByTestId("bulk-skipped")).toContainText("Q-103");
  // The footer's Close; the dialog's corner × has the same name.
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
  await expect(rows.filter({ hasText: "Q-103" }).getByTestId("commercial-status")).toHaveText("Not For Sale");
  const profile = await db.unitCommercialProfile.findFirstOrThrow({ where: { unitId: DRAFT }, select: { askingPrice: true, status: true } });
  expect([profile.askingPrice?.toFixed(2), profile.status]).toEqual(["150000.00", "NOT_FOR_SALE"]);
});

test("the side panel prices a unit not for sale and also puts it on sale (2026-11-09)", async ({ page }) => {
  await signIn(page, "SALES", { to: `/projects/${PROJECT}/sales` });
  await page.getByRole("searchbox", { name: "Search units" }).fill("R-201");
  const rows = page.getByTestId("sales-table").getByTestId("sales-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByTestId("commercial-status")).toHaveText("Not Priced");

  // An empty Total price offers a faint Add, which opens the panel with the cursor in the price.
  await rows.first().getByTestId("unit-add-price").click();
  const panel = page.getByTestId("unit-panel");
  await expect(panel.getByTestId("unit-panel-title")).toHaveText("R-201 · Apartment · Floor 1");
  await expect(page).toHaveURL(new RegExp(`[?&]unit=${SPARE}`));
  await expect(panel.locator("#panel-asking-price")).toBeFocused();

  // Per m² of the sale area first, saying which area; the tick to put it on sale is on.
  await panel.locator("#panel-asking-price").fill("1500");
  await expect(panel.getByTestId("unit-price-line")).toContainText("105.00 m² saleable");
  const tick = panel.getByTestId("panel-put-on-sale").getByRole("checkbox");
  await expect(tick).toBeChecked();
  await panel.getByTestId("unit-panel-save").click();
  await expect(panel.getByTestId("commercial-status")).toHaveText("For Sale");
  await expect(rows.first().getByTestId("commercial-status")).toHaveText("For Sale");
  const profile = await db.unitCommercialProfile.findFirstOrThrow({ where: { unitId: SPARE }, select: { askingPrice: true, status: true, priceBasis: true } });
  expect([profile.askingPrice?.toFixed(2), profile.status, profile.priceBasis]).toEqual(["157500.00", "FOR_SALE", "SALEABLE_AREA"]);

  // Now for sale, the panel offers what Sales does next: reserve, hold, take off sale. Take it off again.
  await expect(panel.getByTestId("unit-panel-reserve")).toBeVisible();
  await panel.getByTestId("unit-panel-takeOff").click();
  await page.getByRole("dialog", { name: "Take R-201 off sale?" }).getByRole("button", { name: "Take off sale" }).click();
  await expect(panel.getByTestId("commercial-status")).toHaveText("Not For Sale");

  // Escape closes the panel; the list stays, its search kept.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]unit=/);
  await expect(page.getByRole("searchbox", { name: "Search units" })).toHaveValue("R-201");
});

test("an Architect sees a unit's commercial status, but not its sale", async ({ page }) => {
  await signIn(page, "ARCHITECT", { to: `/projects/${PROJECT}/units/${OFFER}` });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Q-101");
  await expect(page.getByTestId("commercial-status").first()).toHaveText("For Sale");
  await expect(page.getByRole("navigation", { name: "Q-101 sections" }).getByRole("link", { name: "Sales", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Sales", exact: true })).toHaveCount(0);
  await page.goto(salesUrl(OFFER));
  await expect(page).toHaveURL(/\/access-denied/);
});
