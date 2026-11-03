import { expect, test, type Page } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * Sticky geometry in version 2 of the design system (UI-02 §7, §7.3, §24;
 * acceptance UI02-04, UI02-05, UI02-72).
 *
 * The top bar, the breadcrumb bar and a page's context tabs are pinned one
 * under the other at the heights §7 gives, and `--nesto-sticky-stack` — what
 * focus scrolling, anchors, a page's own toolbars and the scroll ruler are
 * offset by — is their true height, measured here, at every tier. In a window
 * too low for them the secondary layers scroll with the page and the top bar
 * alone stays.
 *
 * Version 2 is drawn only where NESTO_DESIGN_SYSTEM is set and the server has
 * its development conveniences (lib/layout/design-state.ts): the `nesto.ds`
 * cookie selects it there. Anywhere else the page comes back in version 1 and
 * these tests skip — version 1's geometry is what the rest of the suite holds.
 */

const PROJECT = "/projects/project_a";

type Tier = { name: string; width: number; height: number; header: number; breadcrumb: number | null; tabs: number; sidebar: number | null };

/** A fine pointer from 1024px; below it the touch sizes of the two rows under the header (§6.4). */
const TIERS: Tier[] = [
  { name: "desktop 1440", width: 1440, height: 900, header: 64, breadcrumb: 32, tabs: 40, sidebar: 208 },
  { name: "desktop 1024 (rail)", width: 1024, height: 768, header: 64, breadcrumb: 32, tabs: 40, sidebar: 64 },
  { name: "tablet 768", width: 768, height: 1024, header: 60, breadcrumb: 40, tabs: 44, sidebar: null },
  { name: "phone 390", width: 390, height: 844, header: 56, breadcrumb: null, tabs: 44, sidebar: null },
];

async function openInVersion2(page: Page, path: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  const base = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3000");
  await page.context().addCookies([{ name: "nesto.ds", value: "2", url: base.origin }]);
  await signIn(page, "OWNER", { to: path });
  test.skip((await page.locator('html[data-ds="2"]').count()) === 0, "This server does not draw version 2 of the design system.");
  await expect(page.locator("[data-context-tabs]").first()).toBeVisible();
}

/** The pinned layers as drawn, and the geometry the stylesheet publishes, in CSS pixels. */
function geometry(page: Page) {
  return page.evaluate(() => {
    const resolve = (expression: string) => {
      const probe = document.createElement("div");
      probe.style.cssText = `position:fixed;top:0;left:0;width:0;visibility:hidden;height:${expression}`;
      document.body.appendChild(probe);
      const value = probe.getBoundingClientRect().height;
      probe.remove();
      return value;
    };
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || element.getClientRects().length === 0) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width, position: getComputedStyle(element).position, zIndex: getComputedStyle(element).zIndex };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollY: window.scrollY,
      sidewaysScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      header: box("header[data-topbar-row]"),
      breadcrumb: box("[data-shell-breadcrumb]"),
      tabs: box("[data-context-tabs]"),
      sidebar: box('aside:has([data-testid="sidebar-header"])'),
      bottomNav: box("[data-mobile-bottom-nav]"),
      stack: resolve("var(--nesto-sticky-stack)"),
      cover: resolve("var(--nesto-sticky-cover)"),
    };
  });
}

for (const tier of TIERS) {
  test(`${tier.name}: each pinned layer starts where the one above ends, and the stack is their true height`, async ({ page }) => {
    await openInVersion2(page, PROJECT, tier);
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(async () => (await geometry(page)).scrollY).toBeGreaterThan(200);
    const g = await geometry(page);

    expect(g.header?.top).toBe(0);
    expect(g.header?.height).toBe(tier.header);
    let edge = tier.header;
    if (tier.breadcrumb === null) {
      expect(g.breadcrumb).toBeNull();
    } else {
      expect(g.breadcrumb?.top).toBeCloseTo(edge, 0);
      expect(g.breadcrumb?.height).toBe(tier.breadcrumb);
      edge += tier.breadcrumb;
    }
    expect(g.tabs?.top).toBeCloseTo(edge, 0);
    expect(g.tabs?.height).toBe(tier.tabs);
    edge += tier.tabs;

    // What everything else is offset by is what is really pinned (§7.3).
    expect(g.stack).toBeCloseTo(edge, 0);
    expect(g.cover).toBeCloseTo(edge, 0);
    expect(g.sidewaysScroll).toBe(false);

    if (tier.sidebar === null) {
      expect(g.sidebar).toBeNull();
    } else {
      expect(g.sidebar?.width).toBe(tier.sidebar);
      // §7.3: sidebar 20, under the shell's 30.
      expect(Number(g.sidebar?.zIndex)).toBeLessThan(Number(g.header?.zIndex));
    }
  });
}

