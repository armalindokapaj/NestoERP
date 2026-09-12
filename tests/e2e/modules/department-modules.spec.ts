import { expect, test } from "@playwright/test";

import { db, resetApprovalFixtures } from "../db";
import { signIn, type DemoRole } from "../fixtures";

/**
 * The generic record shell (PRD #9 §151, §156–§162, §168).
 *
 * Every *department* module has graduated to services of its own — Finance
 * (#15), HR (#16), Sales (#17), Legal (#18), Procurement (#19), Inventory (#20),
 * QA/QC (#21) and HSE (#22) — and each is covered by its own spec against its
 * own pages.
 *
 * What still renders through the shell is the platform's own support queue, so
 * that is what these tests walk. They are not about support: they are about the
 * shell's header, tabs, list, record detail, filtered-empty state and 404, which
 * any future module will inherit before it earns a domain.
 */
const JOURNEYS: {
  role: DemoRole;
  module: string;
  heading: string;
  section: string;
  expectRecord: RegExp;
}[] = [
  {
    role: "ADMIN",
    module: "/support",
    heading: "Support",
    section: "requests",
    expectRecord: /SUP-00\d/,
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
   * Approving a real record is tested in each module's own spec, against its
   * own approval service and its separation-of-duties rules. What is left here
   * is the shell's own behaviour: a section with no approve grant renders no
   * Approve control at all — not a disabled one (PRD #5 §32, PRD #7 §53).
   */
  test("a section with no approval grant offers no Approve control (PRD #7 §53)", async ({
    page,
  }) => {
    await signIn(page, "ADMIN");
    await page.goto("/support/requests");

    const first = page.locator('a[href^="/support/requests/"]').first();
    await first.click();

    await expect(page.getByRole("button", { name: /^approve$/i })).toHaveCount(0);
  });
});

test("a filtered list that matches nothing offers to clear the filters (PRD #9 §175)", async ({
  page,
}) => {
  await signIn(page, "ADMIN");
  await page.goto("/support/requests?search=nothing-matches-this-at-all");

  await expect(page.getByRole("link", { name: /clear filters/i }).first()).toBeVisible();
});

test("an unknown record answers not found (PRD #9 §112)", async ({ page }) => {
  await signIn(page, "ADMIN");
  const response = await page.goto("/support/requests/does-not-exist");
  expect(response?.status()).toBe(404);
});
