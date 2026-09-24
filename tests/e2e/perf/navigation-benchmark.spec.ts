import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { signIn, type DemoRole } from "../fixtures";

/**
 * NAV-01 benchmark (§14). Opt-in: `NAV_BENCH=1` (and `NAV_BENCH_LABEL`,
 * `NAV_BENCH_SAMPLES`, `NAV_BENCH_PROFILE=desktop|mobile`). Run it against a
 * production build only.
 *
 * Each sample opens the origin page with a real document load, lets the
 * link's default prefetch arrive, then clicks inside the page so the start time
 * is the click itself. It records, per transition:
 *
 *   feedback_visible — first painted pending mark, skeleton or destination
 *   route_committed  — the URL changed
 *   content_usable   — the destination's primary content is visible
 *
 * Each scenario runs twice, reported apart (§14.3 step 4):
 *
 *   warm     — the link's default prefetch has arrived before the click
 *   uncached — nothing is prefetched, so the click fetches its destination
 *              from nothing. The router skips prefetching for crawlers, so
 *              this page's `navigator.userAgent` reads as one; requests still
 *              carry the browser's own user agent, and the server renders as
 *              usual. `prefetch_requests` shows none were made.
 *
 * Cold entry is a document load and is reported apart. Labels are route
 * templates only — no record names. `NAV_BENCH_OUT` puts the JSON somewhere
 * other than test-results, so two runs side by side keep their own.
 */

const ENABLED = process.env.NAV_BENCH === "1";
const SAMPLES = Number(process.env.NAV_BENCH_SAMPLES ?? 30);
const PROFILE = process.env.NAV_BENCH_PROFILE === "mobile" ? "mobile" : "desktop";
const LABEL = process.env.NAV_BENCH_LABEL ?? "after";
const DOCUMENTS_ONLY = process.env.NAV_BENCH_ONLY === "documents";
const OUT = process.env.NAV_BENCH_OUT ?? join(process.cwd(), "test-results");
const CRAWLER = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const progress = (step: string) => console.log(`[nav-bench ${LABEL}-${PROFILE}] ${new Date().toISOString().slice(11, 19)} ${step}`);

const PROFILES = {
  // §14.3 step 2: 100 ms latency, 10/5 Mbps, no CPU slowdown; mobile 150 ms, 4/1 Mbps, 4× CPU.
  desktop: { viewport: { width: 1440, height: 900 }, latency: 100, down: 10, up: 5, cpu: 1 },
  mobile: { viewport: { width: 390, height: 844 }, latency: 150, down: 4, up: 1, cpu: 4 },
} as const;

type Scenario = {
  name: string;
  role: DemoRole;
  origin: string;
  /** The link to click, found inside #nesto-main or the sidebar. */
  link: string;
  /** Visible when the destination is usable; any visible match counts (phones show cards, not tables). */
  ready: string;
  mobileSkip?: boolean;
};

const SCENARIOS: Scenario[] = [
  { name: "Dashboard → Projects", role: "PROJECT_MANAGER", origin: "/dashboard", link: 'nav a[href="/projects"]', ready: '#nesto-main [data-testid="project-card"], #nesto-main h1', mobileSkip: true },
  { name: "Projects → project detail", role: "PROJECT_MANAGER", origin: "/projects", link: '#nesto-main a[href="/projects/project_a"]', ready: "#nesto-main h1" },
  { name: "Project → Units", role: "PROJECT_MANAGER", origin: "/projects/project_a", link: '#nesto-main a[href="/projects/project_a/units"]', ready: '#nesto-main [data-testid="unit-table"], #nesto-main table, #nesto-main [data-testid="unit-card"]' },
  { name: "Finance → Invoices", role: "FINANCE", origin: "/finance", link: '#nesto-main a[href="/finance/invoices"]', ready: '#nesto-main table, #nesto-main a[href^="/finance/invoices/invoice_"]' },
  { name: "Clients → client detail", role: "SALES", origin: "/clients/all", link: '#nesto-main a[href^="/clients/client_"]', ready: "#nesto-main h1" },
  { name: "Tasks → task detail", role: "PROJECT_MANAGER", origin: "/tasks/all", link: '#nesto-main a[href^="/tasks/task_"]', ready: "#nesto-main h1" },
];

type Sample = { feedback: number | null; committed: number | null; usable: number | null };

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

