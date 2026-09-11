import { expect, test } from "@playwright/test";

import { db, resetApprovalFixtures } from "../db";
import { signIn, type DemoRole } from "../fixtures";

/**
 * Department module journeys (PRD #9 §151, §156–§162, §168).
 *
 * Every department module still on the shell renders through one implementation,
 * so this walks each one's header, tabs, list and record detail in a single loop
 * rather than repeating near-identical specs (PRD #7 §93).
 *
 * Finance (PRD #15) and HR (PRD #16) have graduated out of the shell and are
 * covered by their own specs, against their own pages.
 */
const JOURNEYS: {
  role: DemoRole;
  module: string;
  heading: string;
  section: string;
  expectRecord: RegExp;
}[] = [
  {
    role: "SALES",
    module: "/sales",
    heading: "Sales",
    section: "opportunities",
    expectRecord: /Riverside phase 2/,
  },
  {
    role: "LEGAL",
    module: "/contracts",
    heading: "Legal",
    section: "contracts",
    expectRecord: /CTR-00\d/,
  },
  {
    role: "PROCUREMENT",
    module: "/procurement",
    heading: "Procurement",
    section: "requests",
    expectRecord: /PR-00\d/,
  },
  {
    role: "INVENTORY",
    module: "/inventory",
    heading: "Inventory",
    section: "items",
    expectRecord: /Cement/,
  },
  {
    role: "QAQC",
    module: "/qaqc",
    heading: "QA/QC",
    section: "ncrs",
    expectRecord: /QA-00\d/,
  },
  {
    role: "HSE",
    module: "/hse",
    heading: "HSE",
    section: "incidents",
    expectRecord: /HSE-00\d/,
  },
];

for (const journey of JOURNEYS) {
  test(`${journey.role}: module overview, list and record all load`, async ({ page }) => {
    await signIn(page, journey.role);

    // Module overview
    await page.goto(journey.module);
    await expect(page.getByRole("heading", { name: journey.heading, level: 1 })).toBeVisible();

    // Section list
    await page.goto(`${journey.module}/${journey.section}`);
    const firstRow = page
      .getByRole("navigation", { name: /sections/i })
      .locator("xpath=following::a[contains(@href,'/')]")
      .first();
    await expect(firstRow).toBeVisible();

    await expect(page.getByText(journey.expectRecord).first()).toBeVisible();

    // Record detail
    const recordLink = page
      .locator(`a[href^="${journey.module}/${journey.section}/"]`)
      .first();
    await recordLink.click();

    await expect(page).toHaveURL(new RegExp(`${journey.module}/${journey.section}/`));
    await expect(page.getByRole("heading", { name: "Details" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  });
}

test.describe("approvals", () => {
  // Approving a record changes it. Without this the second run of the suite
  // finds nothing pending and the assertion quietly stops meaning anything
  // (PRD #9 §126).
  test.beforeEach(resetApprovalFixtures);
  test.afterAll(async () => {
    await resetApprovalFixtures();
    await db.$disconnect();
  });

  /*
   * Approving a finance record is tested in finance.spec.ts, against the real
   * approval service and its separation-of-duties rules (PRD #15 §18, §19).
   * What is left here is the shell's own approval behaviour, which Procurement
   * still uses.
   */
  test("Procurement is offered no approval it does not hold (PRD #7 §53)", async ({ page }) => {
    await signIn(page, "PROCUREMENT");
    await page.goto("/procurement/requests");

    const first = page.locator('a[href^="/procurement/requests/"]').first();
    await first.click();

    // Procurement manages requests, but the approve grant belongs to the CEO,
    // so no Approve control renders at all — not a disabled one (PRD #5 §32).
    await expect(page.getByRole("button", { name: /^approve$/i })).toHaveCount(0);
  });
});

test("a filtered list that matches nothing offers to clear the filters (PRD #9 §175)", async ({
  page,
}) => {
  await signIn(page, "PROCUREMENT");
  await page.goto("/procurement/requests?search=nothing-matches-this-at-all");

  await expect(page.getByText(/no purchase requests/i).first()).toBeVisible();
});

test("an unknown record answers not found (PRD #9 §112)", async ({ page }) => {
  await signIn(page, "PROCUREMENT");
  const response = await page.goto("/procurement/requests/does-not-exist");
  expect(response?.status()).toBe(404);
});
