import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { db, removeTestTasks } from "../db";
import { mainRegion, signIn, sidebar, type DemoRole } from "../fixtures";
import { emulateTextZoom, expectInViewport, expectNoPageOverflow, expectNotCovered } from "../responsive/geometry";

/**
 * AUD-11 shared primitives and shell (§3–§8; AV-02, AV-04, AV-05, AV-06,
 * AV-09, AV-10, AV-11, AV-14, AV-15, AV-17).
 *
 * - axe (wcag2a, wcag2aa, wcag21aa) over the shell and representative pages in
 *   light and dark, and over open dialog, menu and validation-error states. A
 *   serious or critical finding fails; every finding is attached to the report.
 *   Documented false positives go in FALSE_POSITIVES with the reason.
 * - Skip link, landmarks, title and aria-current after navigation.
 * - Focus indicator present and unobscured on shell and page controls, both themes.
 * - Dialog: named, safe initial focus, contained Tab, Escape, restore; AUD-03
 *   Stay keeps the dialog and its text.
 * - One polite and one assertive live region; skeletons hidden.
 * - Theme first paint from the cookie, system follows the OS, pins win, portals themed.
 * - Reduced motion and forced colours.
 * - 320px reflow, 200% text, 400% zoom from 1280.
 *
 * Identities: Owner, Finance, Project Manager and read-only Viewer of Aurelia,
 * plus Platform Admin. The one owned record is a task named AUD11S…, removed
 * afterwards.
 */

const PREFIX = "AUD11S";
const AURELIA = "company_demo_a";
const PM = "member_pm";

test.afterAll(async () => {
  await removeTestTasks(PREFIX);
  await db.$disconnect();
});

/** Rule id → why it is not a defect here. Empty until a finding is reviewed and justified. */
const FALSE_POSITIVES: Record<string, string> = {};

async function scan(page: Page, label: string, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  await test.info().attach(`axe ${label}`, { body: JSON.stringify(results.violations, null, 2), contentType: "application/json" });
  const blocking = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .filter((violation) => !(violation.id in FALSE_POSITIVES))
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
  expect(blocking, `${label}: serious/critical axe findings`).toEqual([]);
}

type Theme = "light" | "dark";

async function useTheme(page: Page, theme: Theme) {
  const url = new URL(page.url() === "about:blank" ? "http://localhost" : page.url());
  await page.context().addCookies([{ name: "nesto.theme", value: theme, domain: url.hostname, path: "/" }]);
}

const PAGES: Array<{ path: string; role: DemoRole }> = [
  { path: "/dashboard", role: "OWNER" },
  { path: "/projects", role: "PROJECT_MANAGER" },
  { path: "/tasks", role: "PROJECT_MANAGER" },
  { path: "/tasks/new", role: "PROJECT_MANAGER" },
  { path: "/finance/expenses", role: "FINANCE_A" },
  { path: "/approvals", role: "OWNER" },
  { path: "/tasks", role: "VIEWER" },
  { path: "/settings/appearance", role: "OWNER" },
];

test.describe("AV-17 automated scans, light and dark", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const { path, role } of PAGES) {
      test(`${theme}: ${path} as ${role}`, async ({ page }) => {
        await signIn(page, role);
        await useTheme(page, theme);
        await page.goto(path);
        await expect(mainRegion(page).locator("h1").first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await scan(page, `${theme} ${path} ${role}`);
      });
    }

    test(`${theme}: Platform Admin`, async ({ page }) => {
      await signIn(page, "PLATFORM_ADMIN", { to: "/admin" });
      await useTheme(page, theme);
      await page.reload();
      await expect(page.locator("h1").first()).toBeVisible();
      await scan(page, `${theme} platform-admin`);
    });

    test(`${theme}: open user menu, validation error`, async ({ page }) => {
      await signIn(page, "PROJECT_MANAGER");
      await useTheme(page, theme);
      await page.goto("/tasks/new");
      await page.getByTestId("account-trigger").click();
      await expect(page.getByRole("menu")).toBeVisible();
      await scan(page, `${theme} user menu open`);
      await page.keyboard.press("Escape");

      // Submitting the empty form: the AUD-09 error summary and linked field errors.
      await mainRegion(page).getByRole("button", { name: /create|save/i }).first().click();
      await expect(mainRegion(page).locator("[aria-invalid=true]").first()).toBeVisible();
      await scan(page, `${theme} validation error`);
    });
  }
});

