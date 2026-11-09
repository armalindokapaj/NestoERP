import { expect, test, type Locator, type Page } from "@playwright/test";

import { mainRegion, openSectionMenu, sectionMenuTrigger, signIn } from "../fixtures";
import { expectNoPageOverflow, expectTouchTargets } from "./geometry";

/**
 * MOB-02 mobile shell: header, bottom navigation, More, Create, workspace and
 * account entry points. Runs in every responsive matrix project; each test
 * says which width family it is about and skips the rest.
 *
 * Phone is below 768, tablet portrait 768-1023 (bottom bar and drawer, Create
 * in the top bar), desktop 1024 and up (the sidebar; no bottom bar).
 *
 * A phone's bar is Home, Projects, Create, Alerts — the bell — and Menu, the
 * hamburger that opens More; a tablet's is the same without Create, which
 * stays in its top bar. Tasks is not in the bar: it is the Tasks block at the
 * top of Home, and a module in More. The top right of the top bar is the
 * page's section pill ("Sales ▾"), which opens the page's tabs as a menu: no
 * tab row is drawn below 1024px. The destination the app is at is a cell
 * filled with the accent. Create and Alerts open as popups above the bar, a
 * pointer on the button pressed.
 *
 * Read-only against the seeded demo except the dirty-form check, which types
 * into a form and leaves by Stay or Discard.
 */

const width = (page: Page) => page.viewportSize()!.width;
const isPhone = (page: Page) => width(page) < 768;
const isTablet = (page: Page) => width(page) >= 768 && width(page) < 1024;
const isDesktop = (page: Page) => width(page) >= 1024;

const bar = (page: Page) => page.getByRole("navigation", { name: "Primary" });
// Menu: the bar's last cell, on a phone and a tablet alike.
const more = (page: Page) => bar(page).getByTestId("mobile-more");

/** The bar's cells in view, left to right: a destination by its name, a control by its test id. */
const cells = (page: Page) =>
  bar(page)
    .locator("ul > li")
    .evaluateAll((items) =>
      items
        .filter((item) => item.getClientRects().length > 0 && item.querySelector("a, button"))
        .map((item) => item.querySelector<HTMLElement>("[data-testid=mobile-create], [data-testid=notification-bell], [data-testid=mobile-more]")?.dataset.testid ?? item.textContent?.trim()),
    );

const ground = (cell: Locator) => cell.evaluate((element) => getComputedStyle(element).backgroundColor);

/** A popup grows out of its control, and the More sheet slides in: either is measured once it has landed. */
async function landed(popup: Locator) {
  await popup.evaluate((element) => Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => undefined));
}