/** Clicks inside the page and times the three markers from that instant. */
async function measure(page: Page, link: string, ready: string): Promise<Sample> {
  return page.evaluate(
    ({ link, ready }) =>
      new Promise<{ feedback: number | null; committed: number | null; usable: number | null }>((resolve) => {
        const anchor = document.querySelector<HTMLAnchorElement>(link);
        if (!anchor) return resolve({ feedback: null, committed: null, usable: null });
        const startPath = location.pathname + location.search;
        const result = { feedback: null as number | null, committed: null as number | null, usable: null as number | null };
        const painted = (key: "feedback" | "usable", start: number) =>
          requestAnimationFrame(() => {
            if (result[key] === null) result[key] = performance.now() - start;
          });
        const feedbackSelector = '[data-testid="nav-pending-hint"], a[data-nav-pending], [data-testid="page-skeleton"]';
        let start = 0;
        const check = () => {
          if (result.feedback === null && document.querySelector(feedbackSelector)) painted("feedback", start);
          if (result.committed === null && location.pathname + location.search !== startPath) result.committed = performance.now() - start;
          if (result.usable === null && result.committed !== null && !document.querySelector('#nesto-main [data-testid="page-skeleton"]')) {
            if (Array.from(document.querySelectorAll<HTMLElement>(ready)).some((target) => target.offsetParent !== null)) {
              painted("feedback", start);
              painted("usable", start);
            }
          }
          if (result.usable !== null) {
            observer.disconnect();
            clearInterval(poll);
            clearTimeout(timeout);
            resolve(result);
          }
        };
        const observer = new MutationObserver(check);
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
        const poll = setInterval(check, 16);
        const timeout = setTimeout(() => {
          observer.disconnect();
          clearInterval(poll);
          resolve(result);
        }, 30_000);
        start = performance.now();
        anchor.click();
      }),
    { link, ready },
  );
}

function stats(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  if (!numbers.length) return { n: 0, median: null, p95: null };
  const at = (q: number) => numbers[Math.min(numbers.length - 1, Math.ceil(q * numbers.length) - 1)];
  return { n: numbers.length, median: Math.round(at(0.5)), p95: Math.round(at(0.95)) };
}

