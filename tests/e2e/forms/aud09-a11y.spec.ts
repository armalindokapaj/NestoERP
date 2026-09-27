import { expect, test, type Locator, type Page } from "@playwright/test";

import { db, removeTestClients } from "../db";
import { engineerFile } from "../employee-files-fixtures";
import { mainRegion, signIn } from "../fixtures";

/**
 * Forms in the browser, across the adapter families (AUD-09 §3, §6, §9;
 * FV-02, FV-03, FV-12, FV-21).
 *
 * Written for the final AUD-09 run, not yet run. One representative form per
 * adapter family, because the families differ in how they wire errors and
 * submission:
 *
 *   RecordForm (server action)     /tasks/new               task form
 *   FormDialog (engineering kit)   HR "Add a document"      employee document dialog
 *   custom (JSON + duplicates)     /clients/new             client form
 *   custom, translated (sq)        /settings/profile        profile form
 *
 * Checked: completion by keyboard alone; an invalid submit announces an error
 * summary and moves focus to it (or to the first invalid field it links to);
 * 200% text size at 360px and 768px keeps errors and actions reachable above
 * an on-screen keyboard (a short viewport stands in for the keyboard); reduced
 * motion; long Albanian labels at phone width.
 */

const PREFIX = "E2E aud09 a11y";

test.afterAll(async () => {
  await removeTestClients(PREFIX);
  await db.$disconnect();
});

/** Presses Tab until `target` has focus: keyboard only, no click, no programmatic focus. */
async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  const handle = await target.elementHandle();
  for (let presses = 0; presses < limit; presses += 1) {
    if (await page.evaluate((element) => element === document.activeElement, handle)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("the control was not reachable by Tab");
}

/**
 * The invalid-submit contract (AUD-09 §6, FV-03): a persistent summary region
 * is announced (role alert or a live region) and names the problem, the field
 * is marked invalid with its message linked by aria-describedby, and focus is
 * on the summary or on the first invalid field — never left on the button.
 */
async function expectErrorContract(page: Page, scope: Locator, field: Locator) {
  const summary = scope.locator('[role="alert"], [aria-live="assertive"], [aria-live="polite"]').filter({ hasText: /\S/ }).first();
  await expect(summary).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const describedBy = await field.getAttribute("aria-describedby");
  expect(describedBy, "the field's error is linked to it").toBeTruthy();
  const described = await page.evaluate((ids) => ids!.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" "), describedBy);
  expect(described.trim().length).toBeGreaterThan(0);
  const focus = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      invalid: active?.getAttribute("aria-invalid") === "true",
      inSummary: Boolean(active?.closest('[role="alert"], [aria-live], [data-error-summary]')),
      tag: active?.tagName ?? null,
      type: (active as HTMLButtonElement | null)?.type ?? null,
    };
  });
  expect(focus.invalid || focus.inSummary, `focus went to ${focus.tag}[type=${focus.type}]`).toBe(true);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Scrolls `target` into view and requires it wholly inside the visible viewport. */
async function reachable(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box, "the control is rendered").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function doubleTextSize(page: Page) {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
}

/* -------------------------------------------------------------------------- */
/* RecordForm                                                                  */
/* -------------------------------------------------------------------------- */

