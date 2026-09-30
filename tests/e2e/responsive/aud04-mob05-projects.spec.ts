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
  if (isPhone(page)) {
    await expect(page.getByTestId("project-phone-identity")).toBeVisible();
    await expect(page.getByTestId("project-phone-company")).not.toBeEmpty();
    await expect(page.getByTestId("project-mobile-overview")).toBeVisible();
    await expect(page.getByTestId("project-attention").or(main.getByText(/nothing needs attention|asgjë nuk kërkon/i)).first()).toBeVisible();
    await expect(page.getByTestId("project-metrics")).toBeVisible();
    await expect(page.getByTestId("project-quick-actions").locator("a").first()).toHaveAttribute("href", /projectId=project_a|daily-logs\/new/);
  } else {
    await expect(page.getByTestId("project-phone-identity")).toBeHidden();
    await expect(page.getByTestId("project-mobile-overview")).toBeHidden();
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
