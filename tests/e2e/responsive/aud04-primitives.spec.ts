import { expect, test, type Page } from "@playwright/test";

import { db, removeTestTasks } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { emulateTextZoom, expectInViewport, expectInputsAtLeast16px, expectNoPageOverflow, expectTouchTargets } from "./geometry";

/**
 * AUD-04 shared primitives across the size matrix (§3, §6, §8; MW-01, MW-10,
 * MW-19, MW-21).
 *
 * - The overflow and touch-target sweep of representative pages: a dashboard,
 *   operational lists, a record detail and two forms (MW-01, MW-19).
 * - 16px phone inputs, 320px reflow and 200% text (MW-19).
 * - A dialog in a phone on its side, 844×390: bounded, one scroll region,
 *   44px close, and the AUD-03 warning never closes the dialog under it (MW-10).
 * - Floating layers stack above dialogs and sheets (MW-10).
 * - Desktop regression at 1280 and 1440 with a mouse: density unchanged (MW-21).
 *
 * The one owned record is a task named AUD04A…, removed afterwards.
 */

const PREFIX = "AUD04A";
const AURELIA = "company_demo_a";
const PM = "member_pm";

test.afterAll(async () => {
  await removeTestTasks(PREFIX);
  await db.$disconnect();
});

function width(page: Page) {
  return page.viewportSize()!.width;
}

/** Where `touch:` applies: below lg, or a coarse pointer (every matrix phone and tablet emulates touch). */
async function isTouch(page: Page) {
  return page.evaluate(() => matchMedia("(max-width: 1023.98px), (pointer: coarse)").matches);
}

const SWEEP: Array<{ path: string; role: "PROJECT_MANAGER" | "OWNER" }> = [
  { path: "/dashboard", role: "PROJECT_MANAGER" },
  { path: "/projects", role: "PROJECT_MANAGER" },
  { path: "/projects/project_a", role: "PROJECT_MANAGER" },
  { path: "/tasks", role: "PROJECT_MANAGER" },
  { path: "/tasks/new", role: "PROJECT_MANAGER" },
  { path: "/finance/expenses", role: "OWNER" },
  { path: "/clients/new", role: "OWNER" },
];

test.describe("AUD-04 primitives sweep (MW-01, MW-19)", () => {
  for (const { path, role } of SWEEP) {
    test(`${path}: no sideways page scroll; every control a 44px target under touch`, async ({ page }) => {
      await signIn(page, role, { to: path });
      await expect(mainRegion(page).locator("h1").first()).toBeVisible();
      await expectNoPageOverflow(page, path);
      if (await isTouch(page)) {
        await expectTouchTargets(page, page.locator("header[data-shell-region]"));
        await expectTouchTargets(page, mainRegion(page));
      }
      if (width(page) < 768) await expectInputsAtLeast16px(page, mainRegion(page));
    });
  }

  test("320px reflow and 200% text: the form stays in the page and Save stays reachable (MW-19)", async ({ page }) => {
    test.skip(width(page) > 414, "a phone-width check");
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
    await expect(mainRegion(page).getByLabel("Title")).toBeVisible();
    await emulateTextZoom(page, 2);
    await expectNoPageOverflow(page, "200% text");
    const save = mainRegion(page).getByRole("button", { name: /create|save/i }).first();
    await expectInViewport(save, "primary action at 200%");
    await expectInViewport(mainRegion(page).getByLabel("Title"), "first field at 200%");
  });

  test("record header actions wrap inside the page on a phone (SP-13, D-02-02, D-03-03)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    // Every visible control of the page header is on screen, none cut off to the right.
    const offscreen = await mainRegion(page)
      .locator("button:visible, a[href]:visible")
      .evaluateAll((elements) => elements.filter((el) => !el.closest("[role=region], [style*=overflow]") && el.getBoundingClientRect().right > window.innerWidth + 1).map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim()));
    expect(offscreen).toEqual([]);
  });
});

