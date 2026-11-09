import { expect, test, type Page } from "@playwright/test";

import { db } from "../db";
import { DEMO_PASSWORD, dropOrphanedStreamSegments, mainRegion } from "../fixtures";
import { SOLO_COMPANY, SOLO_OWNER } from "../../../prisma/seed/fixtures/constants";

/**
 * A single company's Projects page: the title and the cards, Active first.
 * There is no breadcrumb bar, no section tabs, no explainer, no search and no
 * list view, and a search left in the address is dropped. Solo Studio is the
 * fixture tenant of one company. It has no projects of its own, so this spec
 * adds two and removes them again.
 */

const PREFIX = "e2e-solo-";
const cards = (page: Page) => mainRegion(page).getByTestId("project-card");

async function signInSolo(page: Page) {
  await dropOrphanedStreamSegments(page);
  await page.goto("/login");
  await page.getByLabel("Username").fill(SOLO_OWNER.username);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function removeProjects() {
  await db.project.deleteMany({ where: { companyId: SOLO_COMPANY, code: { startsWith: PREFIX } } });
}

test.beforeAll(async () => {
  await removeProjects();
  // Created Pending first, so the order on the page is the page's own: Active on top.
  await db.project.create({ data: { companyId: SOLO_COMPANY, code: `${PREFIX}pending`, name: "Solo Pending Villa", status: "PENDING", createdBy: SOLO_OWNER.id } });
  await db.project.create({ data: { companyId: SOLO_COMPANY, code: `${PREFIX}active`, name: "Solo Active Tower", status: "ACTIVE", createdBy: SOLO_OWNER.id } });
});

test.afterAll(async () => {
  await removeProjects();
  await db.$disconnect();
});

test("a single company's Projects page is only its cards, Active first", async ({ page }) => {
  await signInSolo(page);
  await page.goto("/projects?q=Villa");
  // A search left in the address is dropped: there is no search to keep it in.
  await expect(page).toHaveURL(/\/projects$/);

  const main = mainRegion(page);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Projects");
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).getByTestId("project-card-link")).toHaveText(["Solo Active Tower", "Solo Pending Villa"]);

  // Nothing but the cards: no breadcrumb bar, tabs, explainer, search or list view.
  await expect(page.getByTestId("record-navigation-header")).toBeHidden();
  await expect(page.locator("[data-context-tabs]")).toHaveCount(0);
  await expect(main.getByTestId("projects-search")).toHaveCount(0);
  await expect(main.getByTestId("projects-view-list")).toHaveCount(0);
  await expect(main.getByText("What is this?")).toHaveCount(0);
  await expect(main.getByTestId("project-gallery")).toHaveAttribute("data-view", "cards");

  // The sticky stack starts straight under the top bar.
  const height = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--nesto-shell-breadcrumb-h").trim());
  expect(height).toBe("0px");
});
