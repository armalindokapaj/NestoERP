import { expect, test, type Locator, type Page } from "@playwright/test";

import { chooseWorkspace, DEMO_PASSWORD, dropOrphanedStreamSegments, mainRegion, signIn, workspaceHeader, workspacePanel, workspaceSwitcher } from "../fixtures";

/**
 * The workspace header, the company switcher and their popup (Sidebar
 * Organization Workspace Header PRD, "OW", §72-§90, §107).
 *
 * The sidebar's header names the workspace being worked in — the company, or
 * the group in the Group workspace — and is the way to its dashboard; it
 * switches nothing. The switch is the top bar's company switcher, before
 * + Create and built like it: the organization over "Choose Company", opening
 * "Switch Workspace" below itself, on the breadcrumb bar's top line. On a
 * phone, and in the tablet's navigation drawer, the header is still the
 * switch, and its popup hangs under it with a pointer. A switch keeps the page
 * where it can, is made in place without a document load, and the names change
 * only once the new workspace has committed.
 */

const AURELIA = "company_demo_a";
const GROUP = "NESTO Demo Group";

/** No arrow, chevron, caret or dropdown sign, in any state (§4, §74, §92): the top bar's workspace header draws no icon at all. */
async function expectNoArrow(header: Locator) {
  await expect(header.locator("svg")).toHaveCount(0);
  await expect(header.locator('[class*="chevron"], [class*="caret"], [class*="arrow"]')).toHaveCount(0);
  const text = await header.innerText();
  expect(text).not.toMatch(/[⌄∨▾▼›>]/);
}

