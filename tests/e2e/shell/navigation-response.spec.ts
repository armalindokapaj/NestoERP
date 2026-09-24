import { expect, test, type Page, type Request } from "@playwright/test";

import { expectAccessDenied, mainRegion, sidebar, signIn } from "../fixtures";

/**
 * Immediate navigation response (NAV-01 §15): loading boundaries, pending
 * feedback, and `+ Create` loading its menu only when it is opened.
 *
 * Real authorisation runs against the seeded backend throughout. Route mocks
 * are used only where §14.3 allows them: to hold a destination's response,
 * and for transport failures and response-order races.
 */

const QUICK_CREATE_API = /\/api\/quick-create\/(actions|projects|launch)/;

/** Every Quick Create request the page makes from now on. */
function countQuickCreate(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (QUICK_CREATE_API.test(request.url())) requests.push(request);
  });
  return {
    all: () => requests,
    actions: () => requests.filter((request) => request.url().includes("/api/quick-create/actions")),
    projects: () => requests.filter((request) => request.url().includes("/api/quick-create/projects")),
    launches: () => requests.filter((request) => request.url().includes("/api/quick-create/launch")),
  };
}

/**
 * Holds the navigation (not the prefetch) request for one pathname until
 * released, so a loading state can be seen on purpose (§14.3 step 6).
 */
async function holdNavigation(page: Page, pathname: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      const headers = route.request().headers();
      if (headers.rsc === "1" && !headers["next-router-prefetch"]) await released;
      await route.continue();
    },
  );
  return release;
}

/** The link's prefetch — which carries its loading boundary — has arrived. */
async function prefetched(page: Page, pathname: string) {
  await expect
    .poll(() => page.evaluate((path) => performance.getEntriesByType("resource").some((entry) => new URL(entry.name).pathname === path && entry.name.includes("_rsc=")), pathname), { timeout: 15_000 })
    .toBe(true);
}

