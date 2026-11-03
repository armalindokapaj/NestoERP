import { expect, test, type Page } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * Back to a list or a record in version 2 of the design system (UI-02 §7.4,
 * §8.6; acceptance UI02-06).
 *
 * A page opened by a link starts at its top, as it always has. Reached again
 * by Back, a list or a record goes to the row or heading that was being read
 * and the distance past it (lib/navigation/scroll-memory.ts); a place that is
 * no longer on the page restores nothing. The query of a list is in its
 * address, so Back brings the filters with it.
 *
 * Version 2 is drawn only where NESTO_DESIGN_SYSTEM is set and the server has
 * its development conveniences (lib/layout/design-state.ts): the `nesto.ds`
 * cookie selects it there. Anywhere else the page comes back in version 1 and
 * these tests skip — version 1 opens every page at its top, Back included.
 */

const LIST = "/hr/employees?sort=name";
const STORE = "nesto.ui.section-return";

async function openInVersion2(page: Page, path: string) {
  // Short enough that the register scrolls.
  await page.setViewportSize({ width: 1440, height: 700 });
  const base = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3000");
  await page.context().addCookies([{ name: "nesto.ds", value: "2", url: base.origin }]);
  await signIn(page, "OWNER", { to: path });
  test.skip((await page.locator('html[data-ds="2"]').count()) === 0, "This server does not draw version 2 of the design system.");
  await expect(page.locator("#nesto-main h1").first()).toBeVisible();
}

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

/** The page has finished arriving: no skeleton left, and the same height on two looks in a row. */
async function settled(page: Page) {
  let last = -1;
  await expect
    .poll(async () => {
      const now = await page.evaluate(() => (document.querySelector('[aria-busy="true"], .animate-pulse') ? -1 : document.documentElement.scrollHeight));
      const same = now > 0 && now === last;
      last = now;
      return same;
    }, { intervals: [300], timeout: 30_000 })
    .toBe(true);
}

/** Scrolls, and waits until the place has been read: nothing is measured while the page moves. */
async function scrollTo(page: Page, top: number) {
  await settled(page);
  await page.evaluate((value) => window.scrollTo({ top: value, behavior: "instant" }), top);
  expect(await scrollY(page), "the page is long enough to scroll there").toBe(top);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), STORE)).toContain('"~');
}

/** A row's link that is on screen under the pinned layers, and where it is drawn. */
async function rowOnScreen(page: Page) {
  const row = await page.evaluate(() => {
    const link = [...document.querySelectorAll<HTMLAnchorElement>('#nesto-main a[href^="/hr/employees/"]')].find((node) => {
      const box = node.getBoundingClientRect();
      return box.height > 0 && box.top > 220 && box.bottom < window.innerHeight - 20;
    });
    return link ? { href: link.getAttribute("href")!, top: Math.round(link.getBoundingClientRect().top) } : null;
  });
  expect(row, "a row link on screen").not.toBeNull();
  return row!;
}

/** Follows the row's link in place: a pointer click would first scroll the row "into view" and move the page. */
async function openRow(page: Page, href: string) {
  await page.locator(`#nesto-main a[href="${href}"]`).first().evaluate((link: HTMLAnchorElement) => link.click());
  await page.waitForURL((url) => url.pathname === href.split("?")[0]);
  await expect(page.locator("#nesto-main h1").first()).toBeVisible();
}

test.describe("Back restores a list's and a record's place (UI-02 §7.4)", () => {
  test("a list comes back with its query, on the row that was being read", async ({ page }) => {
    await openInVersion2(page, LIST);
    await scrollTo(page, 460);
    const row = await rowOnScreen(page);

    await openRow(page, row.href);
    expect(await scrollY(page), "a page opened by a link starts at its top").toBe(0);

    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/hr/employees");
    expect(new URL(page.url()).search).toBe("?sort=name");
    await expect.poll(() => scrollY(page)).toBeGreaterThan(450);
    expect(Math.abs((await scrollY(page)) - 460)).toBeLessThanOrEqual(2);
    const top = await page.locator(`#nesto-main a[href="${row.href}"]`).first().evaluate((link) => Math.round(link.getBoundingClientRect().top));
    expect(Math.abs(top - row.top)).toBeLessThanOrEqual(2);
  });

  test("what is kept names no record, and a link to the list is not a return", async ({ page }) => {
    await openInVersion2(page, LIST);
    await scrollTo(page, 460);
    const row = await rowOnScreen(page);
    const kept = await page.evaluate((key) => sessionStorage.getItem(key), STORE);
    expect(kept).toContain('["/hr/employees?sort=name","~');
    expect(kept).not.toContain(row.href);

    await openRow(page, row.href);
    // The breadcrumb's own link back to the register: a new visit, from the top.
    await page.locator('[data-shell-breadcrumb] a[href^="/hr/employees"]').first().click();
    await page.waitForURL((url) => url.pathname === "/hr/employees");
    await expect(page.locator("#nesto-main h1").first()).toBeVisible();
    await page.waitForTimeout(600);
    expect(await scrollY(page)).toBe(0);
  });

  test("a row that is no longer on the page restores nothing", async ({ page }) => {
    await openInVersion2(page, LIST);
    await scrollTo(page, 460);
    const row = await rowOnScreen(page);
    await openRow(page, row.href);
    // The row is taken away — revoked, deleted — by leaving an anchor no row on the page answers to.
    await page.evaluate((key) => {
      const entries = JSON.parse(sessionStorage.getItem(key) ?? "[]") as [string, string, number][];
      for (const entry of entries) if (entry[0] === "/hr/employees?sort=name") entry[1] = "~no-row-answers-to-this";
      sessionStorage.setItem(key, JSON.stringify(entries));
    }, STORE);

    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/hr/employees");
    await expect(page.locator("#nesto-main h1").first()).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await scrollY(page)).toBe(0);
  });

  test("a record comes back at the place that was being read", async ({ page }) => {
    await openInVersion2(page, LIST);
    await settled(page);
    const row = await rowOnScreen(page);
    await openRow(page, row.href);
    await settled(page);
    const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(max, "the record scrolls").toBeGreaterThan(200);
    const left = Math.min(300, max - 20);
    await scrollTo(page, left);
    const kept = await page.evaluate((key) => sessionStorage.getItem(key), STORE);
    expect(kept).toContain(`["${row.href}","~`);

    // On to the register by its breadcrumb, then Back to the record. Followed in place, as a row is: a pointer click
    // from the test would first scroll the page to bring the pinned bar "into view".
    await page.locator('[data-shell-breadcrumb] a[href^="/hr/employees"]').first().evaluate((link: HTMLAnchorElement) => link.click());
    await page.waitForURL((url) => url.pathname === "/hr/employees");
    await expect(page.locator("#nesto-main h1").first()).toBeVisible();

    await page.goBack();
    await page.waitForURL((url) => url.pathname === row.href);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(left - 10);
    expect(Math.abs((await scrollY(page)) - left)).toBeLessThanOrEqual(2);
  });
});