test.describe("NAV-01 benchmark", () => {
  test.skip(!ENABLED, "Set NAV_BENCH=1 to run the navigation benchmark.");
  test.setTimeout(60 * 60 * 1000);
  // A step that cannot happen fails the run instead of waiting out the hour.
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

  test(`transitions (${PROFILE})`, async ({ browser }, testInfo) => {
    const report: Record<string, unknown> = {};

    // Every sign-in gets a new browser context. A second sign-in in one tab fails against a
    // local http production build, whose HSTS and upgrade-insecure-requests move that tab's
    // requests to https; a new context also starts each role with an empty router cache.
    const opened: BrowserContext[] = [];
    const session = async (role: DemoRole, { to = "/dashboard", crawler = false } = {}) => {
      await opened.at(-1)?.close();
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: PROFILES[PROFILE].viewport });
      opened.push(context);
      const target = await context.newPage();
      if (crawler) {
        await target.addInitScript((agent) => {
          Object.defineProperty(Navigator.prototype, "userAgent", { get: () => agent });
        }, CRAWLER);
      }
      await signIn(target, role, { to });
      await throttle(target);
      return target;
    };

    const transitions = async (category: "warm" | "uncached") => {
      let prefetches = 0;
      let target: Page | null = null;
      let signedInAs: DemoRole | null = null;
      for (const scenario of SCENARIOS) {
        if (PROFILE === "mobile" && scenario.mobileSkip) continue;
        if (!target || signedInAs !== scenario.role) {
          target = await session(scenario.role, { crawler: category === "uncached" });
          target.on("request", (request) => {
            if (request.headers()["next-router-prefetch"]) prefetches += 1;
          });
          signedInAs = scenario.role;
        }
        const samples: Sample[] = [];
        const before = prefetches;
        for (let index = 0; index < SAMPLES; index += 1) {
          await target.goto(scenario.origin, { waitUntil: "load" });
          await target.locator(scenario.link).first().waitFor({ state: "attached", timeout: 30_000 });
          await target.waitForTimeout(400); // the link's default prefetch, when there is one
          samples.push(await measure(target, scenario.link, scenario.ready));
        }
        report[`${scenario.name} (${category})`] = {
          feedback_visible: stats(samples.map((sample) => sample.feedback)),
          route_committed: stats(samples.map((sample) => sample.committed)),
          content_usable: stats(samples.map((sample) => sample.usable)),
          prefetch_requests: prefetches - before,
        };
        progress(`${scenario.name} (${category})`);
      }
    };

    // NAV_BENCH_ONLY=documents: cold entry and workspace switching only (NAV-02 §16).
    let page: Page;
    if (!DOCUMENTS_ONLY) {
      await transitions("warm");
      await transitions("uncached");

      // Quick Create: cold open (no cache) and a cached reopen (§14.3 step 5).
      page = await session("PROJECT_MANAGER", { to: "/tasks" });
      const cold: Array<number | null> = [];
      const coldReady: Array<number | null> = [];
      const cached: Array<number | null> = [];
      let actionRequests = 0;
      page.on("request", (request) => {
        if (request.url().includes("/api/quick-create/actions")) actionRequests += 1;
      });
      for (let index = 0; index < SAMPLES; index += 1) {
        await page.goto("/tasks", { waitUntil: "load" });
        const button = page.getByTestId("quick-create-button");
        // The baseline shows its button only once its eagerly loaded menu has arrived.
        await button.waitFor({ state: "attached", timeout: 15_000 }).catch(() => undefined);
        if (!(await button.count())) break;
        const times = await page.evaluate(
          () =>
            new Promise<[number | null, number | null]>((resolve) => {
              const trigger = document.querySelector<HTMLElement>('[data-testid="quick-create-button"]')!;
              let visible: number | null = null;
              const start = performance.now();
              const check = () => {
                if (visible === null && document.querySelector('[data-testid="quick-create-panel"]')) visible = performance.now() - start;
                // Action rows carry `quick-create-<key>` (keys have dots) in both the baseline and this build.
                if (document.querySelector('[data-testid="quick-create-panel"] [data-testid^="quick-create-"][data-testid*="."], [data-testid="quick-create-empty"]')) {
                  clearInterval(poll);
                  resolve([visible, performance.now() - start]);
                }
              };
              const poll = setInterval(check, 8);
              trigger.click();
              setTimeout(() => {
                clearInterval(poll);
                resolve([visible, null]);
              }, 15_000);
            }),
        );
        cold.push(times[0]);
        coldReady.push(times[1]);
        await page.keyboard.press("Escape");
        const reopened = await page.evaluate(() => {
          const start = performance.now();
          document.querySelector<HTMLElement>('[data-testid="quick-create-button"]')!.click();
          return new Promise<number>((resolve) => requestAnimationFrame(() => resolve(performance.now() - start)));
        });
        cached.push(reopened);
        await page.keyboard.press("Escape");
      }
      report["Quick Create cold open"] = { quick_create_visible: stats(cold), quick_create_ready: stats(coldReady) };
      report["Quick Create cached reopen"] = { quick_create_visible: stats(cached), actions_requests_total: actionRequests };
      progress("Quick Create");

      // Group record → company record (§14.3 step 5). It switches the workspace, and this build then
      // loads the record as a new document, so it is timed from here rather than inside the page.
      const hop = { feedback: [] as Array<number | null>, committed: [] as Array<number | null>, usable: [] as Array<number | null>, landedOnRecord: 0 };
      page = await session("OWNER");
      for (let index = 0; index < SAMPLES; index += 1) {
        await page.request.post("/api/workspace", { data: { scopeType: "GROUP" } });
        await page.goto("/tasks/all", { waitUntil: "load" });
        // Visible only: on a phone the list's desktop table is in the page but hidden.
        const link = page.locator("#nesto-main a[data-company-id]:visible").first();
        await link.waitFor({ state: "attached", timeout: 15_000 }).catch(() => undefined);
        if (!(await link.count())) break;
        const record = (await link.getAttribute("href")) ?? "";
        await page.waitForTimeout(400);
        const started = Date.now();
        const feedback = page
          .waitForSelector('a[data-company-id][aria-busy="true"], [data-testid="nav-progress"]', { state: "attached", timeout: 30_000 })
          .then(() => Date.now() - started)
          .catch(() => null);
        await link.click();
        const committed = await page
          // The baseline reloads the list instead of landing, so a hop that has not landed in 5 s never will.
          .waitForURL((url) => url.pathname === record, { timeout: 5_000, waitUntil: "commit" })
          .then(() => Date.now() - started)
          .catch(() => null);
        const usable = committed === null
          ? null
          : await page.locator("#nesto-main h1").first().waitFor({ state: "visible", timeout: 30_000 }).then(() => Date.now() - started).catch(() => null);
        // A reload of the list after the commit is the failure this measures, so check where it ended.
        await page.waitForTimeout(1500);
        await page.waitForLoadState("load");
        const landed = new URL(page.url()).pathname === record;
        if (landed) hop.landedOnRecord += 1;
        hop.feedback.push(await feedback);
        hop.committed.push(landed ? committed : null);
        hop.usable.push(landed ? usable : null);
      }
      report["Group record → company record"] = {
        feedback_visible: stats(hop.feedback),
        route_committed: stats(hop.committed),
        content_usable: stats(hop.usable),
        landed_on_record: `${hop.landedOnRecord}/${hop.feedback.length}`,
      };
      progress("Group record → company record");
    }

    // Cold entry and workspace switching, reported apart (§3 "Limit", §14.3 step 8): a document
    // load waits for the parent layout, which is Phase 2's to shorten.
    const coldEntry: Record<string, Array<number | null>> = { "/dashboard": [], "/projects": [], "/finance/invoices": [] };
    // Time to first byte: nothing is sent before the (nesto) layout has resolved, so this is its wait.
    const firstByte: Record<string, Array<number | null>> = { "/dashboard": [], "/projects": [], "/finance/invoices": [] };
    page = await session("OWNER");
    for (let index = 0; index < SAMPLES; index += 1) {
      for (const path of Object.keys(coldEntry)) {
        const started = Date.now();
        await page.goto(path, { waitUntil: "commit" });
        await page.locator("#nesto-main h1").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
        coldEntry[path].push(Date.now() - started);
        firstByte[path].push(
          await page.evaluate(() => {
            const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
            return entry ? Math.round(entry.responseStart - entry.requestStart) : null;
          }),
        );
      }
    }
    for (const [path, values] of Object.entries(coldEntry)) report[`Cold entry ${path}`] = { content_usable: stats(values), first_byte: stats(firstByte[path]) };
    progress("Cold entry");

    const switches: Array<number | null> = [];
    const me = (await (await page.request.get("/api/workspaces")).json()) as { data: { companies: Array<{ id: string }> } };
    const companies = me.data.companies.map((company) => company.id).slice(0, 2);
    if (companies.length === 2) {
      for (let index = 0; index < SAMPLES; index += 1) {
        const started = Date.now();
        const response = await page.request.post("/api/workspace", { data: { scopeType: "COMPANY", companyId: companies[index % 2] } });
        await page.goto("/dashboard", { waitUntil: "commit" });
        await page.locator("#nesto-main h1").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
        switches.push(response.ok() ? Date.now() - started : null);
      }
    }
    report["Workspace switch → dashboard usable"] = { content_usable: stats(switches) };
    progress("Workspace switch");

    // The Group Owner profile (NAV-02 PERF-04 step 2): the Group view's navigation
    // needs the group's company contexts before the frame.
    const group = await page.request.post("/api/workspace", { data: { scopeType: "GROUP" } });
    if (group.ok()) {
      const groupEntry: Array<number | null> = [];
      const groupFirstByte: Array<number | null> = [];
      for (let index = 0; index < SAMPLES; index += 1) {
        const started = Date.now();
        await page.goto("/dashboard", { waitUntil: "commit" });
        await page.locator("#nesto-main h1").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
        groupEntry.push(Date.now() - started);
        groupFirstByte.push(
          await page.evaluate(() => {
            const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
            return entry ? Math.round(entry.responseStart - entry.requestStart) : null;
          }),
        );
      }
      report["Cold entry /dashboard (Group view)"] = { content_usable: stats(groupEntry), first_byte: stats(groupFirstByte) };
      progress("Group cold entry");
    }

    await opened.at(-1)?.close();

    const output = {
      label: LABEL,
      profile: PROFILE,
      conditions: PROFILES[PROFILE],
      samples: SAMPLES,
      commit: process.env.NAV_BENCH_COMMIT ?? null,
      browser: browser.version(),
      category: "transitions start on a document-loaded origin; warm = default prefetch arrived, uncached = no prefetch",
      report,
    };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `nav-benchmark-${LABEL}-${PROFILE}.json`), JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
    expect(Object.keys(report).length).toBeGreaterThan(0);
  });
});
