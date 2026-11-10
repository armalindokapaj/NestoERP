import { expect, test, type Locator, type Page } from "@playwright/test";

import { mainRegion, openSectionMenu, sectionMenuTrigger, signIn } from "../fixtures";
import { expectNoPageOverflow, expectTouchTargets } from "./geometry";

/**
 * The phone shell (docs/ui/UI-04-navigation-layouts.md): the desktop Ribbon
 * brought to the phone, below 1024px. Runs in every responsive matrix project;
 * each test says which width family it is about and skips the rest.
 *
 * Phone is below 768, tablet portrait 768-1023 (the same bar; Create stays in
 * the top bar), desktop 1024 and up (the Ribbon or the Dock; no phone bar).
 *
 * The Pocket Ribbon, the default: the bar is the Ribbon's tabs — Home, Work,
 * Department, Company — each opening its modules as tiles above it; the tab
 * holding the module you are in is marked. Above the bar floats the strip:
 * This page (the section you are on, opening the page's sections), Units and
 * Create. The Action Ribbon, the other choice: Ribbon, the page's main actions
 * (or This page), Units and Create, with the whole Ribbon as a sheet. The bell
 * is the top bar's at every width; the account is under Company.
 *
 * Read-only against the seeded demo except the form checks, which type into a
 * form and leave it.
 */

const width = (page: Page) => page.viewportSize()!.width;
const isPhone = (page: Page) => width(page) < 768;
const isTablet = (page: Page) => width(page) >= 768 && width(page) < 1024;
const isDesktop = (page: Page) => width(page) >= 1024;

const bar = (page: Page) => page.getByTestId("phone-navigation");
const tab = (page: Page, group: "primary" | "work" | "department" | "company") => bar(page).getByTestId(`phone-tab-${group}`);
const panel = (page: Page) => page.getByTestId("phone-panel");
const strip = (page: Page) => page.getByTestId("phone-strip");

/** The Action Ribbon is chosen in Settings › Appearance; its cookie is set before signing in. */
async function chooseAction(page: Page, baseURL: string | undefined) {
  await page.context().addCookies([{ name: "nesto.phone-nav", value: "action", url: baseURL ?? "http://localhost:3000" }]);
}

/** A popup grows out of its control, and a sheet slides in: either is measured once it has landed. */
async function landed(popup: Locator) {
  await popup.evaluate((element) => Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => undefined));
}

test.describe("Pocket Ribbon", () => {
  test("phone: the Ribbon's four tabs, the one you are in marked; This page, Units and Create above", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(bar(page)).toBeVisible();
    await expect(bar(page)).toHaveAttribute("data-mobile-bottom-nav", "pocket");
    for (const [group, name] of [["primary", "Home"], ["work", "Work"], ["department", "Department"], ["company", "Company"]] as const) {
      await expect(tab(page, group)).toHaveText(name);
    }
    await expect(tab(page, "primary")).toHaveAttribute("data-here", "true");
    await expect(tab(page, "work")).not.toHaveAttribute("data-here", "true");
    // The strip: Home has no sections, so This page names the page and opens nothing.
    await expect(strip(page).getByTestId("phone-this-page")).toBeVisible();
    await expect(strip(page).getByTestId("phone-units")).toBeVisible();
    await expect(strip(page).getByTestId("phone-create")).toBeVisible();
    // The bell is the top bar's at every width.
    await expect(page.getByTestId("global-actions").getByTestId("notification-bell")).toBeVisible();
    await expectTouchTargets(page, bar(page));
    await expectNoPageOverflow(page, "dashboard with the bar");
  });

  test("phone: a nested route marks the tab holding its module", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    await expect(tab(page, "work")).toHaveAttribute("data-here", "true");
    await expect(tab(page, "primary")).not.toHaveAttribute("data-here", "true");
  });

  test("phone and tablet: a tab opens its modules as tiles above the bar; a tile navigates and closes it", async ({ page }) => {
    test.skip(isDesktop(page), "the bar exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects" });
    await tab(page, "work").click();
    await expect(tab(page, "work")).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toHaveAccessibleName("Work");
    // The module you are in is the gold tile, and takes focus.
    const projects = panel(page).getByTestId("phone-module-projects");
    await expect(projects).toHaveAttribute("aria-current", "page");
    await expect(projects).toBeFocused();
    // The panel sits on the bar, whole on screen; the strip makes way for it.
    await landed(panel(page));
    const [sheet, tabs] = [(await panel(page).boundingBox())!, (await bar(page).locator("ul").boundingBox())!];
    expect(Math.abs(sheet.y + sheet.height - tabs.y)).toBeLessThanOrEqual(2);
    expect(sheet.y).toBeGreaterThanOrEqual(0);
    await expect(strip(page)).toBeHidden();
    await expectTouchTargets(page, panel(page));

    await panel(page).getByTestId("phone-module-tasks").click();
    await expect(page).toHaveURL(/\/tasks/);
    await expect(panel(page)).toHaveCount(0);
    await expect(tab(page, "work")).toHaveAttribute("data-here", "true");
  });

  test("Escape and a second tap close the panel; focus goes back to the tab", async ({ page }) => {
    test.skip(isDesktop(page), "the bar exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await tab(page, "department").click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(tab(page, "department")).toBeFocused();
    await tab(page, "department").click();
    await expect(panel(page)).toBeVisible();
    await tab(page, "department").click();
    await expect(panel(page)).toHaveCount(0);
  });

  test("Company holds the account: profile, Settings, Refresh, the theme and Logout", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await tab(page, "company").click();
    const account = panel(page).getByTestId("phone-account");
    await expect(account.getByRole("link", { name: /my profile/i })).toBeVisible();
    await expect(account.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(account.getByTestId("phone-refresh")).toBeVisible();
    await account.getByRole("button", { name: /logout/i }).click();
    await expect(page).toHaveURL(/\/login/);
    // Back must not reveal authenticated content.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/dashboard$/);
  });

  test("phone: content is never hidden behind the strip", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects" });
    await expect(mainRegion(page).getByTestId("project-card").first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // The last piece of content, not the padded box: it must end above the strip once scrolled to the end.
    const last = await mainRegion(page).evaluate((main) => {
      const content = [...main.children].filter((child) => !child.matches("[data-mobile-action-bar]"));
      return (content.at(-1) ?? main).getBoundingClientRect().bottom;
    });
    const top = (await strip(page).boundingBox())!.y;
    expect(Math.round(last)).toBeLessThanOrEqual(Math.round(top) + 1);
  });

  test("tablet portrait: the same bar; Create stays in the top bar", async ({ page }) => {
    test.skip(!isTablet(page), "tablet portrait shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(bar(page)).toBeVisible();
    await expect(page.getByTestId("phone-create")).toBeHidden();
    await expect(page.getByTestId("quick-create-button")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    await expect(page.getByTestId("global-actions").getByTestId("notification-bell")).toBeVisible();
  });

  test("desktop: no phone bar; the Ribbon is the navigation", async ({ page }) => {
    test.skip(!isDesktop(page), "desktop shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(bar(page)).toBeHidden();
    await expect(page.locator("[data-ribbon]")).toBeVisible();
    await expect(page.getByTestId("quick-create-button")).toBeVisible();
    await expect(page.getByTestId("account-trigger")).toBeVisible();
    await expect(mainRegion(page).getByTestId("home-tasks")).toBeHidden();
  });

  test("a person without create rights sees no Create button and no dead slot", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "VIEWER", { to: "/dashboard" });
    await expect(page.getByTestId("phone-create")).toHaveCount(0);
    await expect(tab(page, "company")).toBeVisible();
  });
});