test.describe("loading and pending feedback (L01, N01, N03, N04, N06)", () => {
  test("a held destination shows the pending mark and its skeleton; the shell stays usable and aria-current waits for the commit", async ({ page }) => {
    await signIn(page, "FINANCE", { to: "/dashboard" });
    const nav = sidebar(page);
    const target = nav.locator('a[href="/finance"]');
    await expect(target).toBeVisible();
    // A sidebar module link is prepared on deliberate intent, not on sight (NAV-03 PREFETCH-01).
    await target.hover();
    await prefetched(page, "/finance");
    const release = await holdNavigation(page, "/finance");

    const dashboard = nav.locator('a[href="/dashboard"]');
    await target.click();
    // The prefetched boundary lets the route commit at once: the active item follows the URL and
    // the skeleton owns the wait. Before the commit, the item carries its pending mark.
    await expect(mainRegion(page).getByTestId("page-skeleton")).toBeVisible();
    await expect(page).toHaveURL(/\/finance$/);
    await expect(target).toHaveAttribute("aria-current", "page");
    await expect(dashboard).not.toHaveAttribute("aria-current", "page");
    await expect(mainRegion(page).getByRole("status").filter({ hasText: "Loading page…" })).toBeAttached();
    // The shell is still there and still answers.
    await expect(page.getByTestId("quick-create-button")).toBeEnabled();
    await expect(dashboard).toBeEnabled();

    release();
    await expect(mainRegion(page).getByTestId("page-skeleton")).toHaveCount(0);
    await expect(page.getByTestId("nav-progress")).toHaveCount(0);
    await expect(target.getByTestId("nav-pending-hint")).toHaveCount(0);
  });

  test("an unprefetched destination marks the clicked link at once, and aria-current waits for the commit", async ({ page }) => {
    // Nothing reaches the server for /finance until released — its prefetch included, so no
    // boundary is cached and the route cannot commit early.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route((url) => url.pathname === "/finance", async (route) => {
      await held;
      await route.continue();
    });
    await signIn(page, "FINANCE", { to: "/dashboard" });
    const nav = sidebar(page);
    const target = nav.locator('a[href="/finance"]');
    await target.click();
    await expect(target.getByTestId("nav-pending-hint")).toBeVisible();
    await expect(page.getByTestId("nav-progress")).toHaveAttribute("data-source", "sidebar");
    await expect(target).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("status").filter({ hasText: "Loading page…" }).first()).toBeAttached();
    release();
    await expect(target).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("nav-progress")).toHaveCount(0);
  });

  test("choosing B while A is held ends on B, and A's late answer changes nothing", async ({ page }) => {
    // A is held from the start, its prefetch included: a prefetched boundary would let A commit
    // at once, and whether it has arrived by the click differs between browsers.
    let releaseA!: () => void;
    const heldA = new Promise<void>((resolve) => (releaseA = resolve));
    await page.route((url) => url.pathname === "/tasks", async (route) => {
      await heldA;
      await route.continue();
    });
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const nav = sidebar(page);
    await nav.locator('a[href="/tasks"]').click();
    await expect(page.getByTestId("nav-progress")).toHaveAttribute("data-source", "sidebar");
    await nav.locator('a[href="/documents"]').click();
    await expect(page).toHaveURL(/\/documents$/);
    releaseA();
    await expect(page.getByTestId("nav-progress")).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/documents$/);
    await expect(nav.locator('a[href="/documents"]')).toHaveAttribute("aria-current", "page");
  });

  test("a modified click and the current page begin nothing in this tab", async ({ page, context }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    const nav = sidebar(page);
    const opened = context.waitForEvent("page");
    await nav.locator('a[href="/documents"]').click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
    await (await opened).close();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId("nav-progress")).toHaveCount(0);

    await nav.locator('a[href="/tasks"]').click();
    await expect(page.getByTestId("nav-progress")).toHaveCount(0);
    await expect(nav.locator('a[href="/tasks"]').getByTestId("nav-pending-hint")).toHaveCount(0);
  });

  test("a query-only link whose page the framework would hold still commits promptly (N05, vercel/next.js#86151)", async ({ page }) => {
    // Without the reveal watchdog this tab held the old report for 10 s or more on a production build.
    await signIn(page, "HR", { to: "/hr/reports" });
    await expect(mainRegion(page).getByRole("heading", { name: "Headcount" })).toBeVisible();
    await mainRegion(page).getByRole("navigation", { name: "Reports" }).getByRole("link", { name: "Compensation" }).click();
    await expect(page).toHaveURL(/report=compensation/, { timeout: 3_000 });
    await expect(mainRegion(page).getByRole("heading", { name: "Compensation" })).toBeVisible();
    await expect(page.getByTestId("nav-progress")).toHaveCount(0);
  });

  test("a query-only navigation settles when the new query commits (N05)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/all" });
    await page.goto("/tasks/all?search=zz-no-such-task");
    await expect(page).toHaveURL(/search=zz-no-such-task/);
    await expect(page.getByTestId("nav-progress")).toHaveCount(0);
  });
});

