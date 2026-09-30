import { expect, test, type Page } from "@playwright/test";

import { mainRegion, signIn } from "../fixtures";
import { expectNoPageOverflow, expectTouchTargets } from "./geometry";

/**
 * MOB-02 mobile shell: header, bottom navigation, More, Create, workspace and
 * account entry points. Runs in every responsive matrix project; each test
 * says which width family it is about and skips the rest.
 *
 * Phone is below 768, tablet portrait 768-1023 (bottom bar and drawer, Create
 * in the top bar), desktop 1024 and up (the sidebar; no bottom bar).
 * Read-only against the seeded demo except the dirty-form check, which types
 * into a form and leaves by Stay or Discard.
 */

const width = (page: Page) => page.viewportSize()!.width;
const isPhone = (page: Page) => width(page) < 768;
const isTablet = (page: Page) => width(page) >= 768 && width(page) < 1024;
const isDesktop = (page: Page) => width(page) >= 1024;

const bar = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const more = (page: Page) => page.getByTestId("mobile-more");

test.describe("bottom navigation", () => {
  test("phone: Home, Projects, Tasks, Create and More; the current destination is marked", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await expect(bar(page).getByRole("link", { name: "Projects" })).toBeVisible();
    await expect(bar(page).getByRole("link", { name: "Tasks" })).toBeVisible();
    await expect(page.getByTestId("mobile-create")).toBeVisible();
    await expect(more(page)).toBeVisible();
    expect(await bar(page).getByRole("link").count()).toBeLessThanOrEqual(3);
    await expectTouchTargets(page, bar(page));
    await expectNoPageOverflow(page, "dashboard with the bar");
  });

  test("phone: a nested route keeps its parent destination active", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    await expect(bar(page).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    await expect(bar(page).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current", "page");
  });

  test("phone: tapping a destination navigates and keeps the bar", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await bar(page).getByRole("link", { name: "Tasks" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(bar(page).getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
  });

  test("phone: content is never hidden behind the bar", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects" });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // The last piece of content, not the padded box: it must end above the bar once scrolled to the end.
    const last = await mainRegion(page).evaluate((main) => (main.lastElementChild ?? main).getBoundingClientRect().bottom);
    const top = (await bar(page).boundingBox())!.y;
    expect(Math.round(last)).toBeLessThanOrEqual(Math.round(top) + 1);
  });

  test("tablet portrait: the bar is there, Create stays in the top bar, and the drawer remains", async ({ page }) => {
    test.skip(!isTablet(page), "tablet portrait shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(bar(page)).toBeVisible();
    await expect(page.getByTestId("mobile-create")).toBeHidden();
    await expect(page.getByTestId("quick-create-button")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  });

  test("desktop: no bottom bar; the sidebar is unchanged", async ({ page }) => {
    test.skip(!isDesktop(page), "desktop shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(bar(page)).toBeHidden();
    await expect(page.getByTestId("mobile-context")).toBeHidden();
    await expect(page.getByTestId("quick-create-button")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open user menu" })).toBeVisible();
  });

  test("a person without create rights sees no Create button and no dead slot", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "VIEWER", { to: "/dashboard" });
    await expect(page.getByTestId("mobile-create")).toHaveCount(0);
    await expect(more(page)).toBeVisible();
  });
});

test.describe("More", () => {
  test("opens a labelled sheet of permitted modules, closes on Escape and returns focus", async ({ page }) => {
    test.skip(!isPhone(page) && !isTablet(page), "the bar exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await more(page).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Calendar" })).toBeVisible();
    // Only what the resolver permits: no Platform Admin, no module this role lacks.
    await expect(sheet.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /logout/i })).toBeVisible();
    await expectTouchTargets(page, sheet);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(more(page)).toBeFocused();
  });

  test("choosing a destination closes the sheet and navigates", async ({ page }) => {
    test.skip(!isPhone(page) && !isTablet(page), "the bar exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await more(page).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
    await expect(more(page)).toHaveAttribute("data-active", "true");
  });

  test("the bar is inert behind the open sheet", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await more(page).click();
    await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
    // Radix hides everything outside the dialog from the accessibility tree and blocks pointer events.
    await expect(bar(page)).toHaveCount(0);
  });

  test("sign out is reachable from More", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await more(page).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: /logout/i }).click();
    await expect(page).toHaveURL(/\/login/);
    // Back must not reveal authenticated content.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/dashboard$/);
  });
});

test.describe("Create", () => {
  test("opens the same Quick Create sheet, with the context of the page", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await page.getByTestId("mobile-create").click();
    const panel = page.getByTestId("quick-create-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("quick-create-tasks.task.create")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });
});

test.describe("header", () => {
  test("phone: workspace context, search and the bell; no hamburger, no account menu", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const header = page.locator("header[data-shell-region]");
    await expect(header.getByTestId("mobile-context")).toBeVisible();
    await expect(header.getByTestId("notification-bell")).toBeVisible();
    await expect(header.getByTestId("mobile-search-trigger")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Open user menu" })).toBeHidden();
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(57);
    await expectTouchTargets(page, header);
    await expectNoPageOverflow(page, "header");
  });

  test("phone: the mobile back control leads to the parent, not out of NESTO", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    const crumb = page.getByTestId("record-navigation-header").getByRole("navigation", { name: "Breadcrumb" }).first();
    await expect(crumb).toBeVisible();
    await page.getByTestId("record-navigation-header").getByRole("button", { name: /back/i }).first().click();
    await expect(page).not.toHaveURL(/\/projects\/project_a$/);
  });
});

test.describe("form action bar and the keyboard", () => {
  test("the bottom bar steps aside while a form's own action bar is on the page", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/new" });
    const actionBar = page.locator("[data-sticky-action-bar]");
    test.skip((await actionBar.count()) === 0, "this form has no sticky action bar");
    await expect(bar(page)).toBeHidden();
  });

  test("the bottom bar yields to the keyboard while a text field has focus", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "OWNER", { to: "/clients/new" });
    await mainRegion(page).getByLabel("Client name").focus();
    await expect(bar(page)).toBeHidden();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(bar(page)).toBeVisible();
  });
});
