import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { mainRegion, signIn } from "../fixtures";
import { expectNoPageOverflow } from "./geometry";

/**
 * MOB-05 Projects & Project workspace (§7-§36, §57-§58, §98): the Projects
 * gallery with its list alternative, the phone project identity, the phone
 * Overview, and project switching that keeps the section. Read-only against
 * the seeded demo; runs in every responsive matrix project.
 */

const isPhone = (page: Page) => page.viewportSize()!.width < 640;

test("Projects: cards name the company, the list alternative keeps it, nothing scrolls sideways", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects" });
  const gallery = mainRegion(page).getByTestId("project-gallery");
  await expect(gallery).toBeVisible();
  const first = gallery.getByTestId("project-card").first();
  await expect(first.getByTestId("project-company")).not.toBeEmpty();
  await expectNoPageOverflow(page);

  await mainRegion(page).getByTestId("projects-view-list").click();
  await expect(gallery).toHaveAttribute("data-view", "list");
  await expect(gallery.getByTestId("project-card").first().getByTestId("project-company")).not.toBeEmpty();
  await expectNoPageOverflow(page);
  await mainRegion(page).getByTestId("projects-view-cards").click();
  await expect(gallery).toHaveAttribute("data-view", "cards");
});

test("Projects: a search with no match says so and offers the way back", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects?q=zzzz-no-such-project" });
  await expect(mainRegion(page).getByText(/no projects found|no project you can open/i).first()).toBeVisible();
});

test("Project workspace: phone identity, tabs and Overview", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
  const main = mainRegion(page);
  await expect(main.getByRole("heading", { level: 2 }).first()).toBeVisible();
  // Below 1024px the project's compact header names it, phones and tablets alike.
  if (page.viewportSize()!.width < 1024) await expect(page.getByTestId("project-phone-identity")).toBeVisible();
  else await expect(page.getByTestId("project-phone-identity")).toBeHidden();
  if (isPhone(page)) {
    await expect(page.getByTestId("project-phone-company")).not.toBeEmpty();
    await expect(page.getByTestId("project-mobile-overview")).toBeVisible();
    await expect(page.getByTestId("project-attention").or(main.getByText(/nothing needs attention|asgjë nuk kërkon/i)).first()).toBeVisible();
    await expect(page.getByTestId("project-metrics")).toBeVisible();
    await expect(page.getByTestId("project-quick-actions").locator("a").first()).toHaveAttribute("href", /projectId=project_a|daily-logs\/new/);
  } else {
    await expect(page.getByTestId("project-mobile-overview")).toBeHidden();
  }
  await expectNoPageOverflow(page);
});

test("Project Overview below 1024px: the ⋯ follows the status on the header's line and holds What is this?", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 1024, "phones and tablets; from 1024px the ⋯ is on the hero (next test)");
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
  const identity = page.getByTestId("project-phone-identity");
  await expect(identity).toBeVisible();
  const status = identity.getByTestId("project-status");
  const more = page.locator("[data-context-tabs]").getByRole("button", { name: "More project actions" });
  await expect(more).toBeVisible();
  // One line: the ⋯ right after the status, on its level, and nothing else on its own row.
  const [pill, dots] = [(await status.boundingBox())!, (await more.boundingBox())!];
  expect(dots.x).toBeGreaterThan(pill.x + pill.width - 1);
  expect(Math.abs(dots.y + dots.height / 2 - (pill.y + pill.height / 2))).toBeLessThanOrEqual(12);
  await expect(mainRegion(page).getByTestId("help-projects.detail.relationships")).toBeHidden();
  // The name once: no visible heading repeats it under the header.
  await expect(mainRegion(page).getByRole("heading", { level: 1 })).toHaveCount(1);
  expect((await mainRegion(page).getByRole("heading", { level: 1 }).boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);

  await more.click();
  await page.getByRole("menuitem", { name: "What is this?" }).click();
  const dialog = page.getByTestId("page-help-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("opens from the tabs of this project");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expectNoPageOverflow(page);
});

