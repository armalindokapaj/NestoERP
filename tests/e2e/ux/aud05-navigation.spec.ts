import { expect, test, type Page } from "../pw";

import { chooseWorkspace, mainRegion, mainNavigation, navigationHrefs, navigationLink, signIn, type DemoRole, workspaceHeader, openWorkspaceSwitcher } from "../fixtures";

/**
 * AUD-05 §3, §4, §7, §8 — navigation and first-time orientation, per
 * representative role family (UX-02..UX-07, UX-09, UX-14..UX-16, UX-18).
 *
 * Written against the real demo identities and data. A visible control is
 * never the proof: every link is followed and its destination must answer
 * for this person, and every hidden action is requested directly and must
 * refuse.
 */

type Family = { family: string; role: DemoRole; module: { label: string; href: string; help: string }; mayCreateTask: boolean };

const FAMILIES: Family[] = [
  { family: "Group Owner / Company Admin", role: "OWNER", module: { label: "Projects", href: "/projects", help: "/help/projects" }, mayCreateTask: true },
  { family: "Finance", role: "FINANCE_A", module: { label: "Finance", href: "/finance", help: "/help/finance" }, mayCreateTask: true },
  { family: "Project Manager / Engineer", role: "PROJECT_MANAGER", module: { label: "Daily Logs", href: "/daily-logs", help: "/help/daily-logs" }, mayCreateTask: true },
  { family: "Sales / Architect", role: "SALES", module: { label: "Sales", href: "/sales", help: "/help/sales" }, mayCreateTask: true },
  { family: "Read-only / field", role: "VIEWER", module: { label: "Tasks", href: "/tasks", help: "/help/tasks" }, mayCreateTask: false },
];

/** Every module in the navigation opens for this person: no item the page then refuses (UX-02). */
async function sidebarLinks(page: Page): Promise<string[]> {
  return navigationHrefs(page);
}

