import { expect, test, type Locator, type Page } from "@playwright/test";

import { mainRegion, sidebar, signIn } from "../fixtures";
import { expectInViewport, expectNoPageOverflow, expectTouchTargets } from "./geometry";

/**
 * AUD-04 shell on phones and tablets (§4; MW-02, MW-03, MW-19).
 *
 * Runs in every AUD-04 matrix project (playwright.config.ts). The drawer
 * exists below the shell's lg breakpoint (1024), so the drawer tests skip at
 * 1024 and at desktop widths; aud04-primitives.spec.ts holds the desktop
 * regression checks (MW-21).
 *
 * Nothing here saves a record: the unsaved-work checks type into a new
 * client's form and leave by Stay or Discard, and the workspace switch is the
 * session's own, verified through /api/me.
 */

const AURELIA = "company_demo_a";
const FORMA = "company_demo_d";

function drawer(page: Page) {
  return page.getByRole("dialog", { name: /navigation/i });
}

function hamburger(page: Page) {
  return page.getByRole("button", { name: /open navigation/i });
}

function prompt(page: Page) {
  return page.getByTestId("unsaved-prompt");
}

function drawerLayout(page: Page) {
  return page.viewportSize()!.width < 1024;
}

async function openDrawer(page: Page) {
  await hamburger(page).click();
  await expect(drawer(page)).toBeVisible();
  return drawer(page);
}

/** No leftover overlay: the page's centre answers to the page, not a backdrop (MW-02). */
async function expectNoOverlay(page: Page) {
  await expect(page.locator("[role=dialog][data-state=open]")).toHaveCount(0);
  const hit = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return el ? { fixedBackdrop: getComputedStyle(el).position === "fixed" && el.getAttribute("data-state") !== null } : null;
  });
  expect(hit?.fixedBackdrop ?? false, "an overlay is left over the page").toBe(false);
}

async function hrefs(scope: Locator) {
  return (await scope.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")))).filter(Boolean).sort();
}

async function currentCompany(page: Page) {
  const response = await page.request.get("/api/me");
  const body = (await response.json()) as { data?: { company?: { id: string } }; company?: { id: string } };
  return (body.data ?? body).company?.id;
}

test.describe("AUD-04 navigation drawer (MW-02)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!drawerLayout(page), "the drawer exists below 1024px only");
  });

  test("opens and closes with 44px controls; the top bar fits without collisions", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const header = page.locator("header[data-shell-region]");
    await expectNoPageOverflow(page, "dashboard");
    await expectTouchTargets(page, header);

    // No two top-bar controls overlap, and every one is on screen (320px included).
    const boxes = await header.locator("button:visible, a[href]:visible").evaluateAll((elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "", left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    const width = page.viewportSize()!.width;
    for (const box of boxes) {
      expect(box.left, box.name).toBeGreaterThanOrEqual(-0.5);
      expect(box.right, box.name).toBeLessThanOrEqual(width + 0.5);
    }
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const [x, y] = [boxes[a]!, boxes[b]!];
        const overlap = Math.min(x.right, y.right) - Math.max(x.left, y.left) > 0.5 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 0.5;
        expect(overlap, `${x.name} overlaps ${y.name}`).toBe(false);
      }
    }

    const nav = await openDrawer(page);
    await expectTouchTargets(page, nav);
    await page.getByRole("button", { name: /close navigation/i }).click();
    await expect(drawer(page)).toBeHidden();
    // Closed by its own control, focus goes back to the hamburger.
    await expect(hamburger(page)).toBeFocused();
    await expectNoOverlay(page);

    await openDrawer(page);
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expectNoOverlay(page);
  });

  test("offers exactly the sidebar's destinations, scrolls on its own and opens with the active module in view", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    // One permission-filtered configuration: the drawer lists what the (hidden) sidebar lists.
    const nav = await openDrawer(page);
    const drawerLinks = await hrefs(nav.getByTestId("drawer-navigation"));
    expect(drawerLinks.length).toBeGreaterThan(3);
    expect(drawerLinks).toEqual(await hrefs(sidebar(page)));

    // Go to the last destination: the drawer must reopen with it in view.
    const last = drawerLinks[drawerLinks.length - 1]!;
    await page.keyboard.press("Escape");
    await page.goto(last);
    const reopened = await openDrawer(page);
    const list = reopened.getByTestId("drawer-navigation");
    const active = list.locator('[aria-current="page"]');
    await expect(active).toHaveCount(1);
    await expect
      .poll(async () => {
        const [a, l] = await Promise.all([active.boundingBox(), list.boundingBox()]);
        return Boolean(a && l && a.y >= l.y - 1 && a.y + a.height <= l.y + l.height + 1);
      })
      .toBe(true);

    // The list scrolls inside the drawer; the page behind does not move.
    const pageY = await page.evaluate(() => window.scrollY);
    const scrolled = await list.evaluate((el) => {
      const before = el.scrollTop;
      el.scrollTop = before === 0 ? el.scrollHeight : 0;
      return { overflowY: getComputedStyle(el).overflowY, moved: el.scrollHeight <= el.clientHeight || el.scrollTop !== before };
    });
    expect(scrolled.overflowY).toBe("auto");
    expect(scrolled.moved).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
  });

  test("a navigation closes the drawer, shows the destination and puts focus on the page; a same-route tap leaves no overlay", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const nav = await openDrawer(page);
    await nav.getByRole("link", { name: "Projects", exact: true }).click();
    await expect(page).toHaveURL(/\/projects(\?|$)/);
    await expect(drawer(page)).toBeHidden();
    await expect(mainRegion(page)).toBeFocused();
    await expectNoOverlay(page);

    // The active item again: nothing to load, and still no overlay left behind.
    const again = await openDrawer(page);
    await again.getByRole("link", { name: "Projects", exact: true }).click();
    await expect(drawer(page)).toBeHidden();
    await expectNoOverlay(page);
    await expectNoPageOverflow(page, "projects");
  });

  test("unsaved work holds a drawer navigation: Stay keeps the editor, its text and a usable page (AUD-03)", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/clients/new" });
    const name = mainRegion(page).getByLabel("Client name");
    await name.fill("AUD04A drawer draft");
    await expect(page.getByTestId("unsaved-indicator").first()).toHaveText("Unsaved changes");

    const nav = await openDrawer(page);
    await nav.getByRole("link", { name: "Projects", exact: true }).click();
    await expect(prompt(page)).toBeVisible();
    await expect(prompt(page).getByTestId("unsaved-stay")).toBeFocused();
    await prompt(page).getByTestId("unsaved-stay").click();

    await expect(page).toHaveURL(/\/clients\/new/);
    await expect(name).toHaveValue("AUD04A drawer draft");
    await expect(drawer(page)).toBeHidden();
    await expectNoOverlay(page);
    // The editor is still usable, not behind an invisible layer.
    await name.click();
    await expect(name).toBeFocused();
  });
});

