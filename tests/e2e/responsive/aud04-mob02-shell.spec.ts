import { expect, test, type Locator, type Page } from "@playwright/test";

import { currentSection, mainRegion, openSectionMenu, sectionRow, signIn } from "../fixtures";
import { expectNoPageOverflow, expectTouchTargets } from "./geometry";

/**
 * The phone shell (docs/ui/UI-04-navigation-layouts.md §Phone), below 1024px.
 * Runs in every responsive matrix project; each test says which width family
 * it is about and skips the rest.
 *
 * Phone is below 768, tablet portrait 768–1023 (the same shell), desktop 1024
 * and up (the Ribbon; no phone bar).
 *
 * The bar holds Home, Projects, New, Sales units and Menu, the place you are
 * in marked; it keeps one height whatever the page does. The top bar is where you are,
 * search and Inbox: the page's name, or inside a project the project's, which
 * switches project; Back when you are deeper than a place's first page. A
 * page's sections are the row under the top bar. New opens Quick Create on
 * the bar, the field's first; Inbox holds approvals and alerts; Menu the
 * departments, search and you.
 *
 * Read-only against the seeded demo except the form checks, which type into a
 * form and leave it.
 */

const width = (page: Page) => page.viewportSize()!.width;
const isPhone = (page: Page) => width(page) < 768;
const isTablet = (page: Page) => width(page) >= 768 && width(page) < 1024;
const isDesktop = (page: Page) => width(page) >= 1024;

const bar = (page: Page) => page.getByTestId("phone-navigation");
const place = (page: Page, name: "home" | "projects" | "units" | "menu") => bar(page).getByTestId(`phone-place-${name}`);
const header = (page: Page) => page.locator("header[data-shell-region]");
const inbox = (page: Page) => header(page).getByTestId("phone-inbox");

/** A sheet drops or rises into place: it is measured once it has landed. */
async function landed(popup: Locator) {
  await popup.evaluate((element) => Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => undefined));
}

