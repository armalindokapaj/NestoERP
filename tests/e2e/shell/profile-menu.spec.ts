import { expect, test, type Locator, type Page } from "@playwright/test";

import { db } from "../db";
import { signIn, switchCompany } from "../fixtures";

/**
 * The top-bar account menu (Profile Menu PRD §98-§114): two identity lines that
 * open the person's own Profile, Settings on its own, and a red Logout that ends
 * the session on the server. Migena Bajro is the PRD's own example.
 */

const ARLIS = "armaar_co_arlis_ndertim";
const IDEAL = "armaar_co_ideal_construction";

const trigger = (page: Page) => page.getByRole("button", { name: /open user menu/i });
/** The trigger by its markup: while the menu is open, Radix hides the rest of the page from the accessibility tree. */
const triggerElement = (page: Page) => page.locator('button[aria-label="Open user menu"]');
const menu = (page: Page) => page.getByTestId("user-menu");
const profile = (page: Page) => page.getByTestId("user-menu-profile");
const logout = (page: Page) => page.getByRole("menuitem", { name: /^(Logout|Signing out…)$/ });

async function openMenu(page: Page) {
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
}

/** What a design token resolves to here, read the way the browser paints it. */
async function token(page: Page, variable: string, property: "color" | "backgroundColor"): Promise<string> {
  return page.evaluate(
    ([name, prop]) => {
      const probe = document.createElement("span");
      probe.style[prop as "color"] = `var(${name})`;
      document.body.append(probe);
      const value = getComputedStyle(probe)[prop as "color"];
      probe.remove();
      return value;
    },
    [variable, property] as const,
  );
}

const css = (locator: Locator, property: "color" | "backgroundColor") =>
  locator.evaluate((element, prop) => getComputedStyle(element)[prop as "color"], property);

test("two lines, name then Role · Company, and opening it fetches nothing (§98, §114)", async ({ page }) => {
  await signIn(page, "ARMAAR_LEGAL", { company: ARLIS, to: "/dashboard" });

  const calls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) calls.push(request.url());
  });
  await openMenu(page);

  await expect(profile(page).getByTestId("user-menu-name")).toHaveText("Migena Bajro");
  await expect(profile(page).getByTestId("user-menu-context")).toHaveText("Legal · ARLIS - NDERTIM");
  // Exactly two visible lines: the old third row for the company is gone (§6).
  await expect(profile(page).locator(":scope > span > span:not(.sr-only)")).toHaveCount(2);
  const [name, context] = await Promise.all([
    profile(page).getByTestId("user-menu-name").boundingBox(),
    profile(page).getByTestId("user-menu-context").boundingBox(),
  ]);
  expect(context!.y).toBeGreaterThan(name!.y);
  expect(calls).toEqual([]);
});