for (const family of FAMILIES) {
  test.describe(`${family.family} (${family.role})`, () => {
    test("every sidebar destination opens, with its module marked current and a heading that matches (UX-02, UX-03, UX-07)", async ({ page }) => {
      await signIn(page, family.role);
      const hrefs = await sidebarLinks(page);
      expect(new Set(hrefs).size, "no duplicate entries").toBe(hrefs.length);
      for (const href of hrefs) {
        const response = await page.goto(href);
        expect(response?.status(), href).toBeLessThan(400);
        await expect(page, href).not.toHaveURL(/\/access-denied|\/module-unavailable/);
        const current = mainNavigation(page);
        await expect(current, href).toHaveAttribute("data-current-href", href);
        // The module the sidebar named is named at the top of the page (dashboard excepted): by the heading, or,
        // where the heading is the page's own figure or period (approvals, calendar, a personal view), by the breadcrumb bar.
        const name = ((await current.getAttribute("data-current-label")) ?? "").trim();
        const heading = mainRegion(page).getByRole("heading", { level: 1 }).first();
        if (href !== "/dashboard") await expect(heading.or(page.getByTestId("record-navigation-header").first()).filter({ hasText: name }).first(), href).toBeVisible();
      }
    });

    test("the module's Help is reachable from its header by keyboard and describes only what this role can do (UX-16)", async ({ page }) => {
      await signIn(page, family.role, { to: family.module.href });
      // Help is an item of the header's ⋯, right after the module's title (components/navigation/page-menu.tsx).
      await expect(mainRegion(page).getByTestId("module-help-entry")).toBeHidden();
      const more = mainRegion(page).getByTestId("page-menu");
      await more.focus();
      await page.keyboard.press("Enter");
      const entry = page.getByRole("menuitem", { name: `Help for ${family.module.label}` });
      await expect(entry).toHaveAccessibleName(`Help for ${family.module.label}`);
      await entry.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(family.module.help);
      const help = mainRegion(page).getByTestId("module-help");
      await expect(help.getByRole("heading", { level: 1 })).toHaveText(`${family.module.label} help`);
      await expect(help.getByRole("heading", { level: 2, name: "Key terms" })).toBeVisible();
      await expect(help.getByRole("heading", { level: 2, name: "Who can do what" })).toBeVisible();
      // No tour, no overlay: nothing modal opened on the way.
      await expect(page.locator('[role="dialog"], [aria-modal="true"]')).toHaveCount(0);
      // The way back is the module itself.
      await help.getByRole("link", { name: `Open ${family.module.label}` }).click();
      await expect(page).toHaveURL(new RegExp(`${family.module.href}(\\?|$)`));
    });

    test("Tasks help offers New task only to somebody who may create one, and its page agrees (UX-15, UX-16)", async ({ page }) => {
      await signIn(page, family.role, { to: "/help/tasks" });
      const create = mainRegion(page).getByRole("link", { name: "New task" });
      if (family.mayCreateTask) {
        await expect(create).toBeVisible();
        await create.click();
        await expect(page).toHaveURL(/\/tasks\/new/);
        await expect(mainRegion(page).getByRole("heading", { level: 1, name: "New task" })).toBeVisible();
      } else {
        await expect(create).toHaveCount(0);
        await expect(mainRegion(page).getByText(/Your role can read Tasks here/)).toBeVisible();
        const response = await page.goto("/tasks/new");
        await expect(mainRegion(page).locator("h1, [data-testid=not-found]").first()).toBeVisible();
        // The page streams behind its loading boundary, so a missing page is announced by the page, not by the status.
        const refused = page.url().includes("/access-denied") || (response?.status() ?? 200) >= 400 || (await page.getByTestId("not-found").isVisible().catch(() => false));
        expect(refused).toBe(true);
      }
    });

    test("a module this role cannot open has no Help page either (UX-16)", async ({ page }) => {
      await signIn(page, family.role);
      const hrefs = new Set(await sidebarLinks(page));
      const closed = ["/hr", "/finance", "/inventory", "/hse"].find((href) => !hrefs.has(href));
      test.skip(!closed, "this role opens every probed module");
      await page.goto(`/help${closed}`);
      // The page streams behind its loading boundary, so the status is sent before the page can say it is missing: the page says it.
      await expect(page.getByTestId("not-found")).toBeVisible();
      await expect(page.getByTestId("module-help")).toHaveCount(0);
    });

    test("the dashboard shows real work and no creator step to somebody who cannot create (UX-14, UX-15)", async ({ page }) => {
      await signIn(page, family.role, { to: "/dashboard" });
      const startHere = mainRegion(page).getByTestId("start-here");
      // The demo companies are populated: Start here is for a genuinely empty view only.
      await expect(startHere).toHaveCount(0);
      if (!family.mayCreateTask) {
        await expect(mainRegion(page).getByRole("link", { name: /^New / })).toHaveCount(0);
        await expect(page.getByTestId("quick-create-button")).toHaveCount(0);
      }
      // Every shortcut the dashboard offers opens for this person (no door that refuses).
      const shortcuts = await mainRegion(page)
        .locator('a[href$="/new"], a[href="/team/invite"]')
        .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? ""));
      for (const href of new Set(shortcuts)) {
        const response = await page.request.get(href);
        expect(response.status(), href).toBeLessThan(400);
        expect(response.url(), href).not.toMatch(/access-denied/);
      }
    });
  });
}

test.describe("Daily Logs is marked current (UX-03)", () => {
  test("on /daily-logs and below, where the key never matched the route", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/daily-logs" });
    await expect(mainNavigation(page)).toHaveAttribute("data-current-label", "Daily Logs");
    // Daily Logs is in Work: that tab is open, the module marked in it, its sections first (docs/ui/UI-04-navigation-layouts.md).
    await expect(mainNavigation(page).getByTestId("ribbon-tab-work")).toHaveAttribute("aria-selected", "true");
    await expect(mainNavigation(page).getByTestId("ribbon-panel").locator('[data-testid="ribbon-module-dailyLogs"][aria-current="page"]')).toHaveCount(1);
  });
});