test.describe("responses and access (§2.1, A02, A04)", () => {
  test("a forbidden module still lands on the denied screen and its page draws nothing of the module", async ({ page }) => {
    await signIn(page, "VIEWER", { to: "/dashboard" });
    await expectAccessDenied(page, "/finance/invoices");
    await expect(mainRegion(page).getByTestId("page-skeleton")).toHaveCount(0);
  });

  test("a record with a pre-stream contract answers 404 before streaming, and its way back works", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const response = await page.goto("/clients/client_meridian");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found." })).toBeVisible();
    expect(await page.content()).not.toContain("Meridian");
    await page.getByRole("link", { name: "Return to Dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("button", { name: /open user menu/i })).toBeVisible();
  });

  test("API refusals keep their real status codes", async ({ page }) => {
    await signIn(page, "VIEWER", { to: "/dashboard" });
    const launch = await page.request.post("/api/quick-create/launch", { data: { actionKey: "finance.invoice.create", companyId: null, projectId: null, pathname: "/dashboard" } });
    expect(launch.status()).toBe(403);
  });
});

test.describe("+ Create loads on demand (Q01-Q10, Q15, Q22, Q23)", () => {
  test("ordinary browsing with Create closed makes no Quick Create request", async ({ page }) => {
    const counted = countQuickCreate(page);
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const hrefs = await sidebar(page).locator("a[href^='/']").evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
    const route = hrefs.filter((href) => href !== "/dashboard").slice(0, 5);
    for (let index = 0; index < 10; index += 1) {
      const href = route[index % route.length] ?? "/dashboard";
      await sidebar(page).locator(`a[href="${href}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${href.replace(/[/-]/g, "\\$&")}$`));
    }
    await page.reload();
    expect(counted.all()).toHaveLength(0);
  });

  test("the first `C` opens the panel before any menu exists; one request; a reopen reuses it", async ({ page }) => {
    const counted = countQuickCreate(page);
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/quick-create/actions**", async (route) => {
      await held;
      await route.continue();
    });

    await page.locator("body").press("c");
    const panel = page.getByTestId("quick-create-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("quick-create-loading")).toBeVisible();
    // Repeated activation during the load starts nothing new.
    await page.keyboard.press("c");
    await page.keyboard.press("c");
    await expect(panel).toHaveCount(1);
    release();
    await expect(panel.getByTestId("quick-create-tasks.task.create")).toBeVisible();
    expect(counted.actions()).toHaveLength(1);

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("quick-create-button")).toBeFocused();
    await page.getByTestId("quick-create-button").click();
    await expect(panel.getByTestId("quick-create-tasks.task.create")).toBeVisible();
    expect(counted.actions()).toHaveLength(1);
    expect(counted.projects()).toHaveLength(0);
  });

  test("typing `c` where it belongs to a field opens nothing (Q04)", async ({ page }) => {
    const counted = countQuickCreate(page);
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/all" });
    const search = mainRegion(page).locator("input").first();
    await search.click();
    await page.keyboard.type("c");
    await page.keyboard.press("Control+c");
    await expect(page.getByTestId("quick-create-panel")).toHaveCount(0);
    expect(counted.all()).toHaveLength(0);
  });

  test("a viewer with nothing to create has no button, no shortcut and no request (Q05)", async ({ page }) => {
    const counted = countQuickCreate(page);
    await signIn(page, "VIEWER", { to: "/dashboard" });
    await expect(page.getByTestId("notification-bell")).toBeVisible();
    await expect(page.getByTestId("quick-create-button")).toHaveCount(0);
    await page.locator("body").press("c");
    await expect(page.getByTestId("quick-create-panel")).toHaveCount(0);
    expect(counted.all()).toHaveLength(0);
  });

  test("a failure is not an empty menu: 500, malformed and timeout-like failures offer Retry; a real empty menu says so (Q10)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    let mode: "error" | "malformed" | "empty" | "real" = "error";
    await page.route("**/api/quick-create/actions**", async (route) => {
      if (mode === "error") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "x" } }) });
      if (mode === "malformed") return route.fulfill({ status: 200, contentType: "application/json", body: "{not json" });
      const response = await route.fetch();
      const body = (await response.json()) as { data: { actions: unknown[] } };
      if (mode === "empty") body.data.actions = [];
      return route.fulfill({ response, json: body });
    });
    const panel = page.getByTestId("quick-create-panel");
    await page.getByTestId("quick-create-button").click();
    await expect(panel.getByTestId("quick-create-error")).toContainText("Couldn't load actions.");
    mode = "malformed";
    await panel.getByTestId("quick-create-retry").click();
    await expect(panel.getByTestId("quick-create-error")).toBeVisible();
    mode = "empty";
    await panel.getByTestId("quick-create-retry").click();
    await expect(panel.getByTestId("quick-create-empty")).toContainText("No create actions are available here.");
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toHaveCount(0);
  });

  test("a menu drawn for another context is discarded, and the shell refreshes once (Q15)", async ({ page }) => {
    const counted = countQuickCreate(page);
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    await page.route("**/api/quick-create/actions**", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { data: { contextKey: string } };
      body.data.contextKey = "someone-else";
      return route.fulfill({ response, json: body });
    });
    await page.getByTestId("quick-create-button").click();
    await expect(page.getByTestId("quick-create-panel")).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(counted.actions()).toHaveLength(1);
  });

  test("closing before the answer and reopening is not disturbed by the late answer (Q11)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    let calls = 0;
    await page.route("**/api/quick-create/actions**", async (route) => {
      calls += 1;
      if (calls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return route.fulfill({ status: 500, body: "{}" });
      }
      return route.continue();
    });
    const panel = page.getByTestId("quick-create-panel");
    await page.getByTestId("quick-create-button").click();
    await expect(panel.getByTestId("quick-create-loading")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("quick-create-button").click();
    await expect(panel.getByTestId("quick-create-tasks.task.create")).toBeVisible();
    await page.waitForTimeout(1800);
    await expect(panel.getByTestId("quick-create-error")).toHaveCount(0);
    await expect(panel.getByTestId("quick-create-tasks.task.create")).toBeVisible();
  });

  test("navigating away while the menu loads closes it; the old answer lands nowhere (Q12)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/quick-create/actions**", async (route) => {
      await held;
      await route.continue();
    });
    await page.getByTestId("quick-create-button").click();
    await expect(page.getByTestId("quick-create-loading")).toBeVisible();
    await sidebar(page).locator('a[href="/tasks"]').click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId("quick-create-panel")).toHaveCount(0);
    release();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("quick-create-panel")).toHaveCount(0);
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test("one launch per choice, even on a double click; the create page opens with its context (Q17, Q22)", async ({ page }) => {
    const counted = countQuickCreate(page);
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    await page.getByTestId("quick-create-button").click();
    const panel = page.getByTestId("quick-create-panel");
    await expect(panel.getByTestId("quick-create-context")).toContainText("Riverside Residences");
    await panel.getByTestId("quick-create-tasks.task.create").dblclick();
    await expect(page).toHaveURL(/\/tasks\/new\?projectId=project_a$/);
    expect(counted.launches()).toHaveLength(1);
  });

  test("menu responses are private and uncached, and nothing of the menu is kept in browser storage (Q23)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    const answer = page.waitForResponse((response) => response.url().includes("/api/quick-create/actions"));
    await page.getByTestId("quick-create-button").click();
    const headers = (await answer).headers();
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["cache-control"]).toContain("private");
    await expect(page.getByTestId("quick-create-tasks.task.create")).toBeVisible();
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain("contextKey");
    expect(stored).not.toContain("tasks.task.create\",\"label");
  });
});

