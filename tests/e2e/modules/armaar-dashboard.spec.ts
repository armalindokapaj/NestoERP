import { expect, test, type Page } from "@playwright/test";

import { DEMO_PASSWORD } from "../../../config/demo-accounts";
import { mainRegion, signIn } from "../fixtures";

/**
 * The ARMAAR Group demo tenant's executive dashboard (D-01 §25-§36, §66, §69,
 * §84, §97). ARMAAR's people sign in with their own password; in development
 * and tests it is the demo's.
 */

async function signInAs(page: Page, username: string) {
  await page.goto("/login?callbackUrl=%2Fdashboard");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(process.env.ARMAAR_DEMO_PASSWORD ?? DEMO_PASSWORD);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("the Group Owner lands on the group: its identity, figures, key projects and the demo notice (§26-§31, §69)", async ({ page }) => {
  await signInAs(page, "armaar.owner");
  const hero = mainRegion(page).getByTestId("group-hero");
  await expect(hero.getByRole("heading", { name: "ARMAAR GROUP" })).toBeVisible();
  await expect(hero).toContainText("NIPT M01517007J");
  await expect(hero.getByRole("note")).toContainText("synthetic operational data");
  await expect(page.getByTestId("demo-notice")).toBeVisible();

  const companies = mainRegion(page).getByRole("link", { name: /Group Companies/ });
  await expect(companies).toContainText("13");
  await expect(companies).toContainText("9 active · 4 suspended");

  const lake = mainRegion(page).getByTestId("key-project").filter({ hasText: "Tirana Lake" });
  await expect(lake).toContainText("BUILDING CONSTRUCTION INVEST");
  await expect(lake).toContainText("62%");
  await expect(lake.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");

  const list = mainRegion(page).getByRole("region", { name: "Group Companies" });
  await expect(list.getByText("SKYLINE TOWERS")).toBeVisible();
  await expect(mainRegion(page).getByRole("region", { name: "Recent Activity" }).getByRole("listitem").first()).toBeVisible();
});

test("a company's own finance manager sees their company, not the group (§66)", async ({ page }) => {
  await signInAs(page, "bci.finance");
  await expect(mainRegion(page).getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(mainRegion(page).getByTestId("group-hero")).toHaveCount(0);
  await expect(mainRegion(page).getByTestId("key-project")).toHaveCount(0);
  // Still a demo tenant: every page says so.
  await expect(page.getByTestId("demo-notice")).toBeVisible();
});

test("the five-company demo is not a demo tenant: no notice (§69)", async ({ page }) => {
  await signIn(page, "OWNER", { to: "/dashboard" });
  await expect(mainRegion(page).getByTestId("group-hero")).toContainText("NESTO");
  await expect(page.getByTestId("demo-notice")).toHaveCount(0);
});

test("the group's dashboard stacks on a phone without scrolling sideways (§84)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, "armaar.owner");
  await expect(mainRegion(page).getByTestId("group-hero")).toBeVisible();
  await expect(mainRegion(page).getByTestId("key-project").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