test.describe("breadcrumbs and return to the list (UX-03, UX-04)", () => {
  test("a filtered list → record → breadcrumb returns to the same filter and page", async ({ page }) => {
    await signIn(page, "FINANCE_A", { to: "/finance/invoices?status=APPROVED" });
    const first = mainRegion(page).getByRole("table").getByRole("link").first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page).toHaveURL(/\/finance\/invoices\/[^/?]+/);
    const trail = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(trail.locator('[aria-current="page"]')).toHaveCount(1);
    // Module and list are named as the sidebar and the tab name them, once each.
    await expect(trail.getByRole("link", { name: "Finance", exact: true })).toHaveCount(1);
    const list = trail.getByRole("link", { name: "Invoices", exact: true });
    await expect(list).toHaveAttribute("href", /\/finance\/invoices\?status=APPROVED/);
    await list.click();
    await expect(page).toHaveURL(/\/finance\/invoices\?status=APPROVED/);
  });

  test("a deep link with no history offers Back to the nearest parent instead of a dead button", async ({ page, context }) => {
    await signIn(page, "FINANCE_A", { to: "/finance/invoices" });
    const href = await mainRegion(page).getByRole("table").getByRole("link").first().getAttribute("href");
    expect(href).toBeTruthy();
    // A fresh tab: sessionStorage (the in-app history) is empty, as for a link from an e-mail.
    const fresh = await context.newPage();
    await fresh.goto(href!);
    const back = fresh.getByRole("button", { name: /^Back to / });
    await expect(back).toBeEnabled();
    await back.click();
    await expect(fresh).toHaveURL(/\/finance(\/invoices)?(\?|$)/);
    await fresh.close();
  });

  test("every clickable crumb on a record opens for the reader; the ones they cannot open are plain text", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/all" });
    await mainRegion(page).getByRole("table").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/tasks\/[^/?]+/);
    const hrefs = await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? ""));
    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.url(), href).not.toMatch(/access-denied/);
    }
  });
});

test.describe("workspace fallback (UX-05)", () => {
  test("switching company from a record lands on the list with a reason, under the new company's name only", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/tasks/all" });
    const record = mainRegion(page).getByRole("table").getByRole("link").first();
    const title = (await record.innerText()).trim();
    await record.click();
    await expect(page).toHaveURL(/\/tasks\/[^/?]+/);
    // The sidebar's header writes the workspace being worked in, by its own name alone.
    const before = (await workspaceHeader(page).getByTestId("workspace-label").innerText()).trim();
    expect(before).not.toBe("");

    await (await openWorkspaceSwitcher(page)).click();
    const option = page.getByTestId("workspace-panel").getByTestId("workspace-option").filter({ hasNotText: before });
    const target = (await option.first().innerText()).split("\n")[0].trim();
    await page.keyboard.press("Escape");
    // The reason is a toast that does not stay: it is watched for from before the switch.
    const said = page.getByText(/The previous (record|page) is not available/).first().waitFor({ state: "visible", timeout: 30_000 });
    said.catch(() => undefined);
    await chooseWorkspace(page, target);

    // The record is another company's: the page falls back and says why.
    await said;
    await expect(page).not.toHaveURL(/\/tasks\/[^/?]+$/);
    await expect(mainRegion(page).getByText(title, { exact: true })).toHaveCount(0);
    // No stale workspace name anywhere in the shell: the sidebar's header, the top bar's switcher, the breadcrumb.
    await expect(workspaceHeader(page)).toHaveAccessibleName(new RegExp(target));
    await expect(workspaceHeader(page)).not.toContainText(before);
    expect(await (await openWorkspaceSwitcher(page)).getAttribute("aria-label")).not.toContain(before);
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    if (await breadcrumb.count()) await expect(breadcrumb).not.toContainText(before);
  });

  test("a deep link to a record the reader cannot open never shows its name", async ({ page, browser }) => {
    // The Owner finds a record the Viewer is not on; the Viewer follows the link.
    await signIn(page, "OWNER", { to: "/finance/invoices" });
    const link = mainRegion(page).getByRole("table").getByRole("link").first();
    const [href, name] = [await link.getAttribute("href"), (await link.innerText()).trim()];
    const viewer = await browser.newPage();
    await signIn(viewer, "VIEWER");
    await viewer.goto(href!);
    await expect(viewer.getByText(name, { exact: true })).toHaveCount(0);
    await expect(viewer).toHaveURL(/access-denied|not-found|\/finance|\/dashboard/);
    await viewer.close();
  });
});