test.describe("the bar", () => {
  test("phone and tablet: Home, Projects, New, Sales units and Menu, the one you are in marked", async ({ page }) => {
    test.skip(isDesktop(page), "the bar exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/my-day" });
    await expect(bar(page)).toBeVisible();
    await expect(bar(page)).toHaveAttribute("data-mobile-bottom-nav", "bar");
    for (const [name, label] of [["home", "Home"], ["projects", "Projects"], ["units", "Sales units"], ["menu", "Menu"]] as const) {
      await expect(place(page, name)).toHaveAccessibleName(label);
    }
    await expect(bar(page).getByTestId("phone-create")).toHaveAccessibleName("New");
    // Sales units right after New.
    await expect(bar(page).locator("li").nth(3)).toContainText("Sales units");
    await expect(bar(page).locator("li")).toHaveCount(5);
    await expect(bar(page).getByTestId("phone-inbox")).toHaveCount(0);
    await expect(place(page, "home")).toHaveAttribute("aria-current", "page");
    await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(1);
    await expectTouchTargets(page, bar(page));
    await expectNoPageOverflow(page, "My Day with the bar");
  });

  test("phone: a page marks the place it belongs to", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/tasks" });
    await expect(place(page, "projects")).toHaveAttribute("aria-current", "page");
    // Inbox's pages mark Inbox, in the top bar; no place in the bar.
    await page.goto("/approvals");
    await expect(inbox(page)).toHaveAttribute("aria-current", "page");
    await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(0);
    await page.goto("/calendar");
    await expect(place(page, "menu")).toHaveAttribute("aria-current", "page");
    await page.goto("/dashboard");
    await expect(place(page, "home")).toHaveAttribute("aria-current", "page");
  });

  test("a person without create rights sees no New; the cells share the bar equally", async ({ page }) => {
    test.skip(isDesktop(page), "the bar exists below 1024");
    await signIn(page, "VIEWER", { to: "/my-day" });
    await expect(place(page, "menu")).toBeVisible();
    await expect(page.getByTestId("phone-create")).toHaveCount(0);
    // Sales units is there for whoever may see units.
    const cells = await bar(page).locator("li").count();
    expect(cells).toBe((await place(page, "units").count()) ? 4 : 3);
    const widths = await bar(page).locator("li").evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().width)));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  });

  test("phone: content is never hidden behind the bar", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects" });
    await expect(mainRegion(page).getByTestId("project-card").first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // The last piece of content, not the padded box: it ends above the bar once scrolled to the end.
    const last = await mainRegion(page).evaluate((main) => ([...main.children].at(-1) ?? main).getBoundingClientRect().bottom);
    const top = (await bar(page).boundingBox())!.y;
    expect(Math.round(last)).toBeLessThanOrEqual(Math.round(top) + 1);
  });

  test("phone: the bar keeps one height and its labels while the page scrolls, either way", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    await expect(mainRegion(page).getByRole("heading", { level: 1 }).first()).toBeVisible();
    // A page long enough to scroll, whatever the seed holds.
    await mainRegion(page).evaluate((main) => (main.style.minHeight = "400vh"));
    const cells = bar(page).locator("ul");
    expect(Math.round((await cells.boundingBox())!.height)).toBe(64);
    for (const y of [600, 1200, 400]) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(250);
      expect(Math.round((await cells.boundingBox())!.height)).toBe(64);
      await expect(place(page, "projects")).toHaveText("Projects");
    }
  });

  test("tablet portrait: the same bar; no Create in the top bar", async ({ page }) => {
    test.skip(!isTablet(page), "tablet portrait shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/my-day" });
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByTestId("phone-create")).toBeVisible();
    await expect(page.getByTestId("quick-create-button")).toBeHidden();
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  });

  test("desktop: no phone bar; the Ribbon is the navigation", async ({ page }) => {
    test.skip(!isDesktop(page), "desktop shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(bar(page)).toBeHidden();
    await expect(sectionRow(page)).toBeHidden();
    await expect(page.locator("[data-ribbon]")).toBeVisible();
    // Create floats at the bottom right; Units is no longer in the top bar.
    await expect(page.getByTestId("quick-create-button")).toBeVisible();
    await expect(page.getByTestId("topbar-units")).toHaveCount(0);
    await expect(page.getByTestId("account-trigger")).toBeVisible();
    await expect(page.getByTestId("global-actions").getByTestId("notification-bell")).toBeVisible();
    await expect(mainRegion(page).getByTestId("home-tasks")).toBeHidden();
  });
});

test.describe("Projects", () => {
  test("phone: Projects opens the project you were last in; before any, the list", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/my-day" });
    await expect(place(page, "projects")).toHaveAttribute("href", "/projects");
    await page.goto("/projects/project_a/tasks");
    await expect(place(page, "projects")).toHaveAttribute("aria-current", "page");
    await page.goto("/my-day");
    await expect(place(page, "projects")).toHaveAttribute("href", "/projects/project_a");
    await place(page, "projects").click();
    await expect(page).toHaveURL(/\/projects\/project_a$/);
  });

  test("phone and tablet: inside a project the title is its name, and switches project", async ({ page }) => {
    test.skip(isDesktop(page), "the title exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    const title = header(page).getByTestId("phone-project-switch");
    await expect(title).toBeVisible();
    await title.click();
    const list = page.getByTestId("phone-project-list");
    await expect(list).toBeVisible();
    await landed(list);
    // Your projects, the one you are on marked; the list sits on the top bar, whole on screen.
    await expect(list.locator('a[aria-current="page"]')).toHaveCount(1);
    const [drop, top] = [(await list.boundingBox())!, (await header(page).boundingBox())!];
    expect(Math.abs(drop.y - (top.y + top.height))).toBeLessThanOrEqual(2);
    await expectTouchTargets(page, list);
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(title).toBeFocused();
    // Another project is one tap away.
    await title.click();
    const other = list.locator("ul a:not([aria-current])").first();
    test.skip((await other.count()) === 0, "this person has one project");
    const href = await other.getAttribute("href");
    await other.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(list).toHaveCount(0);
  });
});