test.describe("AV-02 skip link, landmarks, title, current page", () => {
  test("the first Tab is Skip to main content, and it lands in the page", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    const skip = page.getByTestId("skip-link");
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAccessibleName(/skip to main content|kalo te përmbajtja kryesore/i);
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(mainRegion(page)).toBeFocused();
    expect(new URL(page.url()).hash).toBe("");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.getElementById("nesto-main")!.contains(document.activeElement))).toBe(true);
  });

  test("one main, a banner, a named navigation; title and aria-current follow navigation", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(sidebar(page)).toBeVisible();
    await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(1);
    const before = await page.title();

    await sidebar(page).getByRole("link", { name: /^tasks$/i }).click();
    await page.waitForURL(/\/tasks/);
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    await expect(page).not.toHaveTitle(before);
    await expect(page).toHaveTitle(/· NESTO$/);
    const current = sidebar(page).locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAccessibleName(/tasks/i);
  });

  test("every rail icon link has a name (AV-06)", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await signIn(page, "OWNER", { to: "/dashboard" });
    const unnamed = await sidebar(page)
      .getByRole("link")
      .evaluateAll((links) => links.filter((link) => !(link.getAttribute("aria-label") ?? link.textContent ?? "").trim()).length);
    expect(unnamed).toBe(0);
  });
});

/** The element has a visible focus indicator: an outline or a ring of at least 2px. */
async function expectFocusIndicator(target: Locator, context: string) {
  const style = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outlineStyle: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth), boxShadow: s.boxShadow };
  });
  const outlined = style.outlineStyle !== "none" && style.outlineWidth >= 2;
  const ringed = style.boxShadow !== "none" && /\b([2-9]|\d{2,})px\b/.test(style.boxShadow);
  expect(outlined || ringed, `${context}: no 2px focus indicator (${JSON.stringify(style)})`).toBe(true);
}

test.describe("AV-04 focus visible and unobscured, both themes", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`${theme}: the first 25 Tab stops on a list and a form`, async ({ page }) => {
      await signIn(page, "PROJECT_MANAGER");
      await useTheme(page, theme);
      for (const path of ["/tasks", "/tasks/new"]) {
        await page.goto(path);
        await expect(mainRegion(page).locator("h1").first()).toBeVisible();
        for (let stop = 0; stop < 25; stop += 1) {
          await page.keyboard.press("Tab");
          const focused = page.locator(":focus");
          if ((await focused.count()) === 0) continue;
          const id = await focused.evaluate((el) => `${el.tagName.toLowerCase()}[${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? ""}]`);
          await expectFocusIndicator(focused, `${theme} ${path} ${id}`);
          // Inside the page, never underneath the sticky top bar (AUD-04 scroll-padding).
          if (await focused.evaluate((el) => el.closest("#nesto-main") !== null)) await expectNotCovered(focused, `${theme} ${path} ${id}`);
        }
      }
    });
  }
});

test.describe("AV-05 dialogs: name, initial focus, trap, Escape, restore, AUD-03 Stay", () => {
  async function seedTask() {
    return db.task.create({
      data: { companyId: AURELIA, title: `${PREFIX} dialog ${Date.now()}`, status: "TODO", priority: "MEDIUM", createdByMemberId: PM, createdBy: "e2e" },
      select: { id: true },
    });
  }

  async function openBlockDialogByKeyboard(page: Page) {
    const main = mainRegion(page);
    const direct = main.getByRole("button", { name: /mark blocked/i });
    let invoker: Locator;
    if (await direct.isVisible().catch(() => false)) {
      invoker = direct;
      await invoker.focus();
      await page.keyboard.press("Enter");
    } else {
      invoker = main.getByRole("button", { name: /more/i }).first();
      await invoker.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toBeVisible();
      await page.getByRole("menuitem", { name: /mark blocked/i }).focus();
      await page.keyboard.press("Enter");
    }
    const dialog = page.getByRole("dialog").filter({ hasText: /blocked/i });
    await expect(dialog).toBeVisible();
    return { dialog, invoker };
  }

  test("keyboard only, with the unsaved-work Stay", async ({ page }) => {
    const task = await seedTask();
    await signIn(page, "PROJECT_MANAGER", { to: `/tasks/${task.id}` });
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    const { dialog, invoker } = await openBlockDialogByKeyboard(page);

    // Named, and focus starts inside on something that is not destructive.
    await expect(dialog).toHaveAccessibleName(/.+/);
    const first = page.locator(":focus");
    expect(await dialog.evaluate((el, focused) => el.contains(focused), await first.elementHandle())).toBe(true);
    await expect(first).not.toHaveAttribute("data-variant", "danger");

    // Tab and Shift+Tab stay inside; the page behind is hidden from assistive technology.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press(i % 3 === 2 ? "Shift+Tab" : "Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")))).toBe(true);
    }
    // Radix hides everything outside the dialog: role queries skip aria-hidden content.
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByRole("main")).toHaveCount(0);

    // AUD-03: with text typed, Escape asks; Escape on the prompt means Stay.
    const reason = dialog.getByRole("textbox").first();
    await reason.fill(`${PREFIX} waiting for drawings`);
    await page.keyboard.press("Escape");
    const prompt = page.getByTestId("unsaved-prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt.getByTestId("unsaved-stay")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(prompt).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(reason).toHaveValue(`${PREFIX} waiting for drawings`);
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")))).toBe(true);

    // Emptied, Escape closes only the dialog and focus returns to the invoker.
    await reason.fill("");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(invoker).toBeFocused();
  });
});