test("a heading scrolled into view, and a control given focus, land below the pinned layers", async ({ page }) => {
  await openInVersion2(page, PROJECT, { width: 1440, height: 900 });
  const landed = await page.evaluate(() => {
    const headings = [...document.querySelectorAll<HTMLElement>("#nesto-main h2, #nesto-main h3")];
    const heading = headings[headings.length - 1];
    heading.scrollIntoView();
    const top = heading.getBoundingClientRect().top;
    // A control of the page itself, a viewport or more down, focused from the foot of the page: the browser brings it up under the stack.
    window.scrollTo(0, 0);
    const control = [...document.querySelectorAll<HTMLElement>("#nesto-main a[href], #nesto-main button:not(:disabled)")].find(
      (element) => !element.closest("[data-context-tabs]") && element.getClientRects().length > 0 && element.getBoundingClientRect().top > window.innerHeight,
    );
    window.scrollTo(0, document.documentElement.scrollHeight);
    control?.focus();
    return { top, control: control?.getBoundingClientRect().top ?? null };
  });
  const g = await geometry(page);
  expect(landed.top).toBeGreaterThanOrEqual(g.stack - 0.5);
  expect(landed.control).not.toBeNull();
  expect(landed.control!).toBeGreaterThanOrEqual(g.stack - 0.5);
});

test("the sidebar does not widen under the pointer", async ({ page }) => {
  await openInVersion2(page, PROJECT, { width: 1100, height: 800 });
  const rail = page.locator('aside:has([data-testid="sidebar-header"])');
  await expect(rail).toBeVisible();
  const before = (await rail.boundingBox())!.width;
  expect(before).toBe(64);
  const link = rail.getByRole("link", { name: "Projects" });
  await link.hover();
  // On the rail a row names itself in a tooltip instead (§7.1).
  await expect(page.getByRole("tooltip", { name: "Projects" })).toBeVisible();
  expect((await rail.boundingBox())!.width).toBe(before);
  await expect(link).toHaveAttribute("aria-current", "page");
});

test("400% zoom (360 by 225): the secondary layers scroll with the page and the top bar stays", async ({ page }) => {
  await openInVersion2(page, PROJECT, { width: 360, height: 225 });
  const atTop = await geometry(page);
  expect(atTop.tabs?.position).toBe("static");
  expect(atTop.bottomNav?.position).toBe("static");

  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(async () => (await geometry(page)).scrollY).toBeGreaterThan(200);
  const g = await geometry(page);
  expect(g.header?.top).toBe(0);
  expect(g.header?.height).toBe(56);
  // Gone with the page, not held over it.
  expect(g.tabs!.bottom).toBeLessThan(0);
  expect(g.bottomNav!.top).toBeGreaterThan(g.viewport.height);
  expect(g.stack).toBeCloseTo(56, 0);
  // At least half the window is left to read in (§7.3).
  expect(g.viewport.height - g.header!.bottom).toBeGreaterThanOrEqual(g.viewport.height / 2);
  expect(g.sidewaysScroll).toBe(false);

  // Navigation is still in the bar that stayed.
  await expect(page.getByTestId("global-actions")).toBeVisible();
});

test("a phone's project tabs are one row that scrolls sideways and marks the edge it continues past", async ({ page }) => {
  await openInVersion2(page, PROJECT, { width: 390, height: 844 });
  const scroller = page.locator("[data-context-tabs] [data-tab-scroller]").first();
  await expect(scroller).toHaveAttribute("data-more-end", "");
  await expect(scroller).not.toHaveAttribute("data-more-start", "");
  expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  // One row: every tab on the same line.
  const tops = await scroller.locator("a, button").evaluateAll((tabs) => [...new Set(tabs.map((tab) => Math.round(tab.getBoundingClientRect().top)))]);
  expect(tops).toHaveLength(1);

  // The labelled More control is at the far end of the row, reachable by scrolling it.
  const more = scroller.getByRole("button", { name: "More" });
  await more.scrollIntoViewIfNeeded();
  await expect(scroller).toHaveAttribute("data-more-start", "");
  await expect(scroller).not.toHaveAttribute("data-more-end", "");
  await expect(more).toBeVisible();
});