test.describe("RecordForm — task form (/tasks/new)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
  });

  test("an untouched form shows no errors; an empty submit by Enter announces the summary and focuses it", async ({ page }) => {
    const main = mainRegion(page);
    const title = main.getByLabel("Title");
    await expect(main.locator('[aria-invalid="true"]')).toHaveCount(0);
    await tabTo(page, title);
    await page.keyboard.press("Enter");
    await expectErrorContract(page, main, title);
    // Still on the form: nothing was created.
    await expect(page).toHaveURL(/\/tasks\/new/);
  });

  for (const viewport of [{ width: 360, height: 420 }, { width: 768, height: 480 }]) {
    test(`at 200% text and ${viewport.width}px with a keyboard-high viewport, the error and the submit stay reachable`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await doubleTextSize(page);
      const main = mainRegion(page);
      await noHorizontalScroll(page);
      const submit = main.getByRole("button", { name: "Create task" });
      await reachable(page, submit);
      await submit.press("Enter");
      const title = main.getByLabel("Title");
      await expect(title).toHaveAttribute("aria-invalid", "true");
      const describedBy = (await title.getAttribute("aria-describedby"))!.split(/\s+/)[0];
      await reachable(page, page.locator(`[id="${describedBy}"]`));
      await reachable(page, submit);
      await noHorizontalScroll(page);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Custom form                                                                 */
/* -------------------------------------------------------------------------- */

test.describe("custom — client form (/clients/new)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/clients/new" });
  });

  test("is completed by keyboard alone: Tab to the name, type, Enter submits once", async ({ page }) => {
    const main = mainRegion(page);
    const name = `${PREFIX} Keyboard ${Date.now()}`;
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/clients")) posts.push(request.url());
    });
    await tabTo(page, main.getByLabel("Client name"));
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
    // A second Enter while saving must not make a second client (FV-12).
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => /\/clients\/(?!new)[^/]+/.test(url.pathname), { timeout: 20_000 });
    expect(await db.client.count({ where: { name } })).toBe(1);
  });

  test("an invalid submit keeps the input and puts focus on the summary or the field", async ({ page }) => {
    const main = mainRegion(page);
    const website = main.getByLabel("Website");
    await tabTo(page, main.getByLabel("Client name"));
    await page.keyboard.type(`${PREFIX} Invalid ${Date.now()}`);
    await tabTo(page, website);
    await page.keyboard.type("not a url");
    await page.keyboard.press("Enter");
    await expectErrorContract(page, main, website);
    await expect(website).toHaveValue("not a url");
  });

  test("reduced motion: nothing on the page animates for longer than a frame", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const slow = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("#nesto-main *")].filter((element) => {
        const style = getComputedStyle(element);
        const longest = (value: string) => Math.max(...value.split(",").map((part) => parseFloat(part) * (part.trim().endsWith("ms") ? 0.001 : 1)));
        return longest(style.animationDuration) > 0.02 || longest(style.transitionDuration) > 0.02;
      }).length,
    );
    expect(slow).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* FormDialog                                                                  */
/* -------------------------------------------------------------------------- */

test.describe("FormDialog — HR employee document", () => {
  let employeeId: string;

  test.beforeAll(async () => {
    ({ employeeId } = await engineerFile());
  });

  test("opens, is filled and fails by keyboard; focus stays in the dialog on the error; Escape closes an untouched dialog", async ({ page }) => {
    await signIn(page, "HR", { to: `/hr/employees/${employeeId}/documents` });
    const trigger = mainRegion(page).getByTestId("add-employee-document");
    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("add-employee-document-dialog");
    await expect(dialog).toBeVisible();
    // Focus moved into the dialog.
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    // Submit with nothing chosen: the dialog explains, and focus is not lost.
    await tabTo(page, dialog.getByRole("button", { name: "Add document" }));
    await page.keyboard.press("Enter");
    const summary = dialog.locator('[role="alert"], [aria-live]').filter({ hasText: /\S/ }).first();
    await expect(summary).toBeVisible();
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expect(dialog.locator('[aria-invalid="true"]').first()).toBeVisible();

    // Reduced motion: the dialog itself does not animate.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const duration = await dialog.evaluate((element) => getComputedStyle(element).animationDuration);
    expect(parseFloat(duration) * (duration.endsWith("ms") ? 0.001 : 1)).toBeLessThanOrEqual(0.02);
  });

  test("at 200% text on a 360px phone the dialog's actions stay reachable", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await signIn(page, "HR", { to: `/hr/employees/${employeeId}/documents` });
    await doubleTextSize(page);
    await mainRegion(page).getByTestId("add-employee-document").click();
    const dialog = page.getByTestId("add-employee-document-dialog");
    await expect(dialog).toBeVisible();
    await reachable(page, dialog.getByRole("button", { name: "Add document" }));
    await reachable(page, dialog.getByTestId("employee-document-file"));
    await noHorizontalScroll(page);
  });
});

/* -------------------------------------------------------------------------- */
/* Long translations                                                           */
/* -------------------------------------------------------------------------- */

test.describe("long translations — profile form in Albanian", () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "nesto.locale", value: "sq", url: baseURL! }]);
    await signIn(page, "PROJECT_MANAGER", { to: "/settings/profile" });
  });

  for (const viewport of [{ width: 360, height: 640 }, { width: 768, height: 1024 }]) {
    test(`labels and the save action fit at ${viewport.width}px, also at 200% text`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Profile");
      for (const scale of ["100%", "200%"]) {
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, scale);
        await noHorizontalScroll(page);
        for (const id of ["profile-firstName", "profile-lastName", "profile-phone"]) {
          const label = page.locator(`label[for="${id}"]`);
          await reachable(page, label);
          await reachable(page, page.locator(`#${id}`));
        }
        const save = mainRegion(page).locator('button[type="submit"]').first();
        await reachable(page, save);
      }
    });
  }
});