test.describe("Units", () => {
  test("phone: one tap to the units of the project you are in, and of the last one from anywhere", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    const units = page.getByTestId("phone-units");
    await expect(units).toHaveAttribute("href", "/projects/project_a/units");
    await units.click();
    await expect(page).toHaveURL(/\/projects\/project_a\/units/);
    await expect(units).toHaveAttribute("aria-current", "page");
    // Elsewhere, Units remembers the project.
    await page.goto("/dashboard");
    await expect(page.getByTestId("phone-units")).toHaveAttribute("href", "/projects/project_a/units");
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

test.describe("This page", () => {
  test("phone and tablet: a project's tabs are This page and its tiles; no tab row is drawn", async ({ page }) => {
    test.skip(isDesktop(page), "This page exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    const trigger = sectionMenuTrigger(page);
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAccessibleName("Page sections: Overview");
    await expect(trigger.getByTestId("section-menu-current")).toHaveText("Overview");
    // The tab row is not drawn; the Overview's own controls stay on the page, where the row was.
    await expect(page.getByRole("navigation", { name: "Project sections" })).toHaveCount(0);
    await expect(mainRegion(page).locator("[data-context-tabs-trailing]").getByRole("button", { name: "More project actions" })).toBeVisible();

    const menu = await openSectionMenu(page);
    await landed(panel(page));
    // Every section the row had, those it tucked under More included, the current one marked and focused.
    const current = menu.getByRole("link", { name: "Overview", exact: true });
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(current).toBeFocused();
    await expect(menu.getByRole("link", { name: "Tasks", exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Activity", exact: true })).toBeVisible();
    await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
    await expectTouchTargets(page, menu);

    await menu.getByRole("link", { name: "Tasks", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/project_a\/tasks$/);
    await expect(page.getByTestId("section-menu")).toHaveCount(0);
    await expect(sectionMenuTrigger(page).getByTestId("section-menu-current")).toHaveText("Tasks");
    await expectNoPageOverflow(page, "project tasks with This page");
  });

  test("Escape closes the sections and gives focus back to This page", async ({ page }) => {
    test.skip(isDesktop(page), "This page exists below 1024");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    const trigger = sectionMenuTrigger(page);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByTestId("section-menu");
    await expect(menu.getByRole("link", { name: "Overview", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(sectionMenuTrigger(page)).toBeFocused();
  });

  test("desktop: the tab rows are drawn and there is no This page below", async ({ page }) => {
    test.skip(!isDesktop(page), "desktop shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    await expect(page.getByRole("navigation", { name: "Project sections" })).toBeVisible();
    await expect(sectionMenuTrigger(page)).toBeHidden();
  });
});

test.describe("Create", () => {
  test("opens the same Quick Create panel as a bubble above the strip, and the same button closes it", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const create = page.getByTestId("phone-create");
    await create.click();
    const quick = page.getByTestId("quick-create-panel");
    await expect(quick).toBeVisible();
    await expect(create).toHaveAttribute("aria-expanded", "true");
    await expect(quick.getByTestId("quick-create-tasks.task.create")).toBeVisible();
    // Floating above the strip, whole on screen, its pointer on the button that opened it.
    const pointer = quick.locator('.nesto-panel-pointer[data-side="below"]');
    await expect(pointer).toBeVisible();
    const [control, bubble, tail] = [(await create.boundingBox())!, (await quick.boundingBox())!, (await pointer.boundingBox())!];
    expect(bubble.y).toBeGreaterThanOrEqual(0);
    expect(bubble.x + bubble.width).toBeLessThanOrEqual(width(page));
    expect(bubble.y + bubble.height).toBeLessThanOrEqual(control.y + 1);
    expect(Math.abs(tail.x + tail.width / 2 - (control.x + control.width / 2))).toBeLessThanOrEqual(2);
    await page.keyboard.press("Escape");
    await expect(quick).toHaveCount(0);

    await create.click();
    await expect(quick).toBeVisible();
    await create.click();
    await expect(quick).toHaveCount(0);
    await expect(create).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("Action Ribbon", () => {
  test("phone: Ribbon, This page, Units and Create in one bar", async ({ page, baseURL }) => {
    test.skip(!isPhone(page), "phone shell");
    await chooseAction(page, baseURL);
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    await expect(bar(page)).toHaveAttribute("data-mobile-bottom-nav", "action");
    await expect(bar(page).getByTestId("phone-ribbon")).toBeVisible();
    await expect(sectionMenuTrigger(page)).toBeVisible();
    await expect(bar(page).getByTestId("phone-units")).toBeVisible();
    await expect(bar(page).getByTestId("phone-create")).toBeVisible();
    // No strip: the page's main actions take This page's place when it has one.
    await expect(strip(page)).toHaveCount(0);
    await expectTouchTargets(page, bar(page));
    await expectNoPageOverflow(page, "project with the Action Ribbon");
  });

  test("Ribbon opens every tab as a sheet, on the tab you are in; a name finds a module", async ({ page, baseURL }) => {
    test.skip(isDesktop(page), "the bar exists below 1024");
    await chooseAction(page, baseURL);
    await signIn(page, "PROJECT_MANAGER", { to: "/projects" });
    await bar(page).getByTestId("phone-ribbon").click();
    const sheet = page.getByTestId("phone-ribbon-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("tab", { name: "Work" })).toHaveAttribute("aria-selected", "true");
    await expect(sheet.getByTestId("phone-module-projects")).toHaveAttribute("aria-current", "page");
    await sheet.getByRole("tab", { name: "Company" }).click();
    await expect(sheet.getByTestId("phone-account")).toBeVisible();
    await sheet.getByTestId("phone-find").fill("cal");
    await expect(sheet.getByTestId("phone-module-calendar")).toBeVisible();
    await sheet.getByTestId("phone-module-calendar").click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(sheet).toHaveCount(0);
  });
});

test.describe("header", () => {
  test("phone: workspace context, search and the bell; no hamburger, no account menu, no company switcher", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const header = page.locator("header[data-shell-region]");
    await expect(header.getByTestId("mobile-context")).toBeVisible();
    await expect(header.getByTestId("search-trigger")).toBeVisible();
    await expect(header.getByTestId("notification-bell")).toBeVisible();
    await expect(header.getByTestId("section-menu-trigger")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
    await expect(page.getByTestId("account-trigger")).toBeHidden();
    // The company switcher is the top bar's from 768px; a phone switches from the header itself.
    await expect(page.getByTestId("workspace-switcher")).toBeHidden();
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(57);
    await expectTouchTargets(page, header);
    await expectNoPageOverflow(page, "header");
  });
});

test.describe("form action bar and the keyboard", () => {
  test("a form's action bar sits above the phone bar, which stays (mobile audit 5b)", async ({ page }) => {
    test.skip(!isPhone(page), "phone shell");
    // The Owner and the CEO create projects (2f22d359); a project manager is refused /projects/new.
    await signIn(page, "OWNER", { to: "/projects/new" });
    const actionBar = mainRegion(page).locator('[data-mobile-action-bar="flow"]').first();
    await expect(actionBar).toBeVisible();
    await expect(strip(page)).toBeVisible();
    const actions = (await actionBar.boundingBox())!;
    const top = (await strip(page).boundingBox())!;
    // Stacked, never overlapping: Save and Cancel end above the strip's top edge.
    expect(actions.y + actions.height).toBeLessThanOrEqual(top.y + 1);
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