test.describe("+ Create in the Group workspace (Q06, Q19)", () => {
  test("a launch into a company finishes once, on its create page, despite its own workspace change", async ({ page }) => {
    const counted = countQuickCreate(page);
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard", workspace: "GROUP" });
    await page.getByTestId("quick-create-button").click();
    const panel = page.getByTestId("quick-create-panel");
    await panel.getByTestId("quick-create-tasks.task.create").click();
    await panel.getByTestId("quick-create-company").selectOption("company_demo_d");
    await panel.getByTestId("quick-create-continue").click();
    await expect(page).toHaveURL(/\/tasks\/new$/);
    await expect(mainRegion(page).getByRole("heading", { level: 1, name: "New task" })).toBeVisible();
    // The page was loaded again in the company it entered (Workspace Context §93).
    await expect(page.getByTestId("workspace-switcher")).not.toHaveAccessibleName(/Workspace: NESTO/i);
    expect(counted.launches()).toHaveLength(1);
    await expect(page.getByTestId("quick-create-panel")).toHaveCount(0);
  });
});

test.describe("a Group record opens in its company (NAV-04)", () => {
  test("the click shows the wait, enters the company and lands on the record, not back on the list", async ({ page }) => {
    await signIn(page, "OWNER", { workspace: "GROUP", to: "/tasks/all" });
    const link = mainRegion(page).locator("a[data-company-id]").first();
    await expect(link).toBeVisible();
    const record = await link.getAttribute("href");
    expect(record).toMatch(/^\/tasks\/task_/);

    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/workspace", async (route) => {
      if (route.request().method() === "POST") await released;
      await route.continue();
    });
    await link.click();
    // While the server decides, the link and the shell both say so.
    await expect(link).toHaveAttribute("aria-busy", "true");
    await expect(page.getByTestId("nav-progress")).toHaveAttribute("data-source", "workspace");

    // This tab's own workspace event used to reload the list underneath the navigation.
    const loaded = page.waitForEvent("load");
    release();
    await loaded;
    await expect(page).toHaveURL(new RegExp(`${record}$`));
    await expect(mainRegion(page).getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("workspace-switcher")).not.toHaveAccessibleName(/Workspace: NESTO/i);
  });
});
