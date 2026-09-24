import { expect, test, type Page } from "@playwright/test";

import { memberIdFor, resetAnnouncements } from "../announcements-fixtures";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * The shell's optional slots (NAV-02 §7, §8, §17.2: S01, S02, S04, S05, S06,
 * S07, S09, S10, S17).
 *
 * The workspace chooser and the critical banner are streamed into the shell;
 * the page never waits for them. The delays and failures are the server's
 * test-only hook (`lib/workspace/shell-slots.ts`): a production build started
 * with NESTO_TEST_SHELL_DELAYS=1 holds or fails a slot's read as the
 * `nesto-test-shell-delay` cookie says. Without it those tests skip.
 */

const HOOKED = process.env.NESTO_TEST_SHELL_DELAYS === "1";
const GROUP_NAME = "NESTO Demo Group";

async function delay(page: Page, rules: string) {
  const origin = new URL(page.url() === "about:blank" ? (test.info().project.use.baseURL ?? "http://127.0.0.1:3000") : page.url()).origin;
  await page.context().addCookies([{ name: "nesto-test-shell-delay", value: rules, url: origin }]);
}

test.describe("slots never hold up the page", () => {
  test.skip(!HOOKED, "Start the server with NESTO_TEST_SHELL_DELAYS=1 to delay shell slots.");

  test("a slow workspace chooser: the page is usable at once, the verified name holds its place (S01)", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await delay(page, "workspaces=4000");
    const started = Date.now();
    await page.goto("/tasks", { waitUntil: "commit" });
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    const usable = Date.now() - started;
    const slot = page.getByTestId("workspace-slot");
    await expect(slot).toHaveAttribute("data-state", "pending");
    await expect(slot).toHaveAccessibleName(/Aurelia Construction\. Loading the other workspaces/);
    expect(usable).toBeLessThan(3000);
    // A page control works while the chooser is still on its way.
    await expect(mainRegion(page).getByRole("link").first()).toBeEnabled();
    await expect(page.getByTestId("workspace-switcher")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("workspace-slot")).toHaveCount(0);
  });

  test("a failed chooser keeps the current workspace and retries on its own (S04)", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await delay(page, "workspaces=0:fail");
    await page.goto("/tasks");
    const slot = page.getByTestId("workspace-slot");
    await expect(slot).toHaveAttribute("data-state", "failed");
    await expect(slot).toHaveAccessibleName(/Aurelia Construction\. The other workspaces could not be loaded/);
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    const retries: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/shell/")) retries.push(new URL(request.url()).pathname);
    });
    await page.getByTestId("workspace-slot-retry").click();
    await expect(page.getByTestId("workspace-switcher")).toBeVisible();
    expect(retries).toEqual(["/api/shell/workspaces"]);
  });

  test("a retry that answers first is not overwritten by the late first answer (S05)", async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page, "OWNER", { to: "/dashboard" });
    // The first answer arrives after nine seconds, and fails; the retry answers at once.
    await delay(page, "workspaces=9000:fail,workspaces-retry=0");
    const started = Date.now();
    await page.goto("/tasks", { waitUntil: "commit" });
    const retry = page.getByTestId("workspace-slot-retry");
    // Offered only once the slot has waited five seconds.
    await expect(retry).toBeVisible({ timeout: 8_000 });
    expect(Date.now() - started).toBeGreaterThan(4_500);
    await retry.click();
    await expect(page.getByTestId("workspace-switcher")).toBeVisible();
    // Past the first answer's arrival: the switcher is still there, not the failure.
    await page.waitForTimeout(Math.max(0, 10_500 - (Date.now() - started)));
    await expect(page.getByTestId("workspace-switcher")).toBeVisible();
    await expect(page.getByTestId("workspace-slot")).toHaveCount(0);
  });

  test("while the chooser loads, the Group crumb is not yet a link; the record page is not held (S07)", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await delay(page, "workspaces=3000");
    // Not "load": a streamed document's load event waits for its last slot.
    await page.goto("/projects/project_a", { waitUntil: "commit" });
    const header = page.getByTestId("record-navigation-header");
    await expect(header).toBeVisible();
    await expect(header.getByText(GROUP_NAME).first()).toBeVisible();
    await expect(header.getByRole("link", { name: GROUP_NAME })).toHaveCount(0);
    await expect(header.getByRole("link", { name: GROUP_NAME })).toHaveCount(1, { timeout: 10_000 });
  });

  test("a new workspace starts from its own stream, never the old one's answer (S06)", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await delay(page, "workspaces=2500");
    await page.goto("/tasks", { waitUntil: "commit" });
    await expect(page.getByTestId("workspace-slot")).toHaveAccessibleName(/Aurelia Construction/);
    // Switched elsewhere (as another tab would), then the next document.
    await page.request.post("/api/workspace", { data: { scopeType: "GROUP" } });
    await page.goto("/tasks", { waitUntil: "commit" });
    await expect(page.getByTestId("workspace-slot")).toHaveAccessibleName(new RegExp(`${GROUP_NAME} — Group Company`));
    await expect(page.getByTestId("workspace-switcher")).toHaveAttribute("data-scope", "GROUP", { timeout: 10_000 });
  });
});

