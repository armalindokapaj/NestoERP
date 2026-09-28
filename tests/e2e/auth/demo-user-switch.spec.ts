import { expect, test, type Page } from "@playwright/test";

import { dashboardForRole } from "../../../config/dashboards";
import { DEMO_PASSWORD } from "../../../config/demo-accounts";
import { mainRegion, sidebar } from "../fixtures";

/**
 * The demo user switcher, in a browser (C-01 §64-§78, §89, §91).
 *
 * Choosing another demo user signs out and in as them: the page reloads as
 * their own dashboard, under their own name, and the session the browser held
 * before no longer opens anything.
 *
 * The switcher exists in development only, so this spec runs against a server
 * started with APP_ENV=development — `APP_ENV=development pnpm test:e2e:prod`,
 * or a dev server — and skips itself on any other.
 */

async function signInOnTheForm(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Chooses a person in the switcher and waits for their landing page to load from scratch. */
async function switchTo(page: Page, search: string, person: RegExp, landing: RegExp) {
  await page.getByRole("button", { name: "Switch demo user" }).click();
  const dialog = page.getByRole("dialog", { name: "Switch demo user" });
  await dialog.getByRole("searchbox", { name: "Search demo users" }).fill(search);
  await dialog.getByRole("button", { name: person }).click();
  await page.waitForURL(landing);
}

const userMenu = (page: Page) => page.getByRole("button", { name: /open user menu/i });

/**
 * A value the development access panel shows (§37): the session and the user
 * the page was resolved for. The cookie cannot say — Auth.js re-issues it on
 * every request.
 */
async function shown(page: Page, label: "Session ID" | "User ID"): Promise<string> {
  const value = page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd");
  const toggle = page.getByRole("button", { name: /dev access/i });
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(value).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return (await value.textContent()) ?? "";
}

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  test.skip((await page.getByText("Demo accounts").count()) === 0, "the demo user switcher exists in development only (APP_ENV=development)");
});

test.describe("demo user switcher (C-01)", () => {
  test("makes the Owner the Head of Finance: their name, role, dashboard and navigation; the Owner's session is over (§8, §64, §69, §70)", async ({ page, browser }) => {
    await signInOnTheForm(page, "armaar.owner");
    await expect(userMenu(page)).toContainText("Armand Lilo");
    const owner = { user: await shown(page, "User ID"), session: await shown(page, "Session ID") };
    const ownerCookies = await page.context().cookies();
    // A stale role-override cookie from before C-01 changes nothing, and goes.
    await page.context().addCookies([{ name: "nesto.dev-role", value: "QAQC", url: page.url() }]);

    // Started from a page of the Owner's: the switch never keeps it (§47).
    await page.goto("/settings/profile");
    await switchTo(page, "Edvin", /^Edvin Gace — /, /\/dashboard$/);

    await expect(userMenu(page)).toContainText("Edvin Gace");
    await expect(userMenu(page)).toContainText("Finance");
    await expect(userMenu(page)).not.toContainText("Armand Lilo");
    // The open menu's identity follows as well: name, role and workspace (Profile Menu §106).
    await userMenu(page).click();
    await expect(page.getByTestId("user-menu-name")).toHaveText("Edvin Gace");
    await expect(page.getByTestId("user-menu-context")).toContainText("Finance");
    await expect(page.getByTestId("user-menu")).not.toContainText("Armand Lilo");
    await page.keyboard.press("Escape");
    await expect(mainRegion(page).getByText(dashboardForRole("FINANCE", "GROUP_HEAD").focus)).toBeVisible();
    await expect(page.getByText("Viewing as")).toHaveCount(0);
    await expect(sidebar(page).getByRole("link", { name: "Finance", exact: true })).toBeVisible();
    expect((await page.context().cookies()).some((cookie) => cookie.name === "nesto.dev-role")).toBe(false);
    expect(await shown(page, "User ID")).not.toBe(owner.user);
    expect(await shown(page, "Session ID")).not.toBe(owner.session);

    // The Owner's old session opens nothing any more (§23, §69).
    const stale = await browser.newContext();
    await stale.addCookies(ownerCookies);
    const old = await stale.newPage();
    await old.goto("/dashboard");
    await expect(old).toHaveURL(/\/login/);
    await stale.close();
  });

  test("makes the Owner Eyes of Tirana's manager, who sees that project and not the group's others (§9, §67)", async ({ page }) => {
    await signInOnTheForm(page, "armaar.owner");
    await page.goto("/settings/profile");
    await switchTo(page, "Tedi", /^Tedi Gogu — /, /\/dashboard$/);

    await expect(userMenu(page)).toContainText("Tedi Gogu");
    await expect(userMenu(page)).toContainText("Project Manager");
    await expect(mainRegion(page).getByText(dashboardForRole("PROJECT_MANAGER").focus)).toBeVisible();
    await page.goto("/projects");
    await expect(mainRegion(page).getByText("Eyes of Tirana").first()).toBeVisible();
    await expect(mainRegion(page).getByText("Tirana Lake")).toHaveCount(0);
  });

  test("goes to the Platform Admin's area and back into a company (§26, §27, §78)", async ({ page }) => {
    await signInOnTheForm(page, "armaar.owner");
    await page.goto("/settings/profile");
    await switchTo(page, "platform", /\(platform-admin\)$/, /\/admin$/);
    await expect(page.getByRole("button", { name: "Switch demo user" })).toBeVisible();

    await switchTo(page, "Armand", /^Armand Lilo — /, /\/dashboard$/);
    await expect(userMenu(page)).toContainText("Armand Lilo");
    await expect(mainRegion(page).getByText(dashboardForRole("OWNER", "GROUP_HEAD").focus)).toBeVisible();
  });

  test("marks the signed-in person, and choosing them changes nothing (§42)", async ({ page }) => {
    await signInOnTheForm(page, "armaar.finance");
    await page.goto("/settings/profile");
    const session = await shown(page, "Session ID");

    await page.getByRole("button", { name: "Switch demo user" }).click();
    const dialog = page.getByRole("dialog", { name: "Switch demo user" });
    await dialog.getByRole("searchbox", { name: "Search demo users" }).fill("gace");
    const self = dialog.getByRole("button", { name: /^Edvin Gace — .*, signed in$/ });
    await expect(self).toHaveAttribute("aria-current", "true");
    await self.click();

    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await page.reload();
    expect(await shown(page, "Session ID")).toBe(session);
  });

  test("switching company keeps the person and the session; only the company changes (§10, §75)", async ({ page }) => {
    await signInOnTheForm(page, "armaar.finance");
    const before = { user: await shown(page, "User ID"), session: await shown(page, "Session ID") };

    const header = page.getByTestId("sidebar-header").getByTestId("organization-header");
    await header.click();
    await page.getByTestId("workspace-option").filter({ hasText: "ARLIS - NDERTIM" }).click();
    await expect(header).toHaveAccessibleName(/Current workspace: ARLIS - NDERTIM/);

    await expect(userMenu(page)).toContainText("Edvin Gace");
    await expect(userMenu(page)).toContainText("Finance");
    expect({ user: await shown(page, "User ID"), session: await shown(page, "Session ID") }).toEqual(before);
  });
});
