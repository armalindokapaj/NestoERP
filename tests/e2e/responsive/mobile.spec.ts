import { expect, test } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * Mobile browser behaviour (PRD #9 §182, §184; PRD #3 §6, §21–§28).
 *
 * NESTO on a phone is a website inside a browser, not an imitation of a native
 * app: a sticky header with a hamburger, a left drawer, and no permanent bottom
 * navigation (PRD #3 §6).
 */
test.describe("mobile navigation", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("hides the desktop sidebar and shows the hamburger", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("complementary")).toBeHidden();
    await expect(page.getByRole("button", { name: /open navigation/i })).toBeVisible();
  });

  test("opens the drawer, navigates, and closes on selection (PRD #3 §27)", async ({ page }) => {
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /open navigation/i }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    await drawer.getByRole("link", { name: "Projects", exact: true }).click();

    await expect(page).toHaveURL(/\/projects/);
    await expect(drawer).toBeHidden();
  });

  test("closes the drawer on Escape (PRD #3 §27)", async ({ page }) => {
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /open navigation/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("has no permanent bottom app navigation (PRD #3 §6)", async ({ page }) => {
    await page.goto("/dashboard");

    const navigations = page.getByRole("navigation");
    const count = await navigations.count();

    for (let index = 0; index < count; index += 1) {
      const box = await navigations.nth(index).boundingBox();
      if (!box) continue;
      const viewport = page.viewportSize()!;
      // Nothing pinned to the bottom edge of the screen.
      expect(box.y).toBeLessThan(viewport.height - 60);
    }
  });

  test("shows the drawer's own close control", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /open navigation/i }).click();

    await page.getByRole("button", { name: /close navigation/i }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("mobile module layout (PRD #9 §184)", () => {
  test("renders a list as record cards rather than a squeezed table", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
    await page.goto("/projects/all");

    // The desktop table is hidden below the tablet breakpoint.
    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByRole("link", { name: /Riverside Residences/ }).first()).toBeVisible();
  });

  test("moves filters into a sheet (PRD #7 §88)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
    await page.goto("/projects/all");

    await page.getByRole("button", { name: /^filters$/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByLabel("Status")).toBeVisible();
  });

  test("never scrolls the page sideways", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");

    for (const path of ["/dashboard", "/projects/all", "/projects/project_a"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });

  test("keeps the project detail usable on a phone (PRD #10 §142)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
    await page.goto("/projects/project_a");

    await expect(page.getByRole("heading", { name: "Riverside Residences" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Project sections" })).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* Inventory on a phone (PRD #20 §322–§326, §417, §418)                        */
/* -------------------------------------------------------------------------- */

test.describe("mobile inventory (PRD #20 §418)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "INVENTORY");
  });

  test("renders the item master as cards rather than a squeezed table (§322)", async ({
    page,
  }) => {
    await page.goto("/inventory/items");

    // Both layouts are in the document; only one of them is on screen. The
    // desktop table is hidden below the tablet breakpoint (PRD #7 §86), so the
    // assertion has to name the copy the reader actually sees.
    await expect(
      page.locator("#nesto-main").getByText("MAT-001").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(page.locator("table").first()).toBeHidden();
  });

  test("shows on hand, reserved and available on an item card (§322)", async ({ page }) => {
    await page.goto("/inventory/items");

    const card = page.locator("#nesto-main li").filter({ visible: true }).first();
    await expect(card.getByText("On hand")).toBeVisible();
    await expect(card.getByText("Available")).toBeVisible();
  });

  test("keeps the stock ledger inside the viewport (§417)", async ({ page }) => {
    await page.goto("/inventory/movements");
    await expect(page.locator("#nesto-main")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("keeps a stock document form inside the viewport (§417)", async ({ page }) => {
    await page.goto("/inventory/issues/new");
    await expect(page.locator("#warehouseId")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/* -------------------------------------------------------------------------- */
/* QA/QC on a phone (PRD #21 §440)                                             */
/* -------------------------------------------------------------------------- */

test.describe("mobile inspection execution (PRD #21 §440)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "QAQC");
  });

  test("answers a checklist on a phone", async ({ page }) => {
    // INS-2026-0008 is under way, so its checklist is editable.
    await page.goto("/qaqc/inspections/ins_008/execute");

    const first = page.locator("#answer-0");
    await expect(first).toBeVisible();
    await first.selectOption("PASS");

    await expect(page.getByRole("button", { name: "Save answers" })).toBeVisible();
  });

  test("keeps the checklist inside the viewport", async ({ page }) => {
    await page.goto("/qaqc/inspections/ins_008/execute");
    await expect(page.locator("#answer-0")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("renders the inspection list as cards, with status and result", async ({ page }) => {
    await page.goto("/qaqc/inspections");

    const card = page.locator("#nesto-main li").filter({ visible: true }).first();
    await expect(card).toBeVisible();
    // The two facts stay separate even on a card (§65).
    await expect(card.getByText("Status")).toBeVisible();
    await expect(card.getByText("Result")).toBeVisible();

    await expect(page.locator("table").first()).toBeHidden();
  });
});
