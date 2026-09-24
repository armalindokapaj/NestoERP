import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { test, type BrowserContext, type Page } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * NAV-03 page and panel timings (§13 PERF-02, PERF-03; §18.3 item 2). Opt-in:
 * `NAV03_BENCH=1`, with `NAV_BENCH_LABEL`, `NAV_BENCH_SAMPLES` (30),
 * `NAV_BENCH_PROFILE=desktop|mobile` and `NAV_BENCH_OUT`. Production builds
 * only, run unchanged against the NAV-02 baseline and the NAV-03 build.
 *
 * Pages: the five NAV-03 streams, each as a document load and (desktop) as a
 * sidebar navigation after a deliberate hover, as a person with a mouse does.
 * Every stage is timed in the page, from navigation start or the click:
 *
 *   core     — the route's loading skeleton is gone and the page title is drawn
 *   primary  — the page's primary section is drawn with nothing pending inside
 *              it. A page with no section markers (the baseline) draws all at
 *              once, so there primary is the same instant as core.
 *   settled  — no section placeholder is left
 *
 * Panels: open to first usable content, `cold` (first open in a new document:
 * code and data) and `warm` (closed and reopened in the same document), timed
 * from the Playwright action to the content being visible — the same
 * overhead in both builds.
 *
 * Profiles are NAV-03's (§13 PERF-03): desktop 1440×900, 40 ms, 20 Mbps, no
 * CPU slowdown; constrained mobile 390×844, 4× CPU, 150 ms, 1.6 Mbps.
 */

const ENABLED = process.env.NAV03_BENCH === "1";
const SAMPLES = Number(process.env.NAV_BENCH_SAMPLES ?? 30);
const PROFILE = process.env.NAV_BENCH_PROFILE === "mobile" ? "mobile" : "desktop";
const LABEL = process.env.NAV_BENCH_LABEL ?? "after";
const OUT = process.env.NAV_BENCH_OUT ?? join(process.cwd(), "test-results");
const progress = (step: string) => console.log(`[nav03-bench ${LABEL}-${PROFILE}] ${new Date().toISOString().slice(11, 19)} ${step}`);

const PROFILES = {
  desktop: { viewport: { width: 1440, height: 900 }, latency: 40, down: 20, up: 10, cpu: 1 },
  mobile: { viewport: { width: 390, height: 844 }, latency: 150, down: 1.6, up: 0.75, cpu: 4 },
} as const;

const PAGES = [
  { name: "Dashboard", path: "/dashboard", from: "/calendar", link: 'nav[aria-label="Main navigation"] a[href="/dashboard"]' },
  { name: "Clients", path: "/clients", from: "/calendar", link: 'nav[aria-label="Main navigation"] a[href="/clients"]' },
  { name: "Tasks", path: "/tasks", from: "/calendar", link: 'nav[aria-label="Main navigation"] a[href="/tasks"]' },
  { name: "Finance", path: "/finance", from: "/calendar", link: 'nav[aria-label="Main navigation"] a[href="/finance"]' },
  { name: "Project home", path: "/projects/project_a", from: "/projects", link: '#nesto-main a[href="/projects/project_a"]' },
] as const;

const PANELS = [
  { name: "search", open: (page: Page) => page.keyboard.press("Control+k"), ready: '[data-testid^="palette-"], [data-testid="search-home-empty-hints"]' },
  { name: "quick_create", open: (page: Page) => page.getByTestId("quick-create-button").click(), ready: '[data-quick-create-action], [data-testid="quick-create-empty"]' },
  { name: "activity", open: (page: Page) => page.getByTestId("notification-bell").click(), ready: '[data-testid="activity-item"], [data-testid="activity-empty"]' },
  { name: "workspace", open: (page: Page) => page.getByTestId("workspace-switcher").click(), ready: '[data-testid="workspace-option"]', mobileSkip: true },
] as const;

type Stages = { core: number | null; primary: number | null; settled: number | null };

/**
 * Installed in every document: records each stage's first instant after
 * `window.__nav03Start` (0 for the document itself, the click for a
 * navigation), checked on every mutation and every frame.
 */
