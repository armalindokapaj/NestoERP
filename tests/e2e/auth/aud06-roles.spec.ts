import { expect, test, type Page } from "@playwright/test";

import { dashboardForRole } from "../../../config/dashboards";
import { DEMO_PASSWORD } from "../../../config/demo-accounts";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * AUD-06 in a browser: what a person sees and can do follows who they are, on
 * every surface, and nothing of a previous identity survives a switch.
 *
 * The demo switcher and picker exist in development only: the tests that need
 * them skip themselves on any other server (start the E2E server with
 * APP_ENV=development). The rest run everywhere.
 */

async function devMode(page: Page): Promise<boolean> {
  await page.goto("/login");
  return (await page.getByText("Demo accounts").count()) > 0;
}

async function signInOnTheForm(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("the demo conveniences (RP-04)", () => {
  test("the sign-in page never carries a demo password, in its text or its markup", async ({ page }) => {
    await page.goto("/login");
    const html = await page.content();
    expect(html).not.toContain(DEMO_PASSWORD);
    // Nor anything the client bundle could hand over: the picker sends a username only.
    const scripts = await page.evaluate(() => Array.from(document.scripts).map((script) => script.textContent ?? "").join("\n"));
    expect(scripts).not.toContain(DEMO_PASSWORD);
  });
});

test.describe("a switch replaces everything (RP-02, RP-05)", () => {
  test("after a switch, a tab still showing the previous person can neither read nor write", async ({ page, browser }) => {
    test.skip(!(await devMode(page)), "the demo user switcher exists in development only");
    await signInOnTheForm(page, "armaar.owner");
    const ownerCookies = await page.context().cookies();
    // A second tab of the Owner's, open on a page before the switch.
    const staleContext = await browser.newContext();
    await staleContext.addCookies(ownerCookies);
    const stale = await staleContext.newPage();
    await stale.goto("/tasks");

    await page.getByRole("button", { name: "Switch demo user" }).click();
    const dialog = page.getByRole("dialog", { name: "Switch demo user" });
    await dialog.getByRole("searchbox", { name: "Search demo users" }).fill("Besar");
    await dialog.getByRole("button", { name: /^Besar Zifla — / }).click();
    await page.waitForURL(/\/dashboard$/);
    await expect(mainRegion(page).getByText(dashboardForRole("ARCHITECT", "GROUP_HEAD").focus)).toBeVisible();

    // The Owner's session is over: a write from the stale tab is refused, not performed.
    const write = await stale.evaluate(async () => {
      const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "AUD06E stale write" }) });
      return response.status;
    });
    expect(write).toBe(401);
    await stale.goto("/dashboard");
    await expect(stale).toHaveURL(/\/login/);
    await staleContext.close();
  });
});

test.describe("scope by the URL (RP-08, RP-13)", () => {
  test("a project-scoped manager cannot open another project of the group by its address or its API", async ({ page }) => {
    test.skip(!(await devMode(page)), "Tedi Gogu's demo login is part of the development demo");
    // A project of his group he is not on: from the data, not a guess.
    const tedi = await db.user.findUniqueOrThrow({ where: { username: "unico.pm" }, select: { memberships: { select: { id: true, companyId: true } } } });
    const memberIds = tedi.memberships.map((membership) => membership.id);
    const elsewhere = await db.project.findFirstOrThrow({
      where: {
        companyId: { in: tedi.memberships.map((membership) => membership.companyId) },
        projectManagerMemberId: { notIn: memberIds },
        members: { none: { companyMemberId: { in: memberIds } } },
      },
      select: { id: true, name: true },
    });
    await signInOnTheForm(page, "unico.pm");
    await page.goto(`/projects/${elsewhere.id}`);
    await expect(mainRegion(page)).not.toContainText(elsewhere.name);
    const response = await page.request.get(`/api/projects/${elsewhere.id}`);
    expect([403, 404]).toContain(response.status());
    expect(await response.text()).not.toContain(elsewhere.name);
  });

  test("a company's Owner is turned away from the platform administration, page and API", async ({ page }) => {
    await signIn(page, "OWNER");
    await page.goto("/platform-admin");
    await expect(page).not.toHaveURL(/\/platform-admin/);
    const api = await page.request.get("/api/platform/parent-groups");
    expect([401, 403, 404]).toContain(api.status());
  });
});

test.describe("the Group Owner's dashboard (RP-19)", () => {
  test("is the Owner's in the company and in the group workspace, whatever an old cookie says", async ({ page }) => {
    await signIn(page, "OWNER");
    await page.context().addCookies([{ name: "nesto.dev-role", value: "QAQC", url: new URL("/", page.url()).toString() }]);
    await page.goto("/dashboard");
    const owner = dashboardForRole("OWNER", "GROUP_HEAD").focus;
    await expect(mainRegion(page).getByText(owner)).toBeVisible();
    await expect(mainRegion(page).getByText(dashboardForRole("QAQC").focus)).toHaveCount(0);
  });
});

test.describe("the same actions on a phone (RP-23)", () => {
  test("a Viewer is offered no create action on a phone or a desktop", async ({ page }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await signIn(page, "VIEWER", { to: "/tasks" });
      await expect(mainRegion(page).getByRole("link", { name: /new task/i })).toHaveCount(0);
      await expect(mainRegion(page).getByRole("button", { name: /new task/i })).toHaveCount(0);
      await page.context().clearCookies();
    }
  });
});
