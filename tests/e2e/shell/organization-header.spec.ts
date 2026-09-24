import { expect, test, type Locator, type Page } from "@playwright/test";

import { chooseWorkspace, DEMO_PASSWORD, dropOrphanedStreamSegments, mainRegion, signIn, workspaceHeader, workspacePanel } from "../fixtures";

/**
 * The organization workspace header and its popup (Sidebar Organization
 * Workspace Header PRD, "OW", §72-§90, §107).
 *
 * The header leads the sidebar with the customer organization and the
 * workspace; pressing any part of it opens "Switch Workspace". A switch keeps
 * the page where it can, is made in place without a document load, and the
 * header changes only once the new workspace has committed.
 */

const ARLIS = "armaar_co_arlis_ndertim";
const AURELIA = "company_demo_a";

/** No arrow, chevron, caret or dropdown sign, in any state (§4, §74, §92): the header draws no icon at all. */
async function expectNoArrow(header: Locator) {
  await expect(header.locator("svg")).toHaveCount(0);
  await expect(header.locator('[class*="chevron"], [class*="caret"], [class*="arrow"]')).toHaveCount(0);
  const text = await header.innerText();
  expect(text).not.toMatch(/[⌄∨▾▼›>]/);
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
  test("a company workspace: the group above the company, at the top of the sidebar; the top bar carries neither (§72, §19)", async ({ page }) => {
    await signIn(page, "ARMAAR_LEGAL", { company: ARLIS, to: "/dashboard" });
    const header = workspaceHeader(page);
    await expect(header.getByTestId("organization-name")).toHaveText("ARMAAR GROUP");
    await expect(header.getByTestId("workspace-label")).toHaveText("ARLIS - NDERTIM");
    await expect(header.getByTestId("organization-mark")).toHaveText("AG");
    await expect(header).toHaveAccessibleName("Switch workspace. Current workspace: ARLIS - NDERTIM.");

    // The top bar: search, + Create, Activity, profile — no workspace, no demo chip (§19, §100).
    const bar = page.locator("header[data-shell-region]");
    await expect(bar.getByTestId("organization-header")).toHaveCount(0);
    await expect(bar.getByText("Demo data")).toHaveCount(0);
    await expect(bar.getByText("ARLIS - NDERTIM")).toHaveCount(0);
    // NESTO signs the foot, quietly; the demo notice sits beside it (§71, D-01 §68).
    await expect(page.getByTestId("powered-by")).toContainText("Powered by NESTO");
    await expect(page.getByTestId("demo-notice")).toBeVisible();
    await expect(page.getByTestId("sidebar-header")).not.toContainText("NESTO");
  });

  test("the Group workspace names the group once, then the scope (§73)", async ({ page }) => {
    await signIn(page, "ARMAAR_LEGAL", { to: "/dashboard" });
    await page.request.post("/api/workspace", { data: { scopeType: "GROUP" } });
    await page.goto("/dashboard");
    const header = workspaceHeader(page);
    await expect(header.getByTestId("organization-name")).toHaveText("ARMAAR GROUP");
    await expect(header.getByTestId("workspace-label")).toHaveText("Group Workspace");
    await expect(header).toHaveAttribute("data-scope", "GROUP");
  });

  test("a standalone company is the organization: no group, no second line, nothing to switch (§8, §45, §86, §87)", async ({ page }) => {
    await signInAs(page, "solo-owner");
    await page.goto("/dashboard");
    const header = workspaceHeader(page);
    await expect(header.getByTestId("organization-name")).toHaveText("Solo Studio");
    await expect(header.getByTestId("workspace-label")).toHaveCount(0);
    await expect(header).toHaveAttribute("data-options", "single");
    await expect(page.getByTestId("sidebar-header")).not.toContainText("Solo Studio Holding");
    await expect(page.getByTestId("sidebar-header").getByRole("button")).toHaveCount(0);
    expect((await page.request.post("/api/workspace", { data: { scopeType: "GROUP" } })).status()).toBe(403);
    await expectNoArrow(header);
  });

  test("one workspace: identity only, never a dropdown (§46, §87)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const header = workspaceHeader(page);
    await expect(header.getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await header.click();
    await expect(workspacePanel(page)).toHaveCount(0);
    await expectNoArrow(header);
  });
});