test.describe("sections", () => {
  test("phone and tablet: a project's sections are the row under the top bar; no tab row is drawn", async ({ page }) => {
    test.skip(isDesktop(page), "the row exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    const row = await openSectionMenu(page);
    await expect(row).toHaveAccessibleName("Project sections");
    await expect(currentSection(page)).toHaveText("Overview");
    await expect(row.locator('[aria-current="page"]')).toHaveCount(1);
    // Every section the row had at desktop, those it tucked under More included.
    await expect(row.getByRole("link", { name: "Tasks", exact: true })).toBeAttached();
    await expect(row.getByRole("link", { name: "Activity", exact: true })).toBeAttached();
    // The page's tab row is not drawn; the Overview's own controls stay on the page, where the row was.
    await expect(mainRegion(page).locator("[data-tab-scroller]").first()).toBeHidden();
    await expect(mainRegion(page).locator("[data-context-tabs-trailing]").getByRole("button", { name: "More project actions" })).toBeVisible();

    // Pinned under the top bar as the page scrolls.
    await mainRegion(page).evaluate((main) => (main.style.minHeight = "300vh"));
    await page.evaluate(() => window.scrollTo(0, 500));
    const [pinned, top] = [(await row.boundingBox())!, (await header(page).boundingBox())!];
    expect(Math.abs(pinned.y - (top.y + top.height))).toBeLessThanOrEqual(1);

    await row.getByRole("link", { name: "Tasks", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/project_a\/tasks$/);
    await expect(currentSection(page)).toHaveText("Tasks");
    await expect(currentSection(page)).toBeInViewport();
    await expectNoPageOverflow(page, "project tasks with the section row");
  });

  test("phone: Back goes to where you were, and is not on a place's first page", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    await expect(page.getByTestId("phone-back")).toHaveCount(0);
    await (await openSectionMenu(page)).getByRole("link", { name: "Tasks", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/project_a\/tasks$/);
    await page.getByTestId("phone-back").click();
    await expect(page).toHaveURL(/\/projects\/project_a$/);
  });

  test("desktop: the tab rows are drawn and there is no section row", async ({ page }) => {
    test.skip(!isDesktop(page), "desktop shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    await expect(mainRegion(page).getByRole("navigation", { name: "Project sections" })).toBeVisible();
    await expect(sectionRow(page)).toBeHidden();
  });
});

test.describe("New", () => {
  test("phone and tablet: New opens Quick Create on the bar, the field's first; New again closes it", async ({ page }) => {
    test.skip(isDesktop(page), "the bar exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    const create = bar(page).getByTestId("phone-create");
    await create.click();
    const quick = page.getByTestId("quick-create-panel");
    await expect(quick).toBeVisible();
    await expect(create).toHaveAttribute("aria-expanded", "true");
    await expect(create).toHaveAccessibleName("Close New");
    // The field's first, a task among them; everything else below.
    const field = quick.getByTestId("quick-create-field");
    await expect(field).toBeVisible();
    await expect(field.getByTestId("quick-create-field-tasks.task.create")).toBeVisible();
    // Standing on the bar, whole on screen.
    await landed(quick);
    const [sheet, cells] = [(await quick.boundingBox())!, (await bar(page).boundingBox())!];
    expect(sheet.y).toBeGreaterThanOrEqual(0);
    expect(Math.abs(sheet.y + sheet.height - cells.y)).toBeLessThanOrEqual(2);
    await expectTouchTargets(page, field);

    await page.keyboard.press("Escape");
    await expect(quick).toHaveCount(0);
    await expect(create).toBeFocused();
    await create.click();
    await expect(quick).toBeVisible();
    await create.click();
    await expect(quick).toHaveCount(0);
    await expect(create).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("Sales units", () => {
  test("phone and tablet: Sales units lists every unit; a unit opens its sales page, not its work page", async ({ page }) => {
    test.skip(isDesktop(page), "the bar exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/my-day" });
    await place(page, "units").click();
    await expect(page).toHaveURL(/\/sales\/units$/);
    await expect(mainRegion(page).getByTestId("units-overview")).toBeVisible();
    await expect(place(page, "units")).toHaveAttribute("aria-current", "page");
    await expect(header(page).getByTestId("phone-back")).toHaveCount(0);
    const first = mainRegion(page).locator('a[href^="/sales/units/"]').first();
    test.skip((await first.count()) === 0, "no unit in the seed this person can see");
    await first.click();
    await expect(page).toHaveURL(/\/sales\/units\/[^/?]+/);
    await expect(mainRegion(page).getByTestId("sales-unit")).toBeVisible();
    await expect(place(page, "units")).toHaveAttribute("aria-current", "page");
    // The architect's part is read here, never changed: no upload or attach anywhere on the page.
    await expect(mainRegion(page).getByRole("button", { name: /attach|upload sales plan|add document/i })).toHaveCount(0);
    await header(page).getByTestId("phone-back").click();
    await expect(page).toHaveURL(/\/sales\/units$/);
  });

  test("the seller files the buyer's signed contract on the unit's Contract tab", async ({ page }) => {
    test.skip(isDesktop(page), "the bar exists below 1024");
    await signIn(page, "SALES", { to: "/sales/units" });
    const first = mainRegion(page).locator('a[href^="/sales/units/"]').first();
    test.skip((await first.count()) === 0, "no unit in the seed this person can see");
    await first.click();
    await (await openSectionMenu(page)).getByRole("link", { name: "Contract", exact: true }).click();
    await expect(page).toHaveURL(/\?tab=contract$/);
    await expect(mainRegion(page).getByTestId("sale-contract")).toBeVisible();
    await expect(mainRegion(page).getByTestId("sale-contract-upload")).toBeVisible();
  });
});

test.describe("Inbox", () => {
  test("phone and tablet: Inbox holds what waits for your answer and what is new for you", async ({ page }) => {
    test.skip(isDesktop(page), "the bar exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/my-day" });
    await inbox(page).click();
    await expect(page).toHaveURL(/\/inbox$/);
    const view = mainRegion(page).getByTestId("inbox");
    await expect(view).toBeVisible();
    await expect(inbox(page)).toHaveAttribute("aria-current", "page");
    // Two filters, visible: what needs you, and everything.
    await expect(view.getByTestId("inbox-needs-you")).toHaveAttribute("aria-pressed", "true");
    await view.getByTestId("inbox-everything").click();
    await expect(view.getByTestId("inbox-everything")).toHaveAttribute("aria-pressed", "true");
    await expect(view.getByRole("link", { name: /all approvals/i })).toHaveAttribute("href", "/approvals");
    // The bell is not drawn below 1024: Inbox carries its count.
    await expect(page.getByTestId("global-actions").getByTestId("notification-bell")).toBeHidden();
    await expectNoPageOverflow(page, "Inbox");
  });
});

test.describe("Menu", () => {
  test("phone and tablet: Menu holds the departments and search; a name finds a module", async ({ page }) => {
    test.skip(isDesktop(page), "the bar exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/my-day" });
    await place(page, "menu").click();
    const menu = page.getByTestId("phone-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("region", { name: "Departments" })).toBeVisible();
    await menu.getByTestId("phone-menu-find").fill("cal");
    await expect(menu.getByTestId("phone-module-calendar")).toBeVisible();
    await menu.getByTestId("phone-module-calendar").click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(place(page, "menu")).toHaveAttribute("aria-current", "page");
  });

  test("phone: Menu holds you — your profile, Settings, Refresh and Sign out", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/menu" });
    const menu = page.getByTestId("phone-menu");
    await expect(menu.getByTestId("phone-menu-you")).toHaveAttribute("href", "/settings/profile");
    const you = menu.getByTestId("phone-account");
    await expect(you.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(you.getByTestId("phone-refresh")).toBeVisible();
    await expectTouchTargets(page, you);
    await you.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    // Back must not reveal authenticated content.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/menu$/);
  });
});

test.describe("Tasks on the Dashboard", () => {
  test("phone and tablet: the Dashboard opens with Tasks — My tasks, Due today and Overdue with their counts, and All tasks", async ({ page }) => {
    test.skip(isDesktop(page), "the block exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const block = mainRegion(page).getByTestId("home-tasks");
    await expect(block).toBeVisible();
    await expect(block.getByRole("heading", { name: "Tasks" })).toBeVisible();
    // The block opens the Dashboard's aside, above My Day.
    const [tasksTop, myDayTop] = [(await block.boundingBox())!.y, (await mainRegion(page).getByTestId("open-my-day").boundingBox())!.y];
    expect(tasksTop).toBeLessThan(myDayTop);
    await expect(block.getByRole("link")).toHaveCount(4);
    await expect(block.getByTestId("home-tasks-mine")).toHaveAttribute("href", "/tasks/my-tasks");
    await expect(block.getByTestId("home-tasks-today")).toHaveAttribute("href", "/tasks/all?due=today");
    await expect(block.getByTestId("home-tasks-overdue")).toHaveAttribute("href", "/tasks/overdue");
    await expect(block.getByTestId("home-tasks-all")).toHaveAttribute("href", "/tasks");
    // Each count streams in on its own and is a number once it has.
    await expect(block.getByTestId("home-tasks-count")).toHaveCount(3);
    for (const count of await block.getByTestId("home-tasks-count").all()) await expect(count).toHaveText(/^\d+$/);
    await expectTouchTargets(page, block);
    await block.getByTestId("home-tasks-mine").click();
    await expect(page).toHaveURL(/\/tasks\/my-tasks$/);
  });

  test("somebody who cannot open Tasks gets no Tasks block", async ({ page }) => {
    test.skip(isDesktop(page), "the block exists below 1024");
    await signIn(page, "VIEWER", { to: "/dashboard" });
    const response = await page.request.get("/tasks");
    test.skip(!response.url().includes("access-denied"), "this role can open Tasks");
    await expect(mainRegion(page).getByTestId("dashboard-heading")).toBeVisible();
    await expect(mainRegion(page).getByTestId("home-tasks")).toHaveCount(0);
  });
});

test.describe("header", () => {
  test("phone: where you are, search and Inbox; no logo, bell or account", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/my-day" });
    await expect(header(page).getByTestId("phone-page-title")).toBeVisible();
    await expect(header(page).getByTestId("phone-back")).toHaveCount(0);
    await expect(header(page).getByTestId("search-trigger")).toBeVisible();
    // Inbox is the bar's last cell, right of search and against the screen's edge.
    await expect(inbox(page)).toHaveAccessibleName(/^Inbox/);
    const [search, cell, viewport] = [(await header(page).getByTestId("search-trigger").boundingBox())!, (await inbox(page).boundingBox())!, page.viewportSize()!];
    expect(cell.x).toBeGreaterThan(search.x + search.width - 1);
    expect(Math.round(cell.x + cell.width)).toBe(viewport.width);
    await expect(header(page).getByTestId("modules-panel-trigger")).toBeHidden();
    await expect(header(page).getByTestId("notification-bell")).toBeHidden();
    await expect(page.getByTestId("account-trigger")).toBeHidden();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
    expect((await header(page).boundingBox())!.height).toBeLessThanOrEqual(57);
    await expectTouchTargets(page, header(page));
    await expectNoPageOverflow(page, "header");
  });
});

test.describe("form actions and the keyboard", () => {
  test("phone: a form's Save and Cancel are its last row, never under the bar (mobile audit 5b)", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    // The Owner and the CEO create projects (2f22d359); a project manager is refused /projects/new.
    await signIn(page, "OWNER", { to: "/projects/new" });
    const actions = mainRegion(page).locator("[data-form-actions]").first();
    await expect(actions).toBeAttached();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(actions).toBeInViewport();
    await expect(bar(page)).toBeVisible();
    const [row, top] = [(await actions.boundingBox())!, (await bar(page).boundingBox())!];
    expect(row.y + row.height).toBeLessThanOrEqual(top.y + 1);
  });

  test("the phone bar yields to the keyboard while a text field has focus", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "OWNER", { to: "/clients/new" });
    await mainRegion(page).getByLabel("Client name").focus();
    await expect(bar(page)).toBeHidden();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(bar(page)).toBeVisible();
  });
});
