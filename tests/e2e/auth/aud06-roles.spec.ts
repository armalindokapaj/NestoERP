import { expect, test } from "@playwright/test";

import { dashboardForRole } from "../../../config/dashboards";
import { DEMO_PASSWORD } from "../../../config/demo-accounts";
import { mainRegion, signIn } from "../fixtures";

/**
 * AUD-06 in a browser: what a person sees and can do follows who they are, on
 * every surface.
 */

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

test.describe("scope by the URL (RP-08, RP-13)", () => {
  test("a company's Owner is turned away from the platform administration, page and API", async ({ page }) => {
    await signIn(page, "OWNER");
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/);
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