test.describe("AUD-04 workspace switch on phones and tablets (MW-03)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!drawerLayout(page), "the drawer's workspace sheet exists below 1024px only");
  });

  test("the drawer's workspace sheet switches with AUD-03 Stay and Discard, and the full name stays accessible", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/clients/new" });
    const name = mainRegion(page).getByLabel("Client name");
    await name.fill("AUD04A switch draft");
    await expect(page.getByTestId("unsaved-indicator").first()).toHaveText("Unsaved changes");

    const switches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/workspace") switches.push(request.url());
    });

    const choose = async () => {
      const nav = await openDrawer(page);
      const header = nav.getByTestId("organization-header");
      // Truncated on screen, whole in the accessible name and the title (§4).
      await expect(header).toHaveAccessibleName(/Current workspace: Aurelia Construction/);
      await expect(header).toHaveAttribute("title", /Aurelia Construction/);
      await header.click();
      const panel = page.getByTestId("workspace-panel");
      await expect(panel).toBeVisible();
      await expectTouchTargets(page, panel);
      await expectInViewport(panel.getByTestId("workspace-option").last(), "last workspace option");
      await panel.getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
      await expect(prompt(page)).toContainText("Forma Engineering");
    };

    await choose();
    await prompt(page).getByTestId("unsaved-stay").click();
    await expect(page).toHaveURL(/\/clients\/new/);
    await expect(name).toHaveValue("AUD04A switch draft");
    await expectNoOverlay(page);
    expect(switches).toHaveLength(0);
    expect(await currentCompany(page)).toBe(AURELIA);

    await choose();
    await prompt(page).getByTestId("unsaved-discard").click();
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(() => currentCompany(page), { timeout: 20_000 }).toBe(FORMA);
    expect(switches).toHaveLength(1);
    // The draft does not follow into the new workspace, and a page is shown (route kept or a safe fallback).
    await expect(page.getByText("AUD04A switch draft")).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/login/);
    const nav = await openDrawer(page);
    await expect(nav.getByTestId("organization-header")).toHaveAccessibleName(/Current workspace: Forma Engineering/);
    await expectNoPageOverflow(page, "after the switch");
  });
});