test.describe("AV-09 live regions and skeletons", () => {
  test("exactly one polite and one assertive shell region; skeleton shapes hidden", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    await expect(page.getByTestId("live-announcer-polite")).toHaveCount(1);
    await expect(page.getByTestId("live-announcer-assertive")).toHaveCount(1);
    await expect(page.getByTestId("live-announcer-polite")).toHaveAttribute("aria-live", "polite");
    await expect(page.getByTestId("live-announcer-assertive")).toHaveAttribute("aria-live", "assertive");
    const exposedSkeletons = await page
      .locator("[data-testid=skeleton-table], [data-testid=skeleton-cards]")
      .evaluateAll((nodes) => nodes.filter((node) => node.getAttribute("aria-hidden") !== "true").length);
    expect(exposedSkeletons).toBe(0);
  });
});

test.describe("AV-14 themes", () => {
  async function canvas(page: Page) {
    return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  }

  test("an explicit choice is in the first byte of HTML: no flash", async ({ page }) => {
    await signIn(page, "OWNER");
    await useTheme(page, "dark");
    const html = await (await page.request.get("/dashboard")).text();
    expect(html).toMatch(/<html[^>]*data-theme="dark"/);
  });

  test("system follows the OS; a pinned choice ignores it; portals match", async ({ page }) => {
    await signIn(page, "OWNER");
    await page.context().clearCookies({ name: "nesto.theme" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/dashboard");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    const systemDark = await canvas(page);
    await page.emulateMedia({ colorScheme: "light" });
    const systemLight = await canvas(page);
    expect(systemDark).not.toBe(systemLight);

    await useTheme(page, "light");
    await page.reload();
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await canvas(page)).toBe(systemLight);

    // A portal (the user menu) is painted in the pinned scheme too.
    await page.getByTestId("account-trigger").click();
    const menuBg = await page.getByRole("menu").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(menuBg).toBe("rgb(255, 255, 255)");
  });

  test("the preference is a keyboard radio group that applies at once, without a reload", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/settings/appearance" });
    await page.evaluate(() => ((window as unknown as { __aud11?: number }).__aud11 = 1));
    const group = page.getByRole("radiogroup");
    const checked = group.getByRole("radio", { checked: true });
    await checked.focus();
    await page.keyboard.press("End");
    await expect(group.getByRole("radio", { name: /dark/i })).toBeFocused();
    await expect(group.getByRole("radio", { name: /dark/i })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Home");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    expect(await page.evaluate(() => (window as unknown as { __aud11?: number }).__aud11)).toBe(1);
    // One Tab stop for the whole group.
    await expect(group.locator('[role=radio][tabindex="0"]')).toHaveCount(1);
  });
});

test.describe("AV-15 reduced motion and forced colours", () => {
  test("reduced motion: no pulsing skeletons, no dialog travel", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    const probe = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "nesto-skeleton";
      document.body.append(el);
      const s = getComputedStyle(el);
      const result = { name: s.animationName };
      el.remove();
      return result;
    });
    expect(probe.name).toBe("none");
    await page.getByTestId("account-trigger").click();
    const duration = await page.getByRole("menu").evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) || 0);
    expect(duration).toBeLessThanOrEqual(0.001);
  });

  test("forced colours: focus is a system outline and control boundaries remain", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
    const title = mainRegion(page).getByLabel("Title");
    await title.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const s = await title.evaluate((el) => {
      const c = getComputedStyle(el);
      return { outlineStyle: c.outlineStyle, outlineWidth: parseFloat(c.outlineWidth), borderStyle: c.borderTopStyle, borderWidth: parseFloat(c.borderTopWidth) };
    });
    expect(s.outlineStyle).toBe("solid");
    expect(s.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(s.borderStyle).not.toBe("none");
    expect(s.borderWidth).toBeGreaterThanOrEqual(1);
    await scan(page, "forced colours /tasks/new");
  });
});

test.describe("AV-11 reflow and zoom", () => {
  test("320px: no page-wide sideways scroll, controls reachable", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const [role, path] of [["PROJECT_MANAGER", "/tasks"], ["OWNER", "/dashboard"], ["FINANCE_A", "/finance/expenses"]] as const) {
      await signIn(page, role, { to: path });
      await expect(mainRegion(page).locator("h1").first()).toBeVisible();
      await expectNoPageOverflow(page, `${path} at 320`);
    }
  });

  test("200% text at 1280: the form stays usable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
    await emulateTextZoom(page, 2);
    await expectNoPageOverflow(page, "200% text");
    await expectInViewport(mainRegion(page).getByLabel("Title"), "first field at 200%");
    const save = mainRegion(page).getByRole("button", { name: /create|save/i }).first();
    await save.scrollIntoViewIfNeeded();
    await expectNotCovered(save, "primary action at 200%");
  });

  test("400% zoom from 1280 (a 320×180 CSS viewport): content and the primary action remain", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 180 });
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    await expectNoPageOverflow(page, "400% zoom");
    const save = mainRegion(page).getByRole("button", { name: /create|save/i }).first();
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
  });
});