/** The switcher is built like + Create (§14): its one icon is the building, and nothing on it is an arrow, chevron or caret (§4, §74). */
async function expectNoArrowOnSwitcher(switcher: Locator) {
  await expect(switcher.locator("svg")).toHaveCount(1);
  await expect(switcher.locator('[class*="chevron"], [class*="caret"], [class*="arrow"]')).toHaveCount(0);
  const text = await switcher.innerText();
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
    // Nothing to switch: no switcher in the top bar, and nothing in the header to press (§46).
    await expect(workspaceSwitcher(page)).toHaveCount(0);
    await expect(page.getByTestId("topbar-home").getByRole("button")).toHaveCount(0);
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
    await expect(workspaceSwitcher(page)).toHaveCount(0);
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
    // The mark and one line — the company's own name. The organization is the switcher's to name (§5, §7).
    await expect(header.getByTestId("organization-mark")).toBeVisible();
    await expect(header.getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await expect(header.getByTestId("organization-name")).toHaveCount(0);
    await expect(header).not.toContainText(GROUP);

    const box = (await header.boundingBox())!;
    const parts: Array<() => Promise<void>> = [
      () => header.getByTestId("organization-mark").click(),
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

  test("in the Group workspace the header names the group, and the switcher still the organization (§7, §73)", async ({ page }) => {
    await signIn(page, "OWNER", { workspace: "GROUP", to: "/dashboard" });
    const header = workspaceHeader(page);
    await expect(header.getByTestId("workspace-label")).toHaveText(GROUP);
    await expect(header).toHaveAccessibleName(`Dashboard. Current workspace: ${GROUP} — Group Workspace.`);
    await expect(header).toHaveAttribute("data-scope", "GROUP");
    const switcher = workspaceSwitcher(page);
    await expect(switcher.getByTestId("organization-name")).toHaveText(GROUP);
    await expect(switcher).toHaveAccessibleName(`Switch workspace. Current workspace: ${GROUP} — Group Workspace.`);
    await expect(switcher).toHaveAttribute("data-scope", "GROUP");
  });
});

test.describe("the company switcher as a control (§14-§17, §74, §75, §90)", () => {
  test("it sits in the top bar before + Create and is built like it: the organization over \"Choose Company\" (§3, §5, §14)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/dashboard" });
    const switcher = workspaceSwitcher(page);
    const create = page.getByTestId("quick-create-button");
    await expect(page.locator("header[data-shell-region]").getByTestId("workspace-switcher")).toHaveCount(1);
    await expect(switcher).toHaveAccessibleName("Switch workspace. Current workspace: Aurelia Construction.");
    await expect(switcher).toHaveAttribute("data-scope", "COMPANY");
    // Line one is the organization; the company being worked in is the sidebar header's to name, not said twice.
    await expect(switcher.getByTestId("organization-name")).toHaveText(GROUP);
    await expect(switcher.getByText("Choose Company", { exact: true })).toBeVisible();
    await expect(switcher).not.toContainText("Aurelia Construction");

    // Immediately before + Create, on its line and of its height.
    const [first, second] = [(await switcher.boundingBox())!, (await create.boundingBox())!];
    expect(first.x + first.width).toBeLessThanOrEqual(second.x);
    expect(second.x - (first.x + first.width)).toBeLessThanOrEqual(12);
    expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(first.height - second.height)).toBeLessThanOrEqual(1);
    // The same accent button.
    const paint = (control: Locator) =>
      control.evaluate((element) => {
        const style = getComputedStyle(element);
        return { ground: style.backgroundColor, ink: style.color, radius: style.borderTopLeftRadius };
      });
    expect(await paint(switcher)).toEqual(await paint(create));
  });

  test("no arrow in any state: the header draws no icon, the switcher only its building — resting, hovered, focused, open (§4, §74)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/dashboard" });
    const header = workspaceHeader(page);
    await expectNoArrow(header);
    await header.hover();
    await expectNoArrow(header);
    await header.focus();
    await expectNoArrow(header);

    const switcher = workspaceSwitcher(page);
    await expectNoArrowOnSwitcher(switcher);
    await switcher.hover();
    await expectNoArrowOnSwitcher(switcher);
    await switcher.focus();
    await expectNoArrowOnSwitcher(switcher);
    await switcher.click();
    await expect(workspacePanel(page)).toBeVisible();
    await expect(switcher).toHaveAttribute("aria-expanded", "true");
    await expectNoArrowOnSwitcher(switcher);
  });

  test("every part of it opens the same popup: the icon, both lines and the padding (§14, §75)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/dashboard" });
    const switcher = workspaceSwitcher(page);
    const box = (await switcher.boundingBox())!;
    const targets = [
      switcher.locator("svg"),
      switcher.getByTestId("organization-name"),
      switcher.getByText("Choose Company", { exact: true }),
    ];
    for (const target of targets) {
      await target.click();
      await expect(workspacePanel(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(workspacePanel(page)).toHaveCount(0);
    }
    // The padding: the far right edge and the bottom edge, inside the button.
    for (const [x, y] of [[box.width - 3, box.height / 2], [box.width / 2, box.height - 2]] as const) {
      await switcher.click({ position: { x, y } });
      await expect(workspacePanel(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(workspacePanel(page)).toHaveCount(0);
    }
  });

  test("the popup: its name, the Group first, then only this person's companies, alphabetically, the current one selected (§20-§27, §76)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    await workspaceSwitcher(page).click();
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

  test("the popup opens below the switcher, their left edges aligned, its top edge on the breadcrumb bar's top line (§21; lib/layout/topbar-line.ts)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    const switcher = workspaceSwitcher(page);
    await switcher.click();
    const panel = workspacePanel(page);
    await expect(panel.getByTestId("workspace-option").first()).toBeVisible();
    // The line every panel opened from the top bar starts on: the top bar is 64px from 768px up.
    const line = (await page.locator("[data-shell-breadcrumb]").boundingBox())!.y;
    expect(line).toBe(64);
    // Placed a frame after it mounts, so the place is asked for until it holds.
    await expect(async () => {
      const [control, popup] = [(await switcher.boundingBox())!, (await panel.boundingBox())!];
      expect(popup.y).toBeGreaterThanOrEqual(control.y + control.height);
      expect(Math.abs(popup.y - line)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(popup.x - control.x)).toBeLessThanOrEqual(0.5);
    }).toPass({ timeout: 5_000 });
    // With a mouse it is the plain panel: the pointer is a touch layout's.
    await expect(panel.locator(".nesto-popup-pointer")).toBeHidden();
  });

  test("keyboard: Enter and Space open it, the current workspace is active, arrows move, Escape closes back to the switcher (§52-§56, §90)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    const switcher = workspaceSwitcher(page);
    await expect(switcher).toHaveAttribute("aria-haspopup", "dialog");
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

    await page.keyboard.press(" ");
    await expect(workspacePanel(page)).toBeVisible();
    // A click outside closes it too (§56): the far corner of the page, clear of the popup.
    const viewport = page.viewportSize()!;
    await page.mouse.click(viewport.width - 20, viewport.height - 20);
    await expect(workspacePanel(page)).toHaveCount(0);
  });

  test("it opens at once with the chooser already streamed (§58)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/dashboard" });
    const switcher = workspaceSwitcher(page);
    await expect(switcher).toHaveAttribute("data-options", "ready");
    // Warm the popup's code as a pointer resting on the switcher does, then time the click in the page.
    await switcher.hover();
    await switcher.click();
    await expect(workspacePanel(page).getByTestId("workspace-option").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(workspacePanel(page)).toHaveCount(0);
    const elapsed = await switcher.evaluate(
      (element) =>
        new Promise<number>((resolve) => {
          const started = performance.now();
          const observer = new MutationObserver(() => {
            if (document.querySelector('[data-testid="workspace-panel"]')) {
              observer.disconnect();
              resolve(performance.now() - started);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          (element as HTMLElement).click();
        }),
    );
    expect(elapsed).toBeLessThan(100);
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
    // The switcher still names the organization: only the workspace changed (§5).
    await expect(workspaceSwitcher(page).getByTestId("organization-name")).toHaveText(GROUP);
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
    await workspaceSwitcher(page).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();

    await expect(page.getByText("That workspace could not be opened. You are still in Aurelia Construction.", { exact: true })).toBeVisible();
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await expect(workspaceSwitcher(page)).toHaveAccessibleName(/Current workspace: Aurelia Construction/);
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0);
    expect(await sameDocument(page)).toBe(true);
    type Me = { workspace?: { companyId?: string | null } };
    const body = (await (await page.request.get("/api/me")).json()) as Me & { data?: Me };
    expect((body.data ?? body).workspace?.companyId).toBe(AURELIA);
  });

  test("the names change only once the switch has committed; meanwhile the shell stays, the switcher is busy and the content waits (§33, §34, §83)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/tasks" });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/workspace", async (route) => {
      if (route.request().method() === "POST") await released;
      await route.continue();
    });
    const switcher = workspaceSwitcher(page);
    await switcher.click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();

    await expect(page.getByTestId("workspace-switching")).toBeVisible();
    await expect(page.getByTestId("workspace-switching")).toContainText("Switching to Forma Engineering");
    // Still the old identity, the sidebar and the top bar in view.
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await expect(switcher).toHaveAccessibleName(/Current workspace: Aurelia Construction/);
    await expect(switcher).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("navigation", { name: "Main navigation" }).first()).toBeVisible();
    const topBar = page.locator("header[data-shell-region]");
    await expect(topBar).toBeVisible();
    // In view, and taking no input: one switch at a time, so the switcher cannot be pressed again (§34).
    await expect(topBar).toHaveJSProperty("inert", true);
    await expect(switcher).toHaveAttribute("aria-expanded", "false");

    release();
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0, { timeout: 20_000 });
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Forma Engineering");
    await expect(switcher).toHaveAccessibleName(/Current workspace: Forma Engineering/);
    await expect(switcher).not.toHaveAttribute("aria-busy");
    await expect(topBar).toHaveJSProperty("inert", false);
  });

  test("unsaved changes are never lost silently: Stay keeps them, Discard and switch goes (§37, §82)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/tasks/new" });
    const title = mainRegion(page).getByLabel("Title");
    await title.fill("Half-written task");

    await workspaceSwitcher(page).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    // The one shared question (AUD-03 §7): the popup closes, the prompt asks.
    const question = page.getByTestId("unsaved-prompt");
    await expect(question).toContainText("You have unsaved changes");
    await expect(question).toContainText("You're switching to Forma Engineering.");
    await page.getByTestId("unsaved-stay").click();
    await expect(question).toHaveCount(0);
    await expect(title).toHaveValue("Half-written task");
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Aurelia Construction");

    await workspaceSwitcher(page).click();
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
    await expect(workspaceSwitcher(other)).toHaveAccessibleName(/Current workspace: Forma Engineering/);
    await other.close();
  });
});