test.describe("AUD-04 dialogs and floating layers (MW-10)", () => {
  async function seedTask() {
    return db.task.create({
      data: { companyId: AURELIA, title: `${PREFIX} dialog ${Date.now()}`, status: "TODO", priority: "MEDIUM", createdByMemberId: PM, createdBy: "e2e" },
      select: { id: true },
    });
  }

  async function openBlockDialog(page: Page) {
    const main = mainRegion(page);
    const direct = main.getByRole("button", { name: /mark blocked/i });
    if (await direct.isVisible().catch(() => false)) await direct.click();
    else {
      await main.getByRole("button", { name: /more/i }).first().click();
      await page.getByRole("menuitem", { name: /mark blocked/i }).click();
    }
    const dialog = page.getByRole("dialog").filter({ hasText: /blocked/i });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test("a dialog fits a phone on its side: bounded, scrolls inside itself, 44px close, Stay keeps it and its text", async ({ page }) => {
    const task = await seedTask();
    await signIn(page, "PROJECT_MANAGER", { to: `/tasks/${task.id}` });
    const dialog = await openBlockDialog(page);
    const viewport = page.viewportSize()!;

    // Bounded by the viewport, whatever its height (844×390 included).
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);

    // One scroll region: the dialog scrolls, the page behind does not.
    const pageY = await page.evaluate(() => window.scrollY);
    const overflowY = await dialog.evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflowY).toBe("auto");
    const confirm = dialog.getByRole("button", { name: /mark blocked/i });
    await expectInViewport(confirm, "the dialog's primary action");
    expect(await page.evaluate(() => window.scrollY)).toBe(pageY);

    if (await isTouch(page)) await expectTouchTargets(page, dialog);

    // AUD-03: dismissing with typed text asks; Stay keeps the dialog and the text (no double dismissal).
    const reason = dialog.getByRole("textbox").first();
    await reason.fill(`${PREFIX} waiting for drawings`);
    await page.keyboard.press("Escape");
    const prompt = page.getByTestId("unsaved-prompt");
    await expect(prompt).toBeVisible();
    await prompt.getByTestId("unsaved-stay").click();
    await expect(dialog).toBeVisible();
    await expect(reason).toHaveValue(`${PREFIX} waiting for drawings`);

    // Nothing was saved by any of this.
    const stored = await db.task.findUnique({ where: { id: task.id }, select: { status: true } });
    expect(stored?.status).toBe("TODO");
  });

  test("menus open above dialogs and sheets (the z-index ladder)", async ({ page }) => {
    // A phone's account lives in More (MOB-02 §39); the menu is the tablet and desktop top bar's.
    test.skip((page.viewportSize()?.width ?? 0) < 768, "the account menu is in More below 768px");
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await page.getByTestId("account-trigger").click();
    const menu = page.getByTestId("account-panel");
    await expect(menu).toBeVisible();
    const z = await menu.evaluate((el) => {
      const wrapper = el.closest("[data-radix-popper-content-wrapper]") ?? el;
      return Number(getComputedStyle(wrapper).zIndex);
    });
    // Dialogs are z-60 and the approvals sheet z-55 (globals.css ladder).
    expect(z).toBeGreaterThan(60);
    expect(z).toBeLessThan(70);
    if (await isTouch(page)) await expectTouchTargets(page, menu);
  });
});

test.describe("AUD-04 desktop regression (MW-21)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(width(page) < 1280, "desktop widths only");
  });

  test("a mouse at 1280/1440 keeps today's density and navigation", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    expect(await isTouch(page)).toBe(false);
    await expect(page.getByRole("button", { name: /open navigation/i })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).first()).toBeVisible();
    await expectNoPageOverflow(page, "tasks");

    // The dense sizes are unchanged: the bell is 36px, the user menu trigger under 44px tall.
    const bell = (await page.getByTestId("notification-bell").boundingBox())!;
    expect(Math.round(bell.height)).toBe(36);
    const create = page.getByTestId("quick-create-button");
    if (await create.count()) expect(Math.round((await create.boundingBox())!.height)).toBe(36);

    // A table that fits is not an extra tab stop.
    const regions = mainRegion(page).locator("[role=region]:has(table)");
    for (let index = 0; index < (await regions.count()); index += 1) {
      const region = regions.nth(index);
      const fits = await region.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      if (fits) await expect(region).not.toHaveAttribute("tabindex", "0");
      else await expect(region).toHaveAttribute("tabindex", "0");
    }

    // A dialog keeps its 24px close with a mouse.
    await page.getByTestId("search-trigger").click();
    const close = page.getByRole("dialog").getByRole("button", { name: "Close" });
    await expect(close).toBeVisible();
    expect(Math.round((await close.boundingBox())!.height)).toBeLessThanOrEqual(26);
  });
});
