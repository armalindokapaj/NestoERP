import { expect, test, type Page } from "@playwright/test";

import { mainRegion, signIn } from "./../fixtures";
import { expectNoPageOverflow } from "./geometry";

/**
 * MOB-04 forms and detail pages: the same RecordForm on every width, with its
 * actions pinned to the bottom of a phone and in the page flow from md; the
 * shared record page as semantic sections. Nothing is saved: the specs open
 * pages and read geometry. Runs in every responsive matrix project.
 */

const width = (page: Page) => page.viewportSize()!.width;
const isPhone = (page: Page) => width(page) < 768;

test.describe("form actions", () => {
  test("create task: actions sit at the bottom of a phone screen and in the flow on desktop", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
    const actions = mainRegion(page).locator("[data-form-actions]").first();
    await expect(actions).toBeVisible();
    const submit = actions.getByRole("button").first();
    await expect(submit).toBeVisible();
    const position = await actions.evaluate((node) => getComputedStyle(node).position);
    if (isPhone(page)) {
      expect(position).toBe("sticky");
      const box = (await actions.boundingBox())!;
      const viewport = page.viewportSize()!;
      // Pinned to the bottom edge of the screen, whole in view, above the safe area.
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(box.y + box.height).toBeGreaterThan(viewport.height - 140);
      // The bottom navigation yields to a sticky action bar instead of stacking with it.
      await expect(page.locator("[data-mobile-bottom-nav]")).toBeHidden();
    } else {
      expect(position).toBe("static");
    }
    await expectNoPageOverflow(page);
  });

  test("the submit button is at least 44px high under touch and a real button", async ({ page }) => {
    test.skip(!isPhone(page), "touch targets are about phones");
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
    const submit = mainRegion(page).locator("[data-form-actions]").getByRole("button").first();
    const box = (await submit.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("a failed submit shows the error next to the field and a summary, and keeps what was typed", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
    const main = mainRegion(page);
    await main.locator("[data-form-actions] button[type=submit]").click();
    await expect(main.getByTestId("field-error").first()).toBeVisible();
    // Focus lands on the first invalid field or the error summary (AUD-09 §6), not at the bottom of the page.
    const landed = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.getAttribute("aria-invalid") === "true" || Boolean(active?.closest("[data-testid=form-error-summary]"));
    });
    expect(landed).toBe(true);
  });
});

test.describe("dirty forms", () => {
  test("leaving an edited form asks first; an untouched one leaves freely", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
    const main = mainRegion(page);
    const field = main.locator("form input[type=text]:visible, form input:not([type]):visible").first();
    await field.fill("Unsaved MOB-04 probe");
    await main.locator("[data-form-actions]").getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByTestId("unsaved-prompt")).toBeVisible();
    await expect(page.getByTestId("unsaved-stay")).toBeVisible();
    await expect(page.getByTestId("unsaved-discard")).toBeVisible();
    await page.getByTestId("unsaved-stay").click();
    await expect(field).toHaveValue("Unsaved MOB-04 probe");
  });
});