test("the identity block is one link to the person's own Profile; Settings stays separate (§99, §100)", async ({ page }) => {
  await signIn(page, "ARMAAR_LEGAL", { company: ARLIS, to: "/dashboard" });
  await openMenu(page);

  await expect(profile(page)).toHaveAttribute("href", "/settings/profile");
  await expect(profile(page)).toHaveAttribute("role", "menuitem");
  await expect(profile(page)).toHaveAccessibleName(/Migena Bajro.*My profile$/);
  await profile(page).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.locator("#nesto-main").getByText("Migena Bajro", { exact: true }).last()).toBeVisible();

  await openMenu(page);
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("Logout is red before any hover, red-tinted on hover, and apart from Settings (§101, §102)", async ({ page }) => {
  await signIn(page, "ARMAAR_LEGAL", { company: ARLIS, to: "/dashboard" });
  await openMenu(page);

  const red = await token(page, "--nesto-danger-strong", "color");
  await expect.poll(() => css(logout(page), "color")).toBe(red);
  expect(await css(logout(page).locator("svg"), "color")).toBe(red);
  // Settings keeps the neutral text colour: red belongs to Logout alone (§38).
  expect(await css(page.getByRole("menuitem", { name: "Settings", exact: true }), "color")).not.toBe(red);
  // A divider sits between them (§37).
  await expect(logout(page).locator("xpath=preceding-sibling::*[1]")).toHaveAttribute("role", "separator");

  await logout(page).hover();
  await expect.poll(() => css(logout(page), "backgroundColor")).toBe(await token(page, "--nesto-danger-soft", "backgroundColor"));
  expect(await css(logout(page), "color")).toBe(red);
  // A pointer gets the tint alone; the ring is for the keyboard (§34, §35).
  expect(await logout(page).evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
});

test("Logout ends the session on the server and lands on sign-in with a fresh page (§103)", async ({ page, browser }) => {
  await signIn(page, "ARMAAR_LEGAL", { company: ARLIS, to: "/dashboard" });
  const cookies = await page.context().cookies();
  const user = await db.user.findFirstOrThrow({ where: { username: "armaar.legal" }, select: { id: true } });
  const sessionsBefore = await db.session.count({ where: { userId: user.id } });
  await page.evaluate(() => ((window as unknown as { __beforeLogout: boolean }).__beforeLogout = true));

  await openMenu(page);
  await logout(page).click();
  await page.waitForURL(/\/login/);

  // A full load: nothing of the signed-in page survives in this tab (§44).
  expect(await page.evaluate(() => (window as unknown as { __beforeLogout?: boolean }).__beforeLogout)).toBeUndefined();
  expect(await db.session.count({ where: { userId: user.id } })).toBe(sessionsBefore - 1);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  // The old cookie is dead everywhere, not just forgotten here (§43).
  const other = await browser.newContext();
  await other.addCookies(cookies);
  const stale = await other.newPage();
  await stale.goto("/dashboard");
  await expect(stale).toHaveURL(/\/login/);
  await other.close();
});

test("the second line follows the workspace: ARLIS → IDEAL → the group (§104, §105)", async ({ page }) => {
  await signIn(page, "ARMAAR_LEGAL", { company: ARLIS, to: "/dashboard" });
  await openMenu(page);
  await expect(profile(page).getByTestId("user-menu-context")).toHaveText("Legal · ARLIS - NDERTIM");
  await page.keyboard.press("Escape");

  // Switched with the workspace chooser, as a person would.
  await page.getByTestId("workspace-switcher").click();
  await page.getByTestId("workspace-search").fill("IDEAL");
  await page.getByTestId("workspace-option").filter({ hasText: "IDEAL Construction" }).click();
  await expect(page.getByTestId("workspace-switcher")).toHaveAccessibleName(/IDEAL Construction/);
  await openMenu(page);
  await expect(profile(page).getByTestId("user-menu-context")).toHaveText("Legal · IDEAL Construction");
  await page.keyboard.press("Escape");

  const group = await page.request.post("/api/workspace", { data: { scopeType: "GROUP" } });
  expect(group.ok(), "Migena may enter the group").toBe(true);
  await page.goto("/dashboard");
  await openMenu(page);
  await expect(profile(page).getByTestId("user-menu-context")).toHaveText("Legal · ARMAAR GROUP");
  // The menu names the workspace but never switches it (§50).
  await expect(menu(page).getByRole("menuitem")).toHaveCount(3);
  await switchCompany(page, IDEAL);
});

test("keyboard: Enter opens, arrows walk Profile → Settings → Logout, Escape closes back to the trigger (§62, §67, §68, §70, §110, §111)", async ({ page }) => {
  await signIn(page, "ARMAAR_LEGAL", { company: ARLIS, to: "/dashboard" });

  await expect(trigger(page)).toHaveAttribute("aria-haspopup", "menu");
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
  await trigger(page).focus();
  await page.keyboard.press("Enter");
  await expect(triggerElement(page)).toHaveAttribute("aria-expanded", "true");
  await expect(profile(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(logout(page)).toBeFocused();
  // The keyboard highlight is drawn, not only the background (§35).
  expect(await logout(page).evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");

  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();

  // Enter follows the Profile link.
  await page.keyboard.press("Enter");
  await expect(profile(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\/profile$/);
});

test("a click outside closes the menu (§112)", async ({ page }) => {
  await signIn(page, "ARMAAR_LEGAL", { company: ARLIS, to: "/dashboard" });
  await openMenu(page);
  await page.mouse.click(10, 400);
  await expect(menu(page)).toHaveCount(0);
});

test("a long name and workspace truncate inside the menu, with the full text on hover (§54-§57, §107)", async ({ page }) => {
  const user = await db.user.findFirstOrThrow({ where: { username: "engineer-c" }, select: { id: true, lastName: true } });
  await db.user.update({ where: { id: user.id }, data: { lastName: "Basha-Kristoforidhi-Vrioni-Frashëri-Toptani" } });
  try {
    await signIn(page, "ENGINEER_C", { to: "/dashboard" });
    await openMenu(page);
    const name = profile(page).getByTestId("user-menu-name");
    await expect(name).toHaveAttribute("title", "Lorik Basha-Kristoforidhi-Vrioni-Frashëri-Toptani");
    expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const context = profile(page).getByTestId("user-menu-context");
    await expect(context).toHaveAttribute("title", await context.innerText());
    // Nothing spills out of the menu (§107).
    expect(await menu(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  } finally {
    await db.user.update({ where: { id: user.id }, data: { lastName: user.lastName } });
  }
});

test.describe("phone width (§58-§60, §113)", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test("two lines and a red Logout, all inside the screen", async ({ page }) => {
    await signIn(page, "ARMAAR_LEGAL", { company: ARLIS, to: "/dashboard" });
    await openMenu(page);
    await expect(profile(page).getByTestId("user-menu-context")).toHaveText("Legal · ARLIS - NDERTIM");
    await expect.poll(() => css(logout(page), "color")).toBe(await token(page, "--nesto-danger-strong", "color"));
    const box = await menu(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  });
});