test.describe("bottom navigation", () => {
  test("phone: Home, Projects, Create, Alerts and Menu; the current destination is a filled cell", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(bar(page)).toBeVisible();
    const home = bar(page).getByRole("link", { name: "Home" });
    const projects = bar(page).getByRole("link", { name: "Projects" });
    await expect(home).toHaveAttribute("aria-current", "page");
    await expect(projects).toBeVisible();
    // Alerts took Tasks' place; Menu, the hamburger, is the last cell. Tasks is no longer in the bar.
    await expect(page.getByTestId("notification-bell")).toHaveCount(1);
    expect(await cells(page)).toEqual(["Home", "Projects", "mobile-create", "notification-bell", "mobile-more"]);
    await expect(more(page)).toHaveText("Menu");
    await expect(bar(page).getByText("Tasks", { exact: true })).toHaveCount(0);
    await expect(page.locator("header[data-shell-region]").getByTestId("mobile-more")).toHaveCount(0);
    expect(await bar(page).getByRole("link").count()).toBeLessThanOrEqual(2);
    // The destination the app is at is a cell filled with the accent, as Create is; the others are bare.
    expect(await ground(home)).toBe(await ground(page.getByTestId("mobile-create")));
    expect(await ground(projects)).toBe("rgba(0, 0, 0, 0)");
    await expectTouchTargets(page, bar(page));
    await expectNoPageOverflow(page, "dashboard with the bar");
  });

  test("phone: a nested route keeps its parent destination active", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    await expect(bar(page).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    await expect(bar(page).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current", "page");
  });

  test("phone: tapping a destination navigates and keeps the bar; Tasks is a module in Menu", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const projects = bar(page).getByRole("link", { name: "Projects" });
    await projects.click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(projects).toHaveAttribute("aria-current", "page");

    await more(page).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Tasks", exact: true }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
    await expect(bar(page)).toBeVisible();
    // A destination of More: the Menu cell is the one the app is at now.
    await expect(more(page)).toHaveAttribute("data-active", "true");
    await expect(projects).not.toHaveAttribute("aria-current", "page");
  });

  test("phone: content is never hidden behind the bar", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects" });
    // The list streams in: the end of the page is its end once the cards are there.
    await expect(mainRegion(page).getByTestId("project-card").first()).toBeVisible();
    // A page opens at its top as it hydrates (components/navigation/scroll-to-top.tsx); one bell left in the
    // document says the shell has, so the scroll from here on is this test's own.
    await expect(page.getByTestId("notification-bell")).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // The last piece of content, not the padded box: it must end above the bar once scrolled to the end.
    const last = await mainRegion(page).evaluate((main) => (main.lastElementChild ?? main).getBoundingClientRect().bottom);
    const top = (await bar(page).boundingBox())!.y;
    expect(Math.round(last)).toBeLessThanOrEqual(Math.round(top) + 1);
  });

  test("tablet portrait: Home, Projects, Alerts and Menu; Create stays in the top bar, and Menu is the only menu", async ({ page }) => {
    test.skip(!isTablet(page), "tablet portrait shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(bar(page)).toBeVisible();
    await expect(page.getByTestId("mobile-create")).toBeHidden();
    await expect(page.getByTestId("quick-create-button")).toBeVisible();
    // No top-left drawer trigger: the bottom bar's Menu is the one menu below 1024px; the mark leads home.
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    await expect(page.locator("header[data-shell-region]").getByTestId("organization-home")).toBeVisible();
    // The bell is the bar's below 1024px: one bell, none in the top bar.
    await expect(page.getByTestId("notification-bell")).toHaveCount(1);
    await expect(page.getByTestId("global-actions").getByTestId("notification-bell")).toHaveCount(0);
    expect(await cells(page)).toEqual(["Home", "Projects", "notification-bell", "mobile-more"]);
    await expect(more(page)).toHaveText("Menu");
  });

  test("desktop: no bottom bar; the sidebar is unchanged", async ({ page }) => {
    test.skip(!isDesktop(page), "desktop shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(bar(page)).toBeHidden();
    await expect(page.getByTestId("mobile-context")).toBeHidden();
    await expect(page.getByTestId("quick-create-button")).toBeVisible();
    await expect(page.getByTestId("account-trigger")).toBeVisible();
    await expect(page.getByTestId("global-actions").getByTestId("notification-bell")).toBeVisible();
    // Home has no Tasks block here: the sidebar has Tasks.
    await expect(mainRegion(page).getByTestId("home-tasks")).toBeHidden();
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
    await landed(sheet);
    if (isPhone(page)) {
      // Two thirds of a phone's screen, on its right edge: the page it was opened from stays in view beside it.
      const box = (await sheet.boundingBox())!;
      expect(Math.abs(box.width - (width(page) * 2) / 3)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.x + box.width - width(page))).toBeLessThanOrEqual(1);
    }
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
    // Menu is the cell the app is at now, and the sheet marks the destination when it is opened again.
    await expect(more(page)).toHaveAttribute("data-active", "true");
    await more(page).click();
    await expect(page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
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

test.describe("Tasks on Home", () => {
  test("phone and tablet: Tasks opens Home — My tasks, Due today and Overdue with their counts, and All tasks", async ({ page }) => {
    test.skip(isDesktop(page), "the bar exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const block = mainRegion(page).getByTestId("home-tasks");
    await expect(block).toBeVisible();
    await expect(block.getByRole("heading", { name: "Tasks" })).toBeVisible();
    // The block opens Home's aside, above My Day.
    const [tasksTop, myDayTop] = [(await block.boundingBox())!.y, (await mainRegion(page).getByTestId("open-my-day").boundingBox())!.y];
    expect(tasksTop).toBeLessThan(myDayTop);
    const links = block.getByRole("link");
    await expect(links).toHaveCount(4);
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
    test.skip(isDesktop(page), "the bar exists below 1024");
    await signIn(page, "VIEWER", { to: "/dashboard" });
    const response = await page.request.get("/tasks");
    test.skip(!response.url().includes("access-denied"), "this role can open Tasks");
    await expect(mainRegion(page).getByTestId("dashboard-heading")).toBeVisible();
    await expect(mainRegion(page).getByTestId("home-tasks")).toHaveCount(0);
  });
});

test.describe("section menu", () => {
  test("phone and tablet: a project's tabs are the top bar's pill and its menu; no tab row is drawn", async ({ page }) => {
    test.skip(isDesktop(page), "the pill exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    const header = page.locator("header[data-shell-region]");
    const pill = header.getByTestId("section-menu-trigger");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAccessibleName("Page sections: Overview");
    await expect(pill.getByTestId("section-menu-current")).toHaveText("Overview");
    // The tab row is not drawn; the Overview's own controls stay on the page, where the row was.
    await expect(page.getByRole("navigation", { name: "Project sections" })).toHaveCount(0);
    const controls = mainRegion(page).locator("[data-context-tabs-trailing]");
    await expect(controls.getByRole("button", { name: "More project actions" })).toBeVisible();

    const menu = await openSectionMenu(page);
    await expect(menu).toHaveAccessibleName("Project sections");
    await landed(menu);
    // Every section the row had, those it tucked under More included, the current one marked and focused.
    const current = menu.getByRole("link", { name: "Overview", exact: true });
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(current).toBeFocused();
    await expect(menu.getByRole("link", { name: "Tasks", exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Activity", exact: true })).toBeVisible();
    await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
    // A popup on a touch layout: glass, under the pill, its pointer on it, whole on screen.
    await expect(menu.locator(".nesto-popup-pointer")).toBeVisible();
    const [control, popup] = [(await pill.boundingBox())!, (await menu.boundingBox())!];
    expect(popup.y).toBeGreaterThanOrEqual(control.y + control.height - 1);
    expect(popup.x + popup.width).toBeLessThanOrEqual(width(page) + 1);
    await expectTouchTargets(page, menu);

    await menu.getByRole("link", { name: "Tasks", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/project_a\/tasks$/);
    await expect(page.getByTestId("section-menu")).toHaveCount(0);
    await expect(pill.getByTestId("section-menu-current")).toHaveText("Tasks");
    await expectNoPageOverflow(page, "project tasks with the pill");
  });

  test("the menu works from the keyboard: the arrows move, Escape closes it and gives focus back to the pill", async ({ page }) => {
    test.skip(isDesktop(page), "the pill exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    const pill = sectionMenuTrigger(page);
    await pill.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByTestId("section-menu");
    await expect(menu.getByRole("link", { name: "Overview", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("link", { name: "Overview", exact: true })).not.toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("link").last()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(pill).toBeFocused();
  });

  test("desktop: the tab rows are drawn and there is no pill", async ({ page }) => {
    test.skip(!isDesktop(page), "desktop shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    await expect(page.getByRole("navigation", { name: "Project sections" })).toBeVisible();
    await expect(sectionMenuTrigger(page)).toBeHidden();
  });
});

test.describe("Create", () => {
  test("opens the same Quick Create panel as a bubble above the bar, and the same button closes it", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const create = page.getByTestId("mobile-create");
    await create.click();
    const panel = page.getByTestId("quick-create-panel");
    await expect(panel).toBeVisible();
    await expect(create).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByTestId("quick-create-tasks.task.create")).toBeVisible();
    // Floating above the bar, whole on screen, its pointer on the button that opened it.
    const pointer = panel.locator('.nesto-panel-pointer[data-side="below"]');
    await expect(pointer).toBeVisible();
    const [control, bubble, tail] = [(await create.boundingBox())!, (await panel.boundingBox())!, (await pointer.boundingBox())!];
    expect(bubble.y).toBeGreaterThanOrEqual(0);
    expect(bubble.x).toBeGreaterThanOrEqual(0);
    expect(bubble.x + bubble.width).toBeLessThanOrEqual(width(page));
    expect(bubble.y + bubble.height).toBeLessThanOrEqual(control.y + 1);
    expect(Math.abs(tail.x + tail.width / 2 - (control.x + control.width / 2))).toBeLessThanOrEqual(2);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    // Pressed again while its panel is open, the bar's button closes it: it toggles.
    await create.click();
    await expect(panel).toBeVisible();
    await create.click();
    await expect(panel).toHaveCount(0);
    await expect(create).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("header", () => {
  test("phone: workspace context and search; no hamburger, and on a page without sections no pill; the bell is the bar's; no drawer trigger, no account menu, no company switcher", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const header = page.locator("header[data-shell-region]");
    await expect(header.getByTestId("mobile-context")).toBeVisible();
    await expect(header.getByTestId("search-trigger")).toBeVisible();
    // Menu moved to the bottom bar; the top right is the section pill, and Home has no sections.
    await expect(header.getByTestId("mobile-more")).toHaveCount(0);
    await expect(header.getByTestId("section-menu-trigger")).toHaveCount(0);
    await expect(header.locator("[data-section-pill-placeholder]")).toBeHidden();
    // One bell, in the bottom bar (the top bar's is gone once the page knows its width).
    await expect(header.getByTestId("notification-bell")).toHaveCount(0);
    await expect(bar(page).getByTestId("notification-bell")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
    await expect(page.getByTestId("account-trigger")).toBeHidden();
    // The company switcher is the top bar's from 768px; a phone switches from the header itself.
    await expect(page.getByTestId("workspace-switcher")).toBeHidden();
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(57);
    await expectTouchTargets(page, header);
    await expectNoPageOverflow(page, "header");
  });

  test("phone: a record's way to its parent is the bar's own cell, and it leads to the list, not out of NESTO", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    // Below 640px the breadcrumb bar is not drawn, and its Back control goes with it: the way up is the
    // destination the record sits under, which the bar marks as where the app is.
    await expect(page.getByTestId("record-navigation-header")).toBeHidden();
    const parent = bar(page).getByRole("link", { name: "Projects" });
    await expect(parent).toHaveAttribute("aria-current", "page");
    await parent.click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(bar(page)).toBeVisible();
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