test("Project Overview from 1024px: the ⋯ follows the status on the hero, holds What is this?, and the tab row is the tabs alone", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1024, "desktop; below 1024px the ⋯ follows the status in the compact header");
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
  const line = mainRegion(page).getByTestId("project-hero-status-line");
  const more = line.getByRole("button", { name: "More project actions" });
  await expect(more).toBeVisible();
  // One project menu on the page: the compact header's copy is not mounted from lg, and the tab row has no controls.
  await expect(page.getByRole("button", { name: "More project actions" })).toHaveCount(1);
  await expect(page.locator("[data-context-tabs-trailing]")).toBeHidden();
  await expect(mainRegion(page).getByTestId("help-projects.detail.relationships")).toBeHidden();
  // Right after the status, on its line, and the line no taller for it.
  const [status, dots] = [(await line.getByTestId("project-hero-status").boundingBox())!, (await more.boundingBox())!];
  expect(dots.x).toBeGreaterThan(status.x + status.width - 1);
  expect(dots.x - (status.x + status.width)).toBeLessThanOrEqual(24);
  expect(Math.abs(dots.y + dots.height / 2 - (status.y + status.height / 2))).toBeLessThanOrEqual(8);
  expect((await line.boundingBox())!.height).toBeLessThanOrEqual(24);

  await more.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "What is this?" }).click();
  const dialog = page.getByTestId("page-help-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("opens from the tabs of this project");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("A module page from 1024px: Help and What is this? are in the ⋯ right after the title", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1024, "desktop; below 1024px the ⋯ ends the title's row (next test)");
  await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
  const header = mainRegion(page).locator('[data-page-header="module"]');
  await expect(header.getByTestId("module-help-entry")).toBeHidden();
  const more = header.getByTestId("page-menu");
  await expect(more).toBeVisible();
  const [title, dots] = [(await header.locator("[data-page-title]").boundingBox())!, (await more.boundingBox())!];
  // On the title's line, right after the title, not a row of its own.
  expect(dots.y).toBeLessThan(title.y + title.height);
  expect(dots.x).toBeGreaterThan(title.x + title.width - 1);
  expect(dots.x - (title.x + title.width)).toBeLessThanOrEqual(24);
  await expect(mainRegion(page).getByTestId("help-lists.search-filters")).toBeHidden();
  await more.click();
  await expect(page.getByRole("menuitem", { name: "What is this?" })).toBeVisible();
  await page.getByRole("menuitem", { name: /^Help/ }).click();
  await expect(page).toHaveURL(/\/help\/tasks/);
});

test("A module page below 1024px: Help is in the ⋯ at the end of the title's line, not a row of its own", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 1024, "phones and tablets");
  await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
  const header = mainRegion(page).locator('[data-page-header="module"]');
  await expect(header.getByTestId("module-help-entry")).toBeHidden();
  const more = header.getByTestId("page-menu");
  await expect(more).toBeVisible();
  const [title, dots] = [(await header.locator("[data-page-title]").boundingBox())!, (await more.boundingBox())!];
  expect(dots.y).toBeLessThan(title.y + title.height);
  // The tasks list's "What is this?" is in the same menu, not on the page.
  await expect(mainRegion(page).getByTestId("help-lists.search-filters")).toBeHidden();
  await more.click();
  await expect(page.getByRole("menuitem", { name: "What is this?" })).toBeVisible();
  await page.getByRole("menuitem", { name: /^Help/ }).click();
  await expect(page).toHaveURL(/\/help\/tasks/);
});

test("Project section below 1024px: the project is named once, in the compact header (name, code, company, status)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/tasks" });
  const identity = page.getByTestId("project-phone-identity");
  if (page.viewportSize()!.width < 1024) {
    await expect(identity).toBeVisible();
    await expect(identity.getByTestId("project-phone-code")).not.toBeEmpty();
    await expect(identity.getByTestId("project-phone-company")).not.toBeEmpty();
    await expect(identity.getByTestId("project-status")).toBeVisible();
    // The section's own header keeps the page's heading for screen readers, and draws no second name.
    const title = mainRegion(page).locator('[data-page-header="context"] [data-page-title]').first();
    expect((await title.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
  } else {
    await expect(identity).toBeHidden();
  }
  await expectNoPageOverflow(page);
});

test("Project workspace: a deep link opens the section and the switcher keeps it", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/tasks" });
  await expect(page).toHaveURL(/\/projects\/project_a\/tasks/);
  const trigger = page.locator("[data-shell-breadcrumb]").getByRole("button", { name: /project_a|—/i }).last();
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
    const other = page.getByRole("menuitem").filter({ hasNot: page.locator("[aria-current=page]") }).first();
    if (await other.count()) await expect(other.locator("a")).toHaveAttribute("href", /\/projects\/[^/]+\/tasks$/);
  }
  await expectNoPageOverflow(page);
});

test("Project workspace: axe finds no violations on the phone Overview", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
  await expect(mainRegion(page).getByRole("heading", { level: 2 }).first()).toBeVisible();
  const results = await new AxeBuilder({ page }).include("main").disableRules(["color-contrast"]).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});
