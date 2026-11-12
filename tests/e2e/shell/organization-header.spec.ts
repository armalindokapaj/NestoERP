import { expect, test, type Locator, type Page } from "@playwright/test";

import { chooseWorkspace, DEMO_PASSWORD, dropOrphanedStreamSegments, mainRegion, signIn, workspaceHeader, workspacePanel, openWorkspaceSwitcher } from "../fixtures";

/**
 * Home, the workspace switch and its popup (Sidebar Organization Workspace
 * Header PRD, "OW", §72-§90, §107; docs/ui/UI-04-navigation-layouts.md).
 *
 * The top bar's Home names the workspace being worked in — the company, or the
 * group in the Group workspace — and is the way to its dashboard; it switches
 * nothing. The switch is the header of the logo's panel, at every width: the
 * workspace's mark and name with a small chevron, its popup hanging under it
 * with a pointer. A switch keeps the page where it can, is made in place
 * without a document load, and the names change only once the new workspace
 * has committed.
 */

const AURELIA = "company_demo_a";
const GROUP = "NESTO Demo Group";

/** No arrow, chevron, caret or dropdown sign, in any state (§4, §74, §92): the top bar's workspace header draws no icon at all. */
async function expectNoArrow(header: Locator) {
  // Home's small house is the only drawing it may carry.
  await expect(header.locator("svg:not([data-home-icon])")).toHaveCount(0);
  await expect(header.locator('[class*="chevron"], [class*="caret"], [class*="arrow"]')).toHaveCount(0);
  const text = await header.innerText();
  expect(text).not.toMatch(/[⌄∨▾▼›>]/);
}

/** A popup on a touch layout grows out of its control (styles/globals.css, `nesto-pop-in`): it is measured once it has landed. */
async function landed(popup: Locator) {
  await popup.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)).then(() => undefined));
}