test.describe("the header as a control (§14-§17, §74, §75, §90)", () => {
  test("no arrow in any state: resting, hovered, focused, open (§74)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/dashboard" });
    const header = workspaceHeader(page);
    await expectNoArrow(header);
    await header.hover();
    await expectNoArrow(header);
    await header.focus();
    await expectNoArrow(header);
    await header.click();
    await expect(workspacePanel(page)).toBeVisible();
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expectNoArrow(header);
  });

  test("every part of it opens the same popup: the mark, both names and the padding (§14, §75)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/dashboard" });
    const header = workspaceHeader(page);
    const box = (await header.boundingBox())!;
    const targets = [
      header.getByTestId("organization-mark"),
      header.getByTestId("organization-name"),
      header.getByTestId("workspace-label"),
    ];
    for (const target of targets) {
      await target.click();
      await expect(workspacePanel(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(workspacePanel(page)).toHaveCount(0);
    }
    // The padding: the far right edge and the bottom edge, inside the header.
    for (const [x, y] of [[box.width - 3, box.height / 2], [box.width / 2, box.height - 2]] as const) {
      await header.click({ position: { x, y } });
      await expect(workspacePanel(page)).toBeVisible();
      await page.keyboard.press("Escape");
    }
  });

  test("the popup: its name, the Group first, then only this person's companies, alphabetically, the current one selected (§20-§27, §76)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    await workspaceHeader(page).click();
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

  test("a long list has a search, which narrows the companies and never the Group (§25)", async ({ page }) => {
    await signIn(page, "ARMAAR_LEGAL", { company: ARLIS, to: "/dashboard" });
    await workspaceHeader(page).click();
    const panel = workspacePanel(page);
    // Suspended companies are not offered (§68).
    await expect(panel).not.toContainText("SKYLINE TOWERS");
    await panel.getByTestId("workspace-search").fill("ndert");
    await expect(panel.getByTestId("workspace-option").filter({ hasText: "ARLIS - NDERTIM" })).toBeVisible();
    await expect(panel.getByTestId("workspace-option").filter({ hasText: "IDEAL" })).toHaveCount(0);
    await expect(panel.getByTestId("workspace-option").first()).toHaveAttribute("data-scope", "GROUP");
    await panel.getByTestId("workspace-search").fill("zzz");
    await expect(panel.getByText("No company matches your search.")).toBeVisible();
  });

  test("keyboard: Enter and Space open it, the current workspace is active, arrows move, Escape closes back to the header (§52-§56, §90)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    const header = workspaceHeader(page);
    await expect(header).toHaveAttribute("aria-haspopup", "dialog");
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await header.focus();
    await page.keyboard.press("Enter");
    const list = workspacePanel(page).getByRole("listbox");
    await expect(list).toBeFocused();
    const activeId = async () => list.getAttribute("aria-activedescendant");
    await expect(page.locator(`[id="${await activeId()}"]`)).toContainText("Aurelia Construction");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(`[id="${await activeId()}"]`)).toContainText("Forma Engineering");
    await page.keyboard.press("Escape");
    await expect(workspacePanel(page)).toHaveCount(0);
    await expect(header).toBeFocused();

    await page.keyboard.press(" ");
    await expect(workspacePanel(page)).toBeVisible();
    // A click outside closes it too (§56): the far corner of the page, clear of the popup.
    const viewport = page.viewportSize()!;
    await page.mouse.click(viewport.width - 20, viewport.height - 20);
    await expect(workspacePanel(page)).toHaveCount(0);
  });

  test("it opens at once with the chooser already streamed (§58)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/dashboard" });
    const header = workspaceHeader(page);
    await expect(header).toHaveAttribute("data-options", "ready");
    // Warm the popup's code as a pointer resting on the header does, then time the click in the page.
    await header.hover();
    await header.click();
    await expect(workspacePanel(page).getByTestId("workspace-option").first()).toBeVisible();
    await page.keyboard.press("Escape");
    const elapsed = await header.evaluate(
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
  test("a valid route is kept, in place: no document load, new header, the new company's list (§28, §30, §34, §78)", async ({ page }) => {
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

  test("a refused switch keeps the header, the workspace, the route and the page (§35, §81)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/projects" });
    await page.route("**/api/workspace", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500, body: "{}" }) : route.continue()));
    await markDocument(page);
    await workspaceHeader(page).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();

    await expect(page.getByText("That workspace could not be opened. You are still in Aurelia Construction.", { exact: true })).toBeVisible();
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0);
    expect(await sameDocument(page)).toBe(true);
    type Me = { workspace?: { companyId?: string | null } };
    const body = (await (await page.request.get("/api/me")).json()) as Me & { data?: Me };
    expect((body.data ?? body).workspace?.companyId).toBe(AURELIA);
  });

  test("the header changes only once the switch has committed; meanwhile the shell stays and the content waits (§33, §34, §83)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/tasks" });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/workspace", async (route) => {
      if (route.request().method() === "POST") await released;
      await route.continue();
    });
    await workspaceHeader(page).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();

    await expect(page.getByTestId("workspace-switching")).toBeVisible();
    await expect(page.getByTestId("workspace-switching")).toContainText("Switching to Forma Engineering");
    // Still the old identity, the sidebar and the top bar in view.
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Aurelia Construction");
    await expect(workspaceHeader(page)).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("navigation", { name: "Main navigation" }).first()).toBeVisible();
    await expect(page.locator("header[data-shell-region]")).toBeVisible();

    release();
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0, { timeout: 20_000 });
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Forma Engineering");
  });

  test("unsaved changes are never lost silently: Stay keeps them, Discard and switch goes (§37, §82)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/tasks/new" });
    const title = mainRegion(page).getByLabel("Title");
    await title.fill("Half-written task");

    await workspaceHeader(page).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    const question = page.getByTestId("workspace-unsaved");
    await expect(question).toContainText("You have unsaved changes.");
    await page.getByTestId("workspace-unsaved-stay").click();
    await expect(question).toHaveCount(0);
    await expect(title).toHaveValue("Half-written task");
    await expect(workspaceHeader(page).getByTestId("workspace-label")).toHaveText("Aurelia Construction");

    await workspaceHeader(page).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    await page.getByTestId("workspace-unsaved-discard").click();
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
    await other.close();
  });
});

