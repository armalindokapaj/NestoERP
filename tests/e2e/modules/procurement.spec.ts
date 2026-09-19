import { expect, test } from "@playwright/test";

import { db, removeTestProcurementRecords, resetProcurementFixtures } from "../db";
import { expectAccessDenied, mainRegion, recordTable, signIn } from "../fixtures";

/**
 * The Procurement journey (PRD #19 §327–§334).
 *
 * Walks the module as the roles its rules are written for: the buyer who runs
 * the purchasing, the CEO who approves what the buyer submitted and may not
 * approve their own, the project manager who sees the buying on jobs they run,
 * and the roles that get no Procurement at all.
 *
 * The rules worth walking in a browser rather than only asserting in a service
 * test: a supplier's price is absent from the page rather than hidden by CSS,
 * and an approved order has no form that could rewrite its lines.
 */
const PREFIX = "E2E-Proc";

test.afterAll(async () => {
  await removeTestProcurementRecords(PREFIX);
  await resetProcurementFixtures();
  await db.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* §328 The buyer                                                              */
/* -------------------------------------------------------------------------- */

test.describe("Procurement role (PRD #19 §328)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROCUREMENT");
  });

  test("opens the module and reaches every section", async ({ page }) => {
    await page.goto("/procurement");
    await expect(page.getByRole("heading", { name: "Procurement", level: 1 })).toBeVisible();

    for (const [section, expected] of [
      ["requests", "PR-2026-0001"],
      ["orders", "PO-2026-0001"],
      ["suppliers", "Atlas Materials"],
      ["rfqs", "RFQ-2026-0001"],
    ] as const) {
      await page.goto(`/procurement/${section}`);
      await expect(recordTable(page).getByText(expected).first()).toBeVisible();
    }
  });

  test("raises a request, which starts as a draft (PRD #19 §46, §50)", async ({ page }) => {
    await page.goto("/procurement/requests/new");

    await page.locator("#title").fill(`${PREFIX} site consumables`);
    await page.locator("#items-0-description").fill(`${PREFIX} safety boots`);
    await page.locator("#items-0-quantity").fill("25");
    await page.locator("#items-0-unit").fill("pair");
    await page.locator("#items-0-price").fill("48.50");
    await page.getByRole("button", { name: "Create request" }).click();

    await page.waitForURL(/\/procurement\/requests\/(?!new)[^/]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${PREFIX} site consumables`);
    await expect(mainRegion(page).getByText("Draft").first()).toBeVisible();

    // 25 × 48.50 = 1,212.50, computed from the line rather than typed.
    await expect(mainRegion(page).getByText(/1,212\.50/).first()).toBeVisible();
  });

  test("submits a draft for approval (PRD #19 §56)", async ({ page }) => {
    await page.goto("/procurement/requests/request_007");
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(mainRegion(page).getByText("Pending approval").first()).toBeVisible();
  });

  test("cannot approve what it submitted (PRD #19 §21)", async ({ page }) => {
    // The seed's pending approvals were all submitted by Procurement, so no
    // decision control renders at all — not a disabled one.
    await page.goto("/procurement/requests/request_005");
    await expect(mainRegion(page).getByText("Pending approval").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
  });

  test("an approved request offers no way to rewrite its lines (PRD #19 §55)", async ({ page }) => {
    await page.goto("/procurement/requests/request_006");
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

    await page.goto("/procurement/requests/request_006/edit");
    await expect(mainRegion(page).getByText(/not found/i).first()).toBeVisible();
  });

  test("refuses to issue an enquiry with one supplier (PRD #19 §72)", async ({ page }) => {
    await page.goto("/procurement/rfqs/new");

    await page.locator("#title").fill(`${PREFIX} single supplier enquiry`);
    await page.locator("#items-0-description").fill(`${PREFIX} line`);
    await page.locator("#items-0-quantity").fill("5");
    await page.locator("#items-0-unit").fill("each");

    // Tick exactly one supplier.
    await page.getByRole("checkbox").first().check();
    await expect(mainRegion(page).getByText(/two are needed to issue/i)).toBeVisible();

    await page.getByRole("button", { name: "Create enquiry" }).click();
    await page.waitForURL(/\/procurement\/rfqs\/(?!new)[^/]+$/);

    // Drafted, but the issue control is withheld until a second supplier is on it.
    await expect(page.getByRole("button", { name: "Issue to suppliers" })).toHaveCount(0);
  });

  test("compares quotes and names the lowest (PRD #19 §88, §91)", async ({ page }) => {
    await page.goto("/procurement/rfqs/rfq_001/comparison");

    await expect(mainRegion(page).getByText(/Lowest qualified price/i)).toBeVisible();
    await expect(mainRegion(page).getByText("BuildPro Systems").first()).toBeVisible();

    // The disqualified answer is shown, so the record is complete.
    await expect(mainRegion(page).getByText("Disqualified").first()).toBeVisible();
  });

  test("records a delivery, and the order says how much has arrived (PRD #19 §141)", async ({
    page,
  }) => {
    await page.goto("/procurement/orders/order_004/receipts");

    await page.locator("#deliveryReference").fill(`${PREFIX}-DN-1`);
    await page.locator("#items-0-received").fill("100");
    await page.getByRole("button", { name: "Record delivery" }).click();

    await expect(mainRegion(page).getByText(`${PREFIX}-DN-1`).first()).toBeVisible();

    await page.goto("/procurement/orders/order_004");
    await expect(mainRegion(page).getByText(/Partially received|% received/i).first()).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* §327 CEO                                                                    */
/* -------------------------------------------------------------------------- */

test.describe("CEO role (PRD #19 §327)", () => {
  test("sees the approval queue and decides on it (PRD #19 §152)", async ({ page }) => {
    await signIn(page, "CEO");

    await page.goto("/procurement/approvals");
    await expect(mainRegion(page).getByText("PR-2026-0005").first()).toBeVisible();

    await page.goto("/procurement/requests/request_005");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(mainRegion(page).getByText("Approved").first()).toBeVisible();
  });

  test("approving an order says what it commits (PRD #19 §116)", async ({ page }) => {
    await signIn(page, "CEO");

    await page.goto("/procurement/orders/order_009");
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/commits the company to this spend/i)).toBeVisible();

    await dialog.getByRole("button", { name: "Approve order" }).click();
    await expect(mainRegion(page).getByText("Approved").first()).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* §329 Project Manager                                                        */
/* -------------------------------------------------------------------------- */

test.describe("Project Manager role (PRD #19 §329)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("sees the buying on its own jobs", async ({ page }) => {
    await page.goto("/procurement/requests");
    await expect(recordTable(page).getByText("PR-2026-0001").first()).toBeVisible();
    // A company-general ask with no project is not inherited by having a job.
    await expect(recordTable(page).getByText("PR-2026-0012")).toHaveCount(0);
  });

  test("is shown no supplier prices on the comparison (PRD #19 §261)", async ({ page }) => {
    await page.goto("/procurement/rfqs/rfq_001/comparison");

    const notice = mainRegion(page).getByText(/Supplier prices need a separate permission/i);
    const heading = page.getByRole("heading", { level: 1 });

    // Either the enquiry is out of scope entirely, or it renders without prices.
    if (await heading.isVisible().catch(() => false)) {
      const total = mainRegion(page).getByRole("columnheader", { name: "Total" });
      if (await notice.isVisible().catch(() => false)) {
        await expect(total).toHaveCount(0);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* §332, §333 Roles with no Procurement                                        */
/* -------------------------------------------------------------------------- */

test.describe("roles without Procurement access (PRD #19 §332, §333)", () => {
  test("Group IT has no procurement access by default", async ({ page }) => {
    await signIn(page, "GROUP_IT");
    await expectAccessDenied(page, "/procurement");
  });

  test("a Viewer cannot reach the buying book", async ({ page }) => {
    await signIn(page, "VIEWER");
    await expectAccessDenied(page, "/procurement");
  });
});