function installStageObserver() {
  const w = window as unknown as { __nav03Start: number; __nav03: Stages; __nav03Reset: (start: number) => void };
  w.__nav03Reset = (start: number) => {
    w.__nav03Start = start;
    w.__nav03 = { core: null, primary: null, settled: null };
  };
  w.__nav03Reset(0);
  const check = () => {
    const main = document.getElementById("nesto-main");
    const result = w.__nav03;
    if (!main || !main.querySelector("h1") || main.querySelector('[data-testid="page-skeleton"]')) return;
    if ((w as unknown as { __nav03Path?: string }).__nav03Path && location.pathname !== (w as unknown as { __nav03Path?: string }).__nav03Path) return;
    const now = performance.now() - w.__nav03Start;
    if (result.core === null) result.core = now;
    const streaming = main.querySelector('[data-section], [data-testid="section-skeleton"]');
    const primary = main.querySelector('[data-section="primary"]');
    if (result.primary === null && (!streaming || (primary && !primary.querySelector('[data-testid="section-skeleton"]')))) result.primary = now;
    if (result.settled === null && !main.querySelector('[data-testid="section-skeleton"]')) result.settled = now;
  };
  const start = () => {
    new MutationObserver(check).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    const frame = () => {
      check();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  if (document.documentElement) start();
  else document.addEventListener("readystatechange", start, { once: true });
}

async function throttle(page: Page) {
  const profile = PROFILES[PROFILE];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.latency,
    downloadThroughput: (profile.down * 1024 * 1024) / 8,
    uploadThroughput: (profile.up * 1024 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
}

async function stages(page: Page, path: string): Promise<Stages> {
  await page.waitForFunction(
    (target) => {
      const w = window as unknown as { __nav03?: Stages };
      return location.pathname === target && Boolean(w.__nav03) && w.__nav03!.settled !== null && w.__nav03!.primary !== null;
    },
    path,
    { timeout: 30_000, polling: 50 },
  );
  return page.evaluate(() => (window as unknown as { __nav03: Stages }).__nav03);
}

function stats(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  if (!numbers.length) return { n: 0, median: null, p95: null };
  const at = (q: number) => numbers[Math.min(numbers.length - 1, Math.ceil(q * numbers.length) - 1)];
  return { n: numbers.length, median: Math.round(at(0.5)), p95: Math.round(at(0.95)) };
}

const summarize = (samples: Stages[]) => ({ core: stats(samples.map((s) => s.core)), primary: stats(samples.map((s) => s.primary)), settled: stats(samples.map((s) => s.settled)) });

test.describe("NAV-03 benchmark", () => {
  test.skip(!ENABLED, "Set NAV03_BENCH=1 to run the NAV-03 page and panel benchmark.");
  test.setTimeout(90 * 60 * 1000);
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  test(`pages and panels (${PROFILE})`, async ({ browser }, testInfo) => {
    const report: Record<string, unknown> = { label: LABEL, profile: PROFILE, samples: SAMPLES, conditions: PROFILES[PROFILE] };
    // One sign-in per run, in one context: every sample shares the session.
    const context: BrowserContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: PROFILES[PROFILE].viewport, ...(PROFILE === "mobile" ? { isMobile: true, hasTouch: true } : {}) });
    await context.addInitScript(installStageObserver);
    const page = await context.newPage();
    await signIn(page, "OWNER", { to: "/calendar" });
    await throttle(page);

    // Document loads, interleaved across pages so each sees the same machine.
    const documents: Record<string, Stages[]> = Object.fromEntries(PAGES.map((p) => [p.name, []]));
    for (let index = 0; index < SAMPLES; index += 1) {
      for (const target of PAGES) {
        await page.goto("about:blank");
        await page.goto(target.path, { waitUntil: "commit" });
        documents[target.name].push(await stages(page, target.path));
        await page.waitForLoadState("load");
      }
    }
    report.documents = Object.fromEntries(Object.entries(documents).map(([name, samples]) => [name, summarize(samples)]));
    progress("documents");

    // Sidebar navigation (desktop: a pointer; phones have no hover), in two cohorts, interleaved:
    // `hovered` rests on the link for 400 ms first, as a person with a mouse does;
    // `unprepared` clicks with no pointer on the link, so intent prefetch has nothing to act on.
    // The baseline prepares both on sight, so its two cohorts differ only by chance.
    if (PROFILE === "desktop") {
      const cohorts = { hovered: {} as Record<string, Stages[]>, unprepared: {} as Record<string, Stages[]> };
      for (const cohort of Object.values(cohorts)) for (const p of PAGES) cohort[p.name] = [];
      for (let index = 0; index < SAMPLES; index += 1) {
        for (const target of PAGES) {
          for (const cohort of ["hovered", "unprepared"] as const) {
            await page.goto(target.from, { waitUntil: "load" });
            await page.locator(target.link).first().waitFor({ state: "visible" });
            await page.mouse.move(900, 500);
            await page.waitForTimeout(500);
            if (cohort === "hovered") await page.locator(target.link).first().hover();
            await page.waitForTimeout(400);
            await page.evaluate(
              ({ link, path }) => {
                const w = window as unknown as { __nav03Reset: (start: number) => void; __nav03Path?: string };
                w.__nav03Path = path;
                w.__nav03Reset(performance.now());
                document.querySelector<HTMLAnchorElement>(link)!.click();
              },
              { link: target.link, path: target.path },
            );
            // Each sample starts from a new document, so the tab's intent budget starts empty too.
            cohorts[cohort][target.name].push(await stages(page, target.path));
          }
        }
      }
      report.navigations = Object.fromEntries(
        Object.entries(cohorts).map(([cohort, byPage]) => [cohort, Object.fromEntries(Object.entries(byPage).map(([name, samples]) => [name, summarize(samples)]))]),
      );
      progress("navigations");
    }

    // Panels, cold then warm.
    const panels: Record<string, { cold: number[]; warm: number[] }> = {};
    for (const panel of PANELS) {
      if (PROFILE === "mobile" && "mobileSkip" in panel && panel.mobileSkip) continue;
      panels[panel.name] = { cold: [], warm: [] };
      for (let index = 0; index < SAMPLES; index += 1) {
        await page.goto("about:blank");
        await page.goto("/calendar", { waitUntil: "load" });
        await page.locator("#nesto-main h1").first().waitFor({ state: "visible" });
        await page.waitForTimeout(1_000);
        for (const phase of ["cold", "warm"] as const) {
          const started = Date.now();
          await panel.open(page);
          await page.locator(panel.ready).first().waitFor({ state: "visible", timeout: 15_000 });
          panels[panel.name][phase].push(Date.now() - started);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(600);
        }
      }
      progress(`panel ${panel.name}`);
    }
    report.panels = Object.fromEntries(Object.entries(panels).map(([name, value]) => [name, { cold: stats(value.cold), warm: stats(value.warm) }]));

    await context.close();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `nav03-benchmark-${LABEL}-${PROFILE}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  });
});