test.describe("the critical banner has its place kept (S02)", () => {
  const ID = "announcement_e2e_shell_slot_banner";

  test.beforeAll(async () => {
    await resetAnnouncements();
    const [owner, engineer] = await Promise.all([memberIdFor("owner@nesto.test"), memberIdFor("engineer@nesto.test")]);
    await db.announcement.create({
      data: {
        id: ID, companyId: "company_demo_a", status: "PUBLISHED", priority: "CRITICAL", audienceType: "COMPANY", requiresAcknowledgment: false,
        title: "Tower crane out of service until Friday", body: "Use the east hoist.",
        authorMemberId: owner, publishedByMemberId: owner, publishedAt: new Date(),
        targets: { create: [{ memberId: engineer, targetedAt: new Date() }] },
      },
    });
  });

  test.afterAll(async () => {
    await db.announcementRead.deleteMany({ where: { announcementId: ID } });
    await resetAnnouncements();
  });

  test("a late banner moves nothing on the page", async ({ page }) => {
    test.skip(!HOOKED, "Start the server with NESTO_TEST_SHELL_DELAYS=1 to delay shell slots.");
    await signIn(page, "ENGINEER", { to: "/dashboard" });
    await delay(page, "banner=2500");
    await page.goto("/tasks", { waitUntil: "commit" });
    const heading = mainRegion(page).locator("h1").first();
    await expect(heading).toBeVisible();
    const before = await heading.boundingBox();
    await expect(page.getByTestId("critical-announcement-banner")).toBeVisible({ timeout: 10_000 });
    const after = await heading.boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  });

  test("the reserved region fits the tallest banner at every width", async ({ page }) => {
    await signIn(page, "ENGINEER", { to: "/tasks" });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const banner = page.getByTestId("critical-announcement-banner");
      await expect(banner).toBeVisible();
      const region = await page.getByTestId("critical-banner-region").boundingBox();
      const shown = await banner.boundingBox();
      expect(shown!.height, `${width}px`).toBeLessThanOrEqual(region!.height + 0.5);
      expect(region!.height, `${width}px`).toBeLessThanOrEqual(shown!.height + 0.5);
    }
  });
});

test.describe("slots stay quiet", () => {
  test("ten ordinary navigations make no slot or + Create request (S09)", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/shell/") || path.startsWith("/api/quick-create/") || path === "/api/workspaces") calls.push(path);
    });
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    await page.waitForLoadState("load");
    calls.length = 0;
    const nav = page.locator('nav[aria-label="Main navigation"]');
    for (const href of ["/tasks", "/projects", "/documents", "/calendar", "/approvals", "/tasks", "/projects", "/documents", "/calendar", "/dashboard"]) {
      await nav.locator(`a[href="${href}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
    }
    expect(calls).toEqual([]);
  });

  test("a person with one workspace gets no workspace control, then or later", async ({ page }) => {
    await signIn(page, "VIEWER", { to: "/dashboard" });
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    await page.waitForLoadState("load");
    for (const id of ["workspace-slot", "workspace-current", "workspace-switcher"]) await expect(page.getByTestId(id)).toHaveCount(0);
  });

  test("a production build never mounts the development access panel (S10)", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Dev access/ })).toHaveCount(0);
  });
});

test.describe("slot states on a phone and with reduced motion (S17)", () => {
  test.skip(!HOOKED, "Start the server with NESTO_TEST_SHELL_DELAYS=1 to delay shell slots.");

  test("the top bar of a person with one workspace fits a 320px screen while the shell streams", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await delay(page, "workspaces=3000,banner=3000");
    await page.goto("/tasks", { waitUntil: "commit" });
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    // The shell's own bar; the page's content has its own width rules.
    const bar = await page.locator("header").first().evaluate((header) => ({ overflow: header.scrollWidth - header.clientWidth, right: header.getBoundingClientRect().right }));
    expect(bar.overflow).toBeLessThanOrEqual(0);
    expect(bar.right).toBeLessThanOrEqual(320);
  });

  test("the pending control is the switcher's own size, and does not spin under reduced motion", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page, "OWNER", { to: "/dashboard" });
    await delay(page, "workspaces=3000");
    await page.goto("/tasks", { waitUntil: "commit" });
    const slot = page.getByTestId("workspace-slot");
    await expect(slot).toBeVisible();
    const pending = await slot.boundingBox();
    const spinning = await slot.locator("svg").last().evaluate((icon) => getComputedStyle(icon).animationName);
    expect(spinning).toBe("none");
    const switcher = page.getByTestId("workspace-switcher");
    await expect(switcher).toBeVisible({ timeout: 10_000 });
    const ready = await switcher.boundingBox();
    expect(Math.abs(ready!.width - pending!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(ready!.x - pending!.x)).toBeLessThanOrEqual(1);
  });
});