async function signInAs(page: Page, username: string) {
  await dropOrphanedStreamSegments(page);
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Marks this document, so a test can tell an in-place switch from a new document (§34). */
async function markDocument(page: Page) {
  await page.evaluate(() => ((window as unknown as { __owDocument: boolean }).__owDocument = true));
}
async function sameDocument(page: Page) {
  return page.evaluate(() => (window as unknown as { __owDocument?: boolean }).__owDocument === true);
}

test.describe("identity (§72, §73, §86, §91, §96)", () => {
  test("a standalone company is the organization: no group, one name, nothing to switch (§8, §45, §86, §87)", async ({ page }) => {
    await signInAs(page, "solo-owner");
    await page.goto("/dashboard");
    const header = workspaceHeader(page);
    await expect(header.getByTestId("workspace-label")).toHaveText("Solo Studio");
    await expect(header).toHaveAccessibleName("Dashboard. Current workspace: Solo Studio.");
    await expect(header).toHaveAttribute("data-scope", "COMPANY");
    // One line: the organization is not written above the workspace, here or anywhere in the header (§7, §8).
    await expect(header.getByTestId("organization-name")).toHaveCount(0);
    await expect(page.getByTestId("topbar-home")).not.toContainText("Solo Studio Holding");
    // Nothing to switch: Home presses nothing but home, and the panel's header is identity only (§46).
    await expect(page.getByTestId("topbar-home").getByRole("button")).toHaveCount(0);
    await expect(await openWorkspaceSwitcher(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect((await page.request.post("/api/workspace", { data: { scopeType: "GROUP" } })).status()).toBe(403);
    await expectNoArrow(header);
  });

  test("one workspace: the header names it and leads home; no switcher, then or later (§46, §87)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    const header = workspaceHeader(page);
    await expect(header.getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    // Not drawn and disabled: not rendered at all, once the chooser has streamed in too (§46).
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    await page.waitForLoadState("load");
    await expect(await openWorkspaceSwitcher(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await header.click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(workspacePanel(page)).toHaveCount(0);
    await expectNoArrow(header);
  });

  test("the top bar's workspace header names the workspace alone and is the way to its dashboard, from any part of it (§2, §7, §18)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/projects" });
    const header = workspaceHeader(page);
    // A link: the same destination as the Dashboard item, and no part of a switch.
    await expect(header).toHaveRole("link");
    await expect(header).toHaveAttribute("href", "/dashboard");
    await expect(header).toHaveAccessibleName("Dashboard. Current workspace: Aurelia Construction.");
    await expect(header).toHaveAttribute("data-scope", "COMPANY");
    for (const attribute of ["data-options", "aria-haspopup", "aria-expanded"]) await expect(header).not.toHaveAttribute(attribute);
    // One line — the company's own name — over a small Home; the mark is the logo's, beside it (§5, §7).
    await expect(header.getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await expect(header.getByTestId("organization-name")).toHaveCount(0);
    await expect(header).not.toContainText(GROUP);

    const box = (await header.boundingBox())!;
    const parts: Array<() => Promise<void>> = [
      () => header.getByTestId("workspace-label").click(),
      // The padding: the far right edge, inside the header.
      () => header.click({ position: { x: box.width - 3, y: box.height / 2 } }),
    ];
    for (const press of parts) {
      await page.goto("/projects");
      await press();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(workspacePanel(page)).toHaveCount(0);
    }
  });

  test("in the Group workspace Home names the group, and so does the switch (§7, §73)", async ({ page }) => {
    await signIn(page, "OWNER", { workspace: "GROUP", to: "/dashboard" });
    const header = workspaceHeader(page);
    await expect(header.getByTestId("workspace-label")).toHaveText(GROUP);
    await expect(header).toHaveAccessibleName(`Dashboard. Current workspace: ${GROUP} — Group Workspace.`);
    await expect(header).toHaveAttribute("data-scope", "GROUP");
    const switcher = await openWorkspaceSwitcher(page);
    await expect(switcher.getByTestId("workspace-label")).toHaveText(GROUP);
    await expect(switcher).toHaveAccessibleName(`Switch workspace. Current workspace: ${GROUP} — Group Workspace.`);
    await expect(switcher).toHaveAttribute("data-scope", "GROUP");
  });
});

test.describe("the switch, in the logo's panel (§14-§17, §74, §75, §90; docs/ui/UI-04-navigation-layouts.md)", () => {
  test("the panel's header is the switch: the workspace's mark and name and a small chevron, and nothing in the top bar (§3, §5, §14)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/dashboard" });
    await expect(page.locator("header[data-shell-region]").getByTestId("workspace-switcher")).toHaveCount(0);
    const switcher = await openWorkspaceSwitcher(page);
    await expect(switcher).toHaveRole("button");
    await expect(switcher).toHaveAccessibleName("Switch workspace. Current workspace: Aurelia Construction.");
    await expect(switcher).toHaveAttribute("data-scope", "COMPANY");
    await expect(switcher).toHaveAttribute("aria-haspopup", "dialog");
    await expect(switcher.getByTestId("organization-mark")).toBeVisible();
    await expect(switcher.getByTestId("workspace-label")).toHaveText("Aurelia Construction");
  });

  test("the popup: its name, the Group first, then only this person's companies, alphabetically, the current one selected (§20-§27, §76)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    await (await openWorkspaceSwitcher(page)).click();
    const panel = workspacePanel(page);
    await expect(panel).toHaveAccessibleName("Switch Workspace");
    const options = panel.getByTestId("workspace-option");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveAttribute("data-scope", "GROUP");
    await expect(options.nth(0)).toContainText("All accessible Group data");
    await expect(options.nth(1)).toContainText("Aurelia Construction");
    await expect(options.nth(2)).toContainText("Forma Engineering");
    // Nothing else of the group is listed, disabled or counted (§24).
    await expect(panel).not.toContainText("Meridian");
    await expect(panel).not.toContainText("Terra");
    await expect(panel.getByRole("option", { selected: true })).toContainText("Aurelia Construction");
    // Two companies: no search field (§25).
    await expect(panel.getByTestId("workspace-search")).toHaveCount(0);
  });

  test("keyboard: Enter opens it, the current workspace is active, arrows move, Escape closes back to the switch (§52-§56, §90)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    const switcher = await openWorkspaceSwitcher(page);
    await expect(switcher).toHaveAttribute("aria-expanded", "false");
    await switcher.focus();
    await page.keyboard.press("Enter");
    const list = workspacePanel(page).getByRole("listbox");
    await expect(list).toBeFocused();
    const activeId = async () => list.getAttribute("aria-activedescendant");
    await expect(page.locator(`[id="${await activeId()}"]`)).toContainText("Aurelia Construction");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(`[id="${await activeId()}"]`)).toContainText("Forma Engineering");
    await page.keyboard.press("Escape");
    await expect(workspacePanel(page)).toHaveCount(0);
    await expect(switcher).toBeFocused();
  });
});