test.describe("widths (§47-§49, §84, §85)", () => {
  test("collapsed: the mark alone, both names on hover, and it still opens the popup (§47, §84)", async ({ page }) => {
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    const header = workspaceHeader(page);
    await expect(header.getByTestId("organization-name")).toBeHidden();
    await expect(header.getByTestId("organization-mark")).toBeVisible();
    await expectNoArrow(header);
    await header.hover();
    const tip = page.getByTestId("organization-tooltip").first();
    await expect(tip).toContainText("NESTO Demo Group");
    await expect(tip).toContainText("Aurelia Construction");
    await header.click();
    await expect(workspacePanel(page).getByTestId("workspace-option").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Expand sidebar" }).click();
  });

  test("a phone: the header leads the drawer and opens a sheet; no arrow (§48, §85)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
    // The top bar shows the organization's mark, not the NESTO wordmark (§5, §6).
    await expect(page.getByTestId("organization-home")).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();
    const header = page.getByTestId("drawer-header").getByTestId("organization-header");
    await expect(header.getByTestId("organization-name")).toHaveText("NESTO Demo Group");
    await expectNoArrow(header);
    await header.click();
    const sheet = workspacePanel(page);
    await expect(sheet.getByTestId("workspace-option").first()).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(840);
    await sheet.getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0, { timeout: 20_000 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByTestId("drawer-header").getByTestId("workspace-label")).toHaveText("Forma Engineering");
  });
});
