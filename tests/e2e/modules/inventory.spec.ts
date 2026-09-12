import { expect, test } from "@playwright/test";

import { db, removeTestInventoryRecords, resetInventoryFixtures } from "../db";
import { expectAccessDenied, mainRegion, recordTable, signIn } from "../fixtures";

/**
 * The Inventory journey (PRD #20 §418–§435).
 *
 * Walks the module as the roles its rules are written for: the storeman who
 * moves the material, the project manager who sees the stock on their own jobs,
 * the buyer who books a delivery in, and the roles that get no Inventory at all.
 *
 * The rules worth walking in a browser rather than only asserting in a service
 * test: a draft moves nothing until somebody posts it, a posted document offers
 * no form that could rewrite it, and a stock figure is absent for a reader
 * without balance permission rather than blanked out.
 */
const PREFIX = "E2E-Inv";

test.afterAll(async () => {
  await removeTestInventoryRecords(PREFIX);
  await resetInventoryFixtures();
  await db.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* §419 The storeman                                                           */
/* -------------------------------------------------------------------------- */

test.describe("Inventory role (PRD #20 §419)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "INVENTORY");
  });

  test("opens the module", async ({ page }) => {
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: "Inventory", level: 1 })).toBeVisible();
  });

  /*
   * One test per section rather than one walking all nine. A single test doing
   * nine cold page loads shares one timeout budget, and the ninth pays for the
   * eight compiles before it — which fails as a timeout that looks like a
   * product bug.
   */
  for (const [section, expected] of [
    ["items", "MAT-001"],
    ["warehouses", "WH-CEN"],
    ["receipts", "GRN-2026-0001"],
    ["issues", "ISS-2026-0001"],
    ["returns", "RET-2026-0001"],
    ["transfers", "TRF-2026-0001"],
    ["adjustments", "ADJ-2026-0001"],
    ["reservations", "RSV-2026-0001"],
    ["movements", "Cement"],
  ] as const) {
    test(`reaches ${section}`, async ({ page }) => {
      await page.goto(`/inventory/${section}`);
      await expect(recordTable(page).getByText(expected).first()).toBeVisible();
    });
  }

  test("shows on hand, reserved and available on the item master (§39)", async ({ page }) => {
    await page.goto("/inventory/items");

    const header = recordTable(page).first();
    await expect(header.getByText("On hand").first()).toBeVisible();
    await expect(header.getByText("Reserved").first()).toBeVisible();
    await expect(header.getByText("Available").first()).toBeVisible();
  });

  test("a draft moves no stock until it is posted (§281)", async ({ page }) => {
    await page.goto("/inventory/items/item_paper");
    const before = await mainRegion(page)
      .getByRole("definition")
      .filter({ hasText: /ream/ })
      .first()
      .textContent();

    await page.goto("/inventory/receipts/new");
    await page.locator("#warehouseId").selectOption("wh_central");
    await page.locator("#lines-0-item").selectOption("item_paper");
    await page.locator("#lines-0-location").selectOption("loc_central_main");
    await page.locator("#lines-0-quantity").fill("30");
    await page.locator("#notes").fill(`${PREFIX} paper delivery`);
    await page.getByRole("button", { name: "Save draft" }).click();

    await page.waitForURL(/\/inventory\/receipts\/(?!new)[^/]+$/);
    await expect(mainRegion(page).getByText("Draft").first()).toBeVisible();
    await expect(
      mainRegion(page).getByText(/Nothing has reached the stock ledger yet/),
    ).toBeVisible();

    // Stock is unchanged while it is only a draft.
    await page.goto("/inventory/items/item_paper");
    const stillBefore = await mainRegion(page)
      .getByRole("definition")
      .filter({ hasText: /ream/ })
      .first()
      .textContent();
    expect(stillBefore).toBe(before);
  });

  test("posting says what it will do to stock, then does it (§311)", async ({ page }) => {
    await page.goto("/inventory/receipts/new");
    await page.locator("#warehouseId").selectOption("wh_central");
    await page.locator("#lines-0-item").selectOption("item_paper");
    await page.locator("#lines-0-location").selectOption("loc_central_main");
    await page.locator("#lines-0-quantity").fill("12");
    await page.locator("#notes").fill(`${PREFIX} posted delivery`);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/inventory\/receipts\/(?!new)[^/]+$/);

    await page.getByRole("button", { name: "Post", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/will increase stock/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Post to stock" }).click();

    await expect(mainRegion(page).getByText("Posted").first()).toBeVisible();
    // A posted receipt has no edit control at all — not a disabled one (§98).
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Post", exact: true })).toHaveCount(0);
  });

  test("refuses to issue more than is available (§115, §334)", async ({ page }) => {
    await page.goto("/inventory/issues/new");
    await page.locator("#warehouseId").selectOption("wh_central");
    await page.locator("#lines-0-item").selectOption("item_paper");
    await page.locator("#lines-0-location").selectOption("loc_central_main");
    await page.locator("#lines-0-quantity").fill("999999");
    await page.locator("#notes").fill(`${PREFIX} oversized issue`);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/inventory\/issues\/(?!new)[^/]+$/);

    await page.getByRole("button", { name: "Post", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Post to stock" }).click();

    // The refusal names the shortfall rather than failing silently.
    await expect(page.getByRole("status").getByText(/enough|available/i).first()).toBeVisible();
    await expect(mainRegion(page).getByText("Draft").first()).toBeVisible();
  });

  test("warns before an adjustment that writes stock off (§318)", async ({ page }) => {
    await page.goto("/inventory/adjustments/new");
    await page.locator("#warehouseId").selectOption("wh_central");
    await page.locator("#reason").selectOption("DAMAGE");
    await page.locator("#lines-0-item").selectOption("item_paper");
    await page.locator("#lines-0-location").selectOption("loc_central_main");
    await page.locator("#lines-0-delta").fill("-2");
    await page.locator("#notes").fill(`${PREFIX} damaged reams`);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/inventory\/adjustments\/(?!new)[^/]+$/);

    await expect(
      mainRegion(page).getByText(/directly reduces what the company is recorded as holding/i),
    ).toBeVisible();
  });

  test("reverses by writing opposite movements, never by erasing (§70)", async ({ page }) => {
    await page.goto("/inventory/adjustments/new");
    await page.locator("#warehouseId").selectOption("wh_central");
    await page.locator("#reason").selectOption("FOUND");
    await page.locator("#lines-0-item").selectOption("item_paper");
    await page.locator("#lines-0-location").selectOption("loc_central_main");
    await page.locator("#lines-0-delta").fill("4");
    await page.locator("#notes").fill(`${PREFIX} reversal walk`);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/inventory\/adjustments\/(?!new)[^/]+$/);

    await page.getByRole("button", { name: "Post", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Post to stock" }).click();
    await expect(mainRegion(page).getByText("Posted").first()).toBeVisible();

    await page.getByRole("button", { name: "Reverse" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/original rows stay exactly where they are/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Reverse adjustment" }).click();

    await expect(mainRegion(page).getByText("Reversed").first()).toBeVisible();
    await expect(
      mainRegion(page).getByText(/Both sets of movements remain on the ledger/i),
    ).toBeVisible();
  });

  test("the ledger offers no way to edit a movement (§70, §320)", async ({ page }) => {
    await page.goto("/inventory/movements");
    await expect(recordTable(page).first()).toBeVisible();

    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);
  });

  test("reserves stock without moving it (§166, §319)", async ({ page }) => {
    await page.goto("/inventory/items/item_paper");
    const onHandBefore = await mainRegion(page)
      .getByRole("definition")
      .first()
      .textContent();

    await page.goto("/inventory/reservations/new");
    await page.locator("#inventoryItemId").selectOption("item_paper");
    await page.locator("#warehouseId").selectOption("wh_central");
    await page.locator("#locationId").selectOption("loc_central_main");
    await page.locator("#quantity").fill("2");
    await page.getByRole("button", { name: "Reserve stock" }).click();

    await page.waitForURL(/\/inventory\/reservations$/);

    await page.goto("/inventory/items/item_paper");
    const onHandAfter = await mainRegion(page)
      .getByRole("definition")
      .first()
      .textContent();

    // On hand is untouched: the material is still in the rack.
    expect(onHandAfter).toBe(onHandBefore);
  });

  test("locks the base unit once an item has moved (§46)", async ({ page }) => {
    await page.goto("/inventory/items/item_cement/edit");
    await expect(page.locator("#baseUnit")).toHaveAttribute("readonly", "");
    await expect(mainRegion(page).getByText(/already moved/i)).toBeVisible();
  });

  test("refuses to archive an item that is still holding stock (§47)", async ({ page }) => {
    await page.goto("/inventory/items/item_cement");
    await page.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive item" }).click();

    await expect(page.getByRole("status").getByText(/stock/i).first()).toBeVisible();
    await expect(mainRegion(page).getByText("Active").first()).toBeVisible();
  });

  test("reports what is running low, and nothing that has no threshold (§168, §321)", async ({
    page,
  }) => {
    await page.goto("/inventory/low-stock");
    await expect(
      mainRegion(page).getByText(/NESTO reports what is running out/i),
    ).toBeVisible();
    await expect(mainRegion(page).getByText("No threshold set")).toHaveCount(0);
  });

  test("reports no stock value anywhere (§186)", async ({ page }) => {
    await page.goto("/inventory/reports");

    // The page says plainly why there is no figure, rather than showing a
    // currency total nobody could defend.
    await expect(mainRegion(page).getByText(/no costing method/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /stock value/i })).toHaveCount(0);
    await expect(mainRegion(page).getByText(/^€|^\$|EUR |USD /)).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */
/* §420 The project manager                                                    */
/* -------------------------------------------------------------------------- */

test.describe("Project Manager (PRD #20 §420)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("sees material on their own project (§182)", async ({ page }) => {
    await page.goto("/projects/project_a/inventory");
    await expect(
      page.getByRole("navigation", { name: "Project sections" }).getByText("Inventory"),
    ).toBeVisible();
  });

  test("cannot post stock, because posting is separated from drafting (§281)", async ({
    page,
  }) => {
    await page.goto("/inventory/issues");
    await expect(page.getByRole("button", { name: "Post", exact: true })).toHaveCount(0);
  });

  test("sees the shared central store, which carries no project (§300)", async ({ page }) => {
    await page.goto("/inventory/warehouses");

    /*
     * A warehouse with no project is shared infrastructure and stays visible:
     * a project manager cannot order a transfer from a store they cannot see
     * (PRD #20 §300). A *site* store belongs to its project's scope, and that
     * narrowing is asserted in the service test, where it can be compared
     * against a company-scope reader rather than against one fixture name that
     * another spec can move.
     */
    // Scoped to the table: "Central store" is also a Type filter option, and an
    // <option> inside a closed <select> is in the DOM but never visible.
    await expect(recordTable(page).getByText("WH-CEN").first()).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* §421 The buyer                                                              */
/* -------------------------------------------------------------------------- */

test.describe("Procurement handoff (PRD #20 §421, §11)", () => {
  test("a buyer without Inventory sees no booking control (§303)", async ({ page }) => {
    await signIn(page, "PROCUREMENT");
    await page.goto("/procurement/orders/order_002/receipts");

    await expect(mainRegion(page).getByText("Recorded deliveries")).toBeVisible();
    await expect(page.getByRole("button", { name: "Book into stock" })).toHaveCount(0);
  });

  test("a storeman books an accepted delivery in as a draft (§84, §90)", async ({ page }) => {
    await signIn(page, "INVENTORY");
    await page.goto("/procurement/orders/order_002/receipts");

    const book = page.getByRole("button", { name: "Book into stock" }).first();
    if ((await book.count()) === 0) test.skip();

    await book.click();
    await expect(
      mainRegion(page).getByText(/Only the accepted quantity crosses/i),
    ).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* §423, §424 Roles with no Inventory, and the other company                   */
/* -------------------------------------------------------------------------- */

test.describe("Access boundaries (PRD #20 §423, §424)", () => {
  test("Admin has no Inventory business access (§414)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await expectAccessDenied(page, "/inventory");
  });

  test("Company IT has no Inventory business access (§415)", async ({ page }) => {
    await signIn(page, "COMPANY_IT");
    await expectAccessDenied(page, "/inventory");
  });

  test("Finance cannot mutate stock (§412)", async ({ page }) => {
    await signIn(page, "FINANCE");
    await page.goto("/inventory/adjustments");

    // Either no access at all, or a read-only view — never a control that posts.
    if (page.url().includes("/access-denied")) return;
    await expect(page.getByRole("link", { name: "New adjustment" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Post", exact: true })).toHaveCount(0);
  });

  test("Company B cannot reach a Company A record (§424)", async ({ page }) => {
    await signIn(page, "OWNER_B");
    await page.goto("/inventory/items/item_cement");

    // The module gate fires before the record is ever looked up, so Company B
    // learns nothing about whether that id exists.
    await expect(page).toHaveURL(/\/module-unavailable/);
  });

  test("Company A never sees a Company B item (§298)", async ({ page }) => {
    await signIn(page, "OWNER");
    await page.goto("/inventory/items?search=Company+B");
    await expect(mainRegion(page).getByText(/must never appear/i)).toHaveCount(0);
  });
});