test.describe("switching (§28-§37, §78-§83)", () => {
  test("a valid route is kept, in place: no document load, the new names, the new company's list (§28, §30, §34, §78)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/projects" });
    await expect(mainRegion(page).getByTestId("project-card").first()).toBeVisible();
    await markDocument(page);

    await chooseWorkspace(page, "Forma Engineering");
    await expect(page).toHaveURL(/\/projects$/);
    expect(await sameDocument(page)).toBe(true);
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Forma Engineering");
    for (const label of await mainRegion(page).getByTestId("project-company").allInnerTexts()) expect(label).toBe("Forma Engineering");
    // No success toast for a switch that kept the page (§36).
    await expect(page.getByRole("status").filter({ hasText: /Switched to/ })).toHaveCount(0);
  });

  test("a record of the old company falls back to its list, and says why (§29, §31, §36, §79)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/projects/project_a" });
    await expect(mainRegion(page).getByRole("heading", { name: "Riverside Residences" }).first()).toBeVisible();
    await markDocument(page);

    await chooseWorkspace(page, "Forma Engineering");
    await expect(page).toHaveURL(/\/projects$/);
    expect(await sameDocument(page)).toBe(true);
    await expect(page.getByText("Switched to Forma Engineering. The previous record is not available here.", { exact: true })).toBeVisible();
  });

  test("a refused switch keeps the names, the workspace, the route and the page (§35, §81)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/projects" });
    await page.route("**/api/workspace", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500, body: "{}" }) : route.continue()));
    await markDocument(page);
    await (await openWorkspaceSwitcher(page)).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();

    await expect(page.getByText("That workspace could not be opened. You are still in Aurelia Construction.", { exact: true })).toBeVisible();
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await expect(workspaceHeader(page)).toHaveAccessibleName(/Current workspace: Aurelia Construction/);
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0);
    expect(await sameDocument(page)).toBe(true);
    type Me = { workspace?: { companyId?: string | null } };
    const body = (await (await page.request.get("/api/me")).json()) as Me & { data?: Me };
    expect((body.data ?? body).workspace?.companyId).toBe(AURELIA);
  });

  test("the names change only once the switch has committed; meanwhile the shell stays and the content waits (§33, §34, §83)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/tasks" });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/workspace", async (route) => {
      if (route.request().method() === "POST") await released;
      await route.continue();
    });
    await (await openWorkspaceSwitcher(page)).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();

    await expect(page.getByTestId("workspace-switching")).toBeVisible();
    await expect(page.getByTestId("workspace-switching")).toContainText("Switching to Forma Engineering");
    // Still the old identity, and the top bar in view; the panel closed as the switch began.
    await expect(page.getByTestId("modules-panel")).toHaveCount(0);
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await expect(workspaceHeader(page)).toHaveAccessibleName(/Current workspace: Aurelia Construction/);
    const topBar = page.locator("header[data-shell-region]");
    await expect(topBar).toBeVisible();
    // In view, and taking no input: one switch at a time (§34).
    await expect(topBar).toHaveJSProperty("inert", true);

    release();
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0, { timeout: 20_000 });
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Forma Engineering");
    await expect(workspaceHeader(page)).toHaveAccessibleName(/Current workspace: Forma Engineering/);
    await expect(topBar).toHaveJSProperty("inert", false);
  });

  test("unsaved changes are never lost silently: Stay keeps them, Discard and switch goes (§37, §82)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/tasks/new" });
    const title = mainRegion(page).getByLabel("Title");
    await title.fill("Half-written task");

    await (await openWorkspaceSwitcher(page)).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    // The one shared question (AUD-03 §7): the popup closes, the prompt asks.
    const question = page.getByTestId("unsaved-prompt");
    await expect(question).toContainText("You have unsaved changes");
    await expect(question).toContainText("You're switching to Forma Engineering.");
    await page.getByTestId("unsaved-stay").click();
    await expect(question).toHaveCount(0);
    await expect(title).toHaveValue("Half-written task");
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Aurelia Construction");

    await (await openWorkspaceSwitcher(page)).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    await page.getByTestId("unsaved-discard").click();
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0, { timeout: 20_000 });
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Forma Engineering");
    await expect(mainRegion(page).getByLabel("Title")).toHaveValue("");
  });

  test("another tab follows the switch (§62, §89)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    const other = await page.context().newPage();
    await other.goto("/tasks");
    await expect(workspaceHeader(other).getByTestId("workspace-label")).toHaveText("Aurelia Construction");

    await chooseWorkspace(page, "Forma Engineering");
    await expect(workspaceHeader(other).getByTestId("workspace-label")).toHaveText("Forma Engineering", { timeout: 20_000 });
    await expect(workspaceHeader(other)).toHaveAccessibleName(/Current workspace: Forma Engineering/);
    await other.close();
  });
});