test.describe("widths (§47-§49, §84, §85)", () => {
  test("a phone: the top bar's header is the switch — the workspace's name and a small chevron — and its popup hangs under it, a pointer on the header (§48, §85; MOB-02 §23)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    // A phone's top bar has no room for a second control beside the header: the switcher is drawn from 768px.
    await expect(workspaceSwitcher(page)).toBeHidden();
    const header = page.getByTestId("mobile-context").getByTestId("organization-header");
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
    await expect(page.getByTestId("mobile-context").getByTestId("workspace-label")).toHaveText("Forma Engineering");
    await expect(header).toHaveAccessibleName("Switch workspace. Current workspace: Forma Engineering.");
  });

  test("a phone with one workspace: the header is identity only — a group, no chevron, nothing to press (§46, §48)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const header = page.getByTestId("mobile-context").getByTestId("organization-header");
    await expect(header).toHaveRole("group");
    await expect(header).toHaveAccessibleName("Current workspace: Aurelia Construction");
    await expect(header).toHaveAttribute("data-options", "single");
    await expect(header.getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await expect(header.getByTestId("organization-name")).toHaveCount(0);
    await expectNoArrow(header);
    await expect(page.getByTestId("mobile-context").getByRole("button")).toHaveCount(0);
    await header.click();
    await expect(workspacePanel(page)).toHaveCount(0);
    await expect(workspaceSwitcher(page)).toHaveCount(0);
  });

  test("a tablet: no navigation drawer; the top bar's company switcher switches, and the phone Ribbon is the navigation", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    // From 768px the top bar carries the switcher, beside + Create; below 1024px there is no drawer trigger.
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    await expect(page.getByTestId("phone-tab-work")).toBeVisible();
    await expect(workspaceSwitcher(page)).toBeVisible();
    await workspaceSwitcher(page).click();
    const popup = workspacePanel(page);
    await expect(popup.getByTestId("workspace-option").first()).toBeVisible();
    await popup.getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0, { timeout: 20_000 });
    await expect(workspaceSwitcher(page)).toHaveAccessibleName("Switch workspace. Current workspace: Forma Engineering.");
  });
});