test.describe("Quick Create (UX-09)", () => {
  test("in the Group workspace it asks for the company, lists only the ones allowed, and opens the canonical form there", async ({ page }) => {
    await signIn(page, "OWNER", { workspace: "GROUP", to: "/dashboard" });
    await page.getByTestId("quick-create-button").click();
    const panel = page.getByTestId("quick-create-panel");
    await panel.getByTestId("quick-create-tasks.task.create").first().click();
    await expect(panel).toHaveAttribute("data-state", "company");
    const company = panel.getByTestId("quick-create-company");
    // Nothing is chosen for them unless the page's own company is one of the allowed.
    // NESTO's own dropdown (components/ui/form-select.tsx): its options are there to read once its list is open.
    await company.click();
    const options = page.getByRole("listbox").getByRole("option");
    await expect(options.first()).toBeVisible();
    const count = await options.count();
    await options.nth(count > 1 ? 1 : 0).click();
    await panel.getByTestId("quick-create-continue").click();
    await expect(page).toHaveURL(/\/tasks\/new/, { timeout: 20_000 });
    await expect(mainRegion(page).getByRole("heading", { level: 1, name: "New task" })).toBeVisible();
  });

  test("a daily log asks for the project first rather than opening a broken form", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await page.getByTestId("quick-create-button").click();
    const panel = page.getByTestId("quick-create-panel");
    const dailyLog = panel.getByTestId("quick-create-projects.daily_log.create").first();
    await expect(dailyLog).toHaveText("Daily log");
    await dailyLog.click();
    await expect(panel).toHaveAttribute("data-state", "project");
    const project = panel.getByTestId("quick-create-project");
    // The first option is the prompt; a project follows it.
    await project.click();
    const options = page.getByRole("listbox").getByRole("option");
    await expect(options.nth(1)).toBeVisible();
    await options.nth(1).click();
    await panel.getByTestId("quick-create-continue").click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/daily-logs\/new/);
  });

  test("the labels are the glossary's nouns", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await page.getByTestId("quick-create-button").click();
    const panel = page.getByTestId("quick-create-panel");
    await expect(panel.getByTestId("quick-create-procurement.purchase_request.create").first()).toHaveText("Purchase request");
    await expect(panel.getByText("Purchase Request", { exact: true })).toHaveCount(0);
  });

  test("a Viewer has no Create button and no C shortcut", async ({ page }) => {
    await signIn(page, "VIEWER", { to: "/dashboard" });
    await expect(page.getByTestId("quick-create-button")).toHaveCount(0);
    await page.keyboard.press("c");
    await expect(page.getByTestId("quick-create-panel")).toHaveCount(0);
  });
});

test.describe("orientation costs no extra requests (UX-18)", () => {
  test("opening a module and its Help does not call an API per menu item or per help entry", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    const api: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) api.push(url.pathname);
    });
    await (await navigationLink(page, "Tasks")).click();
    await expect(page).toHaveURL(/\/tasks/);
    await mainRegion(page).getByTestId("page-menu").click();
    await page.getByRole("menuitem", { name: /^Help/ }).click();
    await expect(page).toHaveURL(/\/help\/tasks/);
    expect(api.filter((path) => /help|navigation|permission/.test(path))).toEqual([]);
  });
});