test.describe("widths (§47-§49, §84, §85)", () => {
  test("a phone: the logo's panel's header is the switch — the workspace's name and a small chevron — and its popup hangs under it, a pointer on the header (§48, §85; MOB-02 §23)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    const header = await openWorkspaceSwitcher(page);
    await expect(header).toHaveRole("button");
    await expect(header).toHaveAccessibleName("Switch workspace. Current workspace: Aurelia Construction.");
    await expect(header).toHaveAttribute("aria-haspopup", "dialog");
    await expect(header).toHaveAttribute("data-presentation", "popup");
    // The mark and the workspace's own name, as the sidebar writes it — not the NESTO wordmark, and no organization line (§5, §6).
    await expect(header.getByTestId("organization-mark")).toBeVisible();
    await expect(header.getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await expect(header.getByTestId("organization-name")).toHaveCount(0);
    // Only a header that can switch looks like it can: one small chevron, after the name.
    const chevron = header.locator("svg");
    await expect(chevron).toHaveCount(1);
    await expect(chevron).toBeVisible();
    await expect(chevron).toHaveClass(/chevron-down/);
    const [name, sign] = [(await header.getByTestId("workspace-label").boundingBox())!, (await chevron.boundingBox())!];
    expect(sign.x).toBeGreaterThanOrEqual(name.x + name.width);
    expect(sign.width).toBeLessThanOrEqual(16);

    await header.click();
    const popup = workspacePanel(page);
    await expect(popup.getByTestId("workspace-option").first()).toBeVisible();
    await expect(popup).toHaveAccessibleName("Switch Workspace");
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await landed(popup);
    // A popup under the header, no longer a sheet on the screen's lower edge: the platform's glass, its pointer on the header.
    const pointer = popup.locator(".nesto-popup-pointer");
    await expect(pointer).toBeVisible();
    await expect(popup.locator(".nesto-popup-glass")).toHaveCSS("border-top-left-radius", "22px");
    const [control, box, tail] = [(await header.boundingBox())!, (await popup.boundingBox())!, (await pointer.boundingBox())!];
    const viewport = page.viewportSize()!;
    expect(box.y).toBeGreaterThanOrEqual(control.y + control.height);
    expect(box.y - (control.y + control.height)).toBeLessThanOrEqual(24);
    expect(box.y + box.height).toBeLessThan(viewport.height - 68);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    // The pointer fills the gap between the two, within the header's own width.
    expect(tail.y).toBeGreaterThanOrEqual(control.y + control.height - 1);
    expect(tail.y + tail.height).toBeLessThanOrEqual(box.y + 2);
    expect(tail.x + tail.width / 2).toBeGreaterThan(control.x);
    expect(tail.x + tail.width / 2).toBeLessThan(control.x + control.width);

    await popup.getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0, { timeout: 20_000 });
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Forma Engineering");
    await expect(await openWorkspaceSwitcher(page)).toHaveAccessibleName("Switch workspace. Current workspace: Forma Engineering.");
  });

  test("a phone with one workspace: the header is identity only — a group, no chevron, nothing to press (§46, §48)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await openWorkspaceSwitcher(page);
    const header = page.getByTestId("modules-panel").getByTestId("organization-header");
    await expect(header).toHaveRole("group");
    await expect(header).toHaveAccessibleName("Current workspace: Aurelia Construction");
    await expect(header).toHaveAttribute("data-options", "single");
    await expect(header.getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await expect(header.getByTestId("organization-name")).toHaveCount(0);
    await expectNoArrow(header);
    await header.click();
    await expect(workspacePanel(page)).toHaveCount(0);
  });

  test("a tablet: no navigation drawer; the phone's bar is the navigation, and Menu's head switches", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    await expect(page.getByTestId("phone-place-menu")).toBeVisible();
    await (await openWorkspaceSwitcher(page)).click();
    const popup = workspacePanel(page);
    await expect(popup.getByTestId("workspace-option").first()).toBeVisible();
    await popup.getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0, { timeout: 20_000 });
    // A switch from Menu stays on Menu, its head naming the new workspace.
    await expect(page).toHaveURL(/\/menu$/);
    await expect(workspaceHeader(page)).toHaveAccessibleName(/Current workspace: Forma Engineering/);
  });
});
