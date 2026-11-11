import { expect, test, type Page } from "@playwright/test";

import { mainRegion, signIn } from "../fixtures";
import { expectInViewport, expectNoPageOverflow, expectTouchTargets } from "./geometry";

/**
 * AUD-04 shell on phones and tablets (§4; MW-02, MW-03, MW-19).
 *
 * Runs in every AUD-04 matrix project (playwright.config.ts). Below the
 * shell's lg breakpoint (1024) there is no navigation drawer — the bottom
 * bar's Menu is the one menu — so these checks skip at 1024 and at desktop
 * widths; aud04-primitives.spec.ts holds the desktop regression checks (MW-21).
 *
 * Nothing here saves a record: the unsaved-work checks type into a new
 * client's form and leave by Stay or Discard, and the workspace switch is the
 * session's own, verified through /api/me.
 */

const AURELIA = "company_demo_a";
const FORMA = "company_demo_d";

function prompt(page: Page) {
  return page.getByTestId("unsaved-prompt");
}

/** Below lg the shell is not the desktop's: the bottom bar, its Menu the one menu (MOB-02). */
function belowLg(page: Page) {
  return page.viewportSize()!.width < 1024;
}

/** A phone (below md). */
function phone(page: Page) {
  return page.viewportSize()!.width < 768;
}

/** The workspace switch: the header of the logo's panel, which is opened first. */
async function workspaceSwitch(page: Page) {
  if (!(await page.getByTestId("modules-panel").isVisible())) await page.getByTestId("modules-panel-trigger").click();
  return page.getByTestId("modules-panel").getByTestId("organization-header");
}

/** Home, the workspace's name in the top bar. */
function workspaceHeader(page: Page) {
  return page.getByTestId("topbar-home");
}

/**
 * No leftover overlay: the page's centre answers to the page, not a backdrop (MW-02).
 * A sheet that has just closed is still fading out for a moment — the workspace
 * switch closes it as it starts, so Stay can arrive while it leaves — and left
 * over means still there once it has had that moment.
 */
async function expectNoOverlay(page: Page) {
  await expect(page.locator("[role=dialog][data-state=open]")).toHaveCount(0);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
          return Boolean(el && getComputedStyle(el).position === "fixed" && el.getAttribute("data-state") !== null);
        }),
      { message: "an overlay is left over the page", timeout: 3_000 },
    )
    .toBe(false);
}

async function currentCompany(page: Page) {
  const response = await page.request.get("/api/me");
  const body = (await response.json()) as { data?: { company?: { id: string } }; company?: { id: string } };
  return (body.data ?? body).company?.id;
}

test.describe("AUD-04 top bar below 1024px (MW-02)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!belowLg(page), "the phone and tablet top bar (below 1024px)");
  });

  test("no navigation drawer: the phone Ribbon is the one navigation; the top bar fits without collisions, with 44px controls", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    const header = page.locator("header[data-shell-region]");
    await expectNoPageOverflow(page, "dashboard");
    await expectTouchTargets(page, header);
    await expect(page.getByRole("button", { name: /open navigation/i })).toHaveCount(0);
    await expect(page.getByTestId("phone-tab-work")).toBeVisible();

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
  });
});

test.describe("AUD-04 workspace switch on phones and tablets (MW-03)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!phone(page), "a phone's switch; the logo's panel switches at every width (shell/organization-header.spec.ts)");
  });

  test("the header's workspace popup switches with AUD-03 Stay and Discard, and the full name stays accessible", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA, to: "/clients/new" });
    const name = mainRegion(page).getByLabel("Client name");
    await name.fill("AUD04A switch draft");
    await expect(page.getByTestId("unsaved-indicator").first()).toHaveText("Unsaved changes");

    const switches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/workspace") switches.push(request.url());
    });

    const choose = async () => {
      const header = await workspaceSwitch(page);
      // Truncated on screen, whole in the accessible name and the title (§4).
      await expect(header).toHaveAccessibleName(/Current workspace: Aurelia Construction/);
      await expect(header).toHaveAttribute("title", /Aurelia Construction/);
      await header.click();
      const panel = page.getByTestId("workspace-panel");
      await expect(panel).toBeVisible();
      // A popup under the header, its pointer on it, as every popup on a touch layout. It grows out of the
      // header (styles/globals.css, `nesto-pop-in`), so its targets are measured once it has landed.
      await expect(panel.locator(".nesto-popup-pointer")).toBeVisible();
      await panel.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)).then(() => undefined));
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
    const after = workspaceHeader(page);
    await expect(after).toHaveAccessibleName(/Current workspace: Forma Engineering/);
    await expectNoPageOverflow(page, "after the switch");
  });
});
