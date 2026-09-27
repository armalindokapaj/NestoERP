import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { db } from "../db";
import { signIn, type DemoRole } from "../fixtures";
import { AUD07_ROUTES, type AudRoute } from "./aud07-manifest";

/**
 * AUD-07 benchmark (§3, §4, PS-01..PS-04, PS-06). Opt-in, production builds only:
 *
 *   AUD07_BENCH=1 AUD07_LABEL=<label> AUD07_PROFILE=desktop|mobile \
 *   E2E_BASE_URL=http://127.0.0.1:3100 AUD07_OUT=<dir> \
 *   npx playwright test tests/e2e/perf/aud07-baseline.spec.ts --project=chromium
 *
 * `E2E_BASE_URL` points it at any running server — the 324a3ca9 worktree's
 * build or HEAD's — so both are measured by the same instrument; it also stops
 * playwright.config.ts from starting a server of its own. `AUD07_BASE_URL`
 * overrides the address for this spec alone. `DATABASE_URL` should name that server's database: it
 * is read once, for the cohort's row counts, and a failure to read it is
 * recorded rather than fatal.
 *
 * `AUD07_SERVER_LOG=<file>`, with the server started with
 * `NESTO_PERF_SQL_COUNT=1` and its stdout in that file, adds exact
 * request-correlated SQL counts per attempt (PS-04): every attempt sends a
 * probe header, and the server's `perf.sql.request` lines are matched to it
 * afterwards. Counting costs time, so run it as its own pass (few samples),
 * never in the timing pass.
 *
 * `AUD07_DISCOVER=1` instead loads each manifest route once and reports its
 * readiness — the manifest checked before anything is timed.
 *
 * Three categories, never averaged together (§3):
 * - cold: a document load of the route (browser-cold entry, warm server);
 * - warm: a click on the in-app link after its default prefetch arrived —
 *   each attempt records whether the destination was prefetched;
 * - uncached: the same click with prefetch off (a crawler user agent, for
 *   which Next prefetches nothing) — each attempt records that it was not.
 * Warm and uncached run on both profiles: on a phone the sidebar link is in
 * the navigation drawer, which is opened before the measured click.
 *
 * Every attempt is kept, failures included: a sample that never became usable
 * in 30 s is recorded as null with what it was still waiting for, and counted
 * as a failure, not dropped. Usable is the manifest's definition, not a heading.
 */
const ENABLED = process.env.AUD07_BENCH === "1" || process.env.AUD07_DISCOVER === "1";
const DISCOVER = process.env.AUD07_DISCOVER === "1";
const LABEL = process.env.AUD07_LABEL ?? "baseline";
const PROFILE = (process.env.AUD07_PROFILE ?? "desktop") as "desktop" | "mobile";
const SAMPLES = Number(process.env.AUD07_SAMPLES ?? 30);
const WARMUP = Number(process.env.AUD07_WARMUP ?? 5);
const OTHER_SAMPLES = Number(process.env.AUD07_OTHER_SAMPLES ?? 10);
const ONLY = process.env.AUD07_ONLY?.split(",");
const MODES = (process.env.AUD07_MODES ?? "cold,warm,uncached").split(",");
const OUT = process.env.AUD07_OUT ?? join(process.cwd(), "test-results", "aud07");
const BASE_URL = process.env.AUD07_BASE_URL;
const SERVER_LOG = process.env.AUD07_SERVER_LOG;
const CRAWLER = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const PROBE_HEADER = "x-nesto-perf-probe";
/** The label as it travels in a probe: the server accepts letters, digits, "-", "_", ":", "#" and ".", and "." separates the parts. */
const PROBE_LABEL = LABEL.replace(/[^A-Za-z0-9_-]/g, "-");
const TIMEOUT_MS = 30_000;

// The NAV-01 profiles (§3): desktop 100 ms, 10/5 Mbps, normal CPU; phone 150 ms, 4/1 Mbps, 4× CPU.
const PROFILES = {
  desktop: { viewport: { width: 1440, height: 900 }, latency: 100, down: 10, up: 5, cpu: 1 },
  mobile: { viewport: { width: 390, height: 844 }, latency: 150, down: 4, up: 1, cpu: 4 },
} as const;

type Attempt = {
  usable: number | null;
  firstByte?: number | null;
  /** What the page was still waiting for when the attempt timed out. */
  blocker?: string;
  documentLoad?: boolean;
  /** Warm/uncached: whether the destination's prefetch request was sent before the click. */
  prefetched?: boolean;
  error?: string;
};

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

type Readiness = { usable: number | null; blocker?: string; records?: number };

/**
 * Resolves, in the page, when the route is usable (§4), timed from `start`
 * (the navigation's start, or now). Usable: the route's own path; `#nesto-main`
 * present with no skeleton or busy region; `min` records visible, hydrated and
 * not marked stale; the control, when there is one, visible, enabled and
 * hydrated. Hydrated means React has attached the element's props, so its
 * handlers are live: server HTML that cannot yet be clicked is not usable.
 * Waits for the document itself: before `documentElement` exists it polls.
 */
function usableIn(page: Page, route: AudRoute, start: "navigation" | "now") {
  return page.evaluate(
    ({ records, min, control, path, start, timeout }) =>
      new Promise<Readiness>((resolve) => {
        const origin = start === "navigation" ? 0 : performance.now();
        let blocker = "not checked";
        let seen = 0;
        const hydrated = (element: Element) => Object.keys(element).some((key) => key.startsWith("__reactProps$"));
        const visible = (element: HTMLElement) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
        const fail = (reason: string) => {
          blocker = reason;
          return false;
        };
        const ready = () => {
          if (location.pathname !== path.split("?")[0]) return fail(`at ${location.pathname}`);
          const main = document.querySelector("#nesto-main");
          if (!main) return fail("no #nesto-main");
          if (main.querySelector('[data-testid="page-skeleton"], [aria-busy="true"]')) return fail("skeleton or busy region");
          const shown = Array.from(document.querySelectorAll<HTMLElement>(records)).filter((element) => !element.closest("[data-aud07-stale]") && visible(element));
          const live = shown.filter((element) => hydrated(element) && !element.closest("[inert]") && element.getAttribute("aria-disabled") !== "true");
          seen = live.length;
          if (live.length < min) return fail(`records ${live.length}/${min} usable, ${shown.length} visible`);
          if (control) {
            const input = document.querySelector<HTMLInputElement>(control);
            if (!input || !visible(input) || input.disabled || !hydrated(input)) return fail("primary control not usable");
          }
          return true;
        };
        let observer: MutationObserver | null = null;
        let settled = false;
        const finish = (value: Readiness) => {
          observer?.disconnect();
          clearInterval(poll);
          clearTimeout(timer);
          resolve(value);
        };
        const check = () => {
          if (settled) return;
          // A document still being replaced has no root yet: poll until it has one.
          if (!observer && document.documentElement) {
            try {
              observer = new MutationObserver(check);
              observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
            } catch {
              observer = null;
            }
          }
          if (ready()) {
            settled = true;
            requestAnimationFrame(() => finish({ usable: performance.now() - origin, records: seen }));
          }
        };
        const poll = setInterval(check, 16);
        const timer = setTimeout(() => {
          settled = true;
          finish({ usable: null, blocker, records: seen });
        }, timeout);
        check();
      }),
    { records: route.records, min: route.min, control: route.control ?? null, path: route.path, start, timeout: TIMEOUT_MS },
  );
}

/** Marks what the origin page already shows, so a leftover record never counts for the destination. */
function markStale(page: Page, route: AudRoute) {
  return page.evaluate((records) => {
    for (const element of Array.from(document.querySelectorAll(records))) element.setAttribute("data-aud07-stale", "");
  }, route.records);
}

function summarise(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  const at = (q: number) => (numbers.length ? Math.round(numbers[Math.min(numbers.length - 1, Math.ceil(q * numbers.length) - 1)]!) : null);
  return { attempts: values.length, successes: numbers.length, failures: values.length - numbers.length, failureRate: values.length ? Math.round(((values.length - numbers.length) / values.length) * 1000) / 1000 : null, median: at(0.5), p95: at(0.95), max: numbers.length ? Math.round(numbers.at(-1)!) : null };
}

async function cohortCounts() {
  try {
    const [groups, companies, users, projects, units, tasks, invoices, expenses, pendingFinanceApprovals, documents, dailyLogs, meetings, clients] = await Promise.all([
      db.parentGroup.count(),
      db.company.count(),
      db.user.count(),
      db.project.count(),
      db.projectUnit.count(),
      db.task.count(),
      db.invoice.count(),
      db.expense.count(),
      db.financeApproval.count({ where: { status: "PENDING" } }),
      db.document.count(),
      db.dailyLog.count(),
      db.meeting.count(),
      db.client.count(),
    ]);
    return { groups, companies, users, projects, units, tasks, invoices, expenses, pendingFinanceApprovals, documents, dailyLogs, meetings, clients };
  } catch (error) {
    return { error: (error as Error).message.split("\n")[0] };
  }
}

type SqlLine = { event: string; probe: string | null; kind: string; statements: number; operations: number; ambiguous: number; statementMs: number; rows: number };

/** The server's `perf.sql.request` lines for this run's probes, per scenario and attempt (PS-04). */
function sqlByScenario(file: string, measuredFrom: number) {
  if (!existsSync(file)) return { error: `no server log at ${file}` };
  const lines: SqlLine[] = [];
  for (const text of readFileSync(file, "utf8").split("\n")) {
    const at = text.indexOf("{");
    if (at < 0 || !text.includes("perf.sql.request")) continue;
    try {
      const line = JSON.parse(text.slice(at)) as SqlLine;
      if (line.event === "perf.sql.request" && line.probe?.startsWith(`${PROBE_LABEL}.`)) lines.push(line);
    } catch {
      // Not one of ours.
    }
  }
  const attempts = new Map<string, Map<number, SqlLine[]>>();
  for (const line of lines) {
    const [, scenario, category, index] = line.probe!.split(".");
    if (Number(index) < measuredFrom) continue; // warm-ups
    const key = `${scenario} ${category}`;
    const byAttempt = attempts.get(key) ?? new Map<number, SqlLine[]>();
    byAttempt.set(Number(index), [...(byAttempt.get(Number(index)) ?? []), line]);
    attempts.set(key, byAttempt);
  }
  const result: Record<string, unknown> = {};
  for (const [key, byAttempt] of attempts) {
    const all = [...byAttempt.values()];
    const total = (pick: (line: SqlLine) => boolean) => all.map((group) => group.filter(pick).reduce((sum, line) => sum + line.statements, 0));
    result[key] = {
      evidence: "exact, request-correlated (NESTO_PERF_SQL_COUNT)",
      attempts: all.length,
      primaryStatements: summarise(total((line) => line.kind !== "prefetch")),
      prefetchStatements: summarise(total((line) => line.kind === "prefetch")),
      operations: summarise(all.map((group) => group.filter((line) => line.kind !== "prefetch").reduce((sum, line) => sum + line.operations, 0))),
      statementMs: summarise(all.map((group) => group.filter((line) => line.kind !== "prefetch").reduce((sum, line) => sum + line.statementMs, 0))),
      requestsByKind: Object.fromEntries([...new Set(all.flat().map((line) => line.kind))].map((kind) => [kind, all.flat().filter((line) => line.kind === kind).length])),
      ambiguousStatements: all.flat().reduce((sum, line) => sum + line.ambiguous, 0),
    };
  }
  return result;
}

test.describe("AUD-07 benchmark", () => {
  test.skip(!ENABLED, "Set AUD07_BENCH=1 (or AUD07_DISCOVER=1) to run the AUD-07 benchmark.");
  test.setTimeout(6 * 60 * 60 * 1000);
  test.use({ actionTimeout: 15_000, navigationTimeout: TIMEOUT_MS });

  test(`${DISCOVER ? "discover" : "measure"} (${PROFILE})`, async ({ browser, browserName }, testInfo) => {
    const baseURL = BASE_URL ?? testInfo.project.use.baseURL;
    const routes = AUD07_ROUTES.filter((route) => !ONLY || ONLY.includes(route.id));
    const opened: BrowserContext[] = [];
    // One context per sign-in: a local http production build moves a second
    // sign-in in one tab to https (see navigation-benchmark.spec.ts).
    const session = async (b: Browser, route: Pick<AudRoute, "role" | "scope">, crawler = false) => {
      await opened.at(-1)?.close();
      const context = await b.newContext({ baseURL, viewport: PROFILES[PROFILE].viewport });
      opened.push(context);
      const page = await context.newPage();
      if (crawler) {
        await page.addInitScript((agent) => Object.defineProperty(Navigator.prototype, "userAgent", { get: () => agent }), CRAWLER);
      }
      await signIn(page, route.role as DemoRole, route.scope === "GROUP" ? { workspace: "GROUP" } : {});
      if (!DISCOVER) await throttle(page);
      return page;
    };
    const probe = async (page: Page, route: AudRoute, category: string, index: number) => {
      if (SERVER_LOG) await page.setExtraHTTPHeaders({ [PROBE_HEADER]: `${PROBE_LABEL}.${route.id}.${category}.${index}` });
    };

    if (DISCOVER) {
      const found: Record<string, Readiness | { error: string }> = {};
      for (const route of routes) {
        const page = await session(browser, route);
        await page.goto(route.path, { waitUntil: "commit" });
        found[route.id] = await usableIn(page, route, "navigation").catch((error: Error) => ({ error: error.message.split("\n")[0]! }));
        console.log(`[aud07 discover] ${route.id} ${route.path} as ${route.role}/${route.scope}: ${JSON.stringify(found[route.id])}`);
      }
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `discover-${PROFILE}.json`), JSON.stringify(found, null, 2));
      for (const route of routes) expect.soft((found[route.id] as Readiness).usable ?? null, `${route.id}: ${JSON.stringify(found[route.id])}`).not.toBeNull();
      return;
    }

    const report: Record<string, unknown> = {};
    const progress = (step: string) => console.log(`[aud07 ${LABEL}-${PROFILE}] ${new Date().toISOString().slice(11, 19)} ${step}`);

    // Cold: a document load of the route, timed from navigation start.
    if (MODES.includes("cold")) {
      for (const route of routes) {
        const page = await session(browser, route);
        const attempts: Attempt[] = [];
        const total = WARMUP + (route.core ? SAMPLES : OTHER_SAMPLES);
        for (let index = 0; index < total; index += 1) {
          let attempt: Attempt;
          try {
            await probe(page, route, "cold", index);
            await page.goto(route.path, { waitUntil: "commit" });
            const ready = await usableIn(page, route, "navigation");
            const firstByte = await page.evaluate(() => {
              const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
              return entry ? Math.round(entry.responseStart - entry.requestStart) : null;
            });
            attempt = { usable: ready.usable, firstByte, ...(ready.blocker ? { blocker: ready.blocker } : {}) };
          } catch (error) {
            attempt = { usable: null, error: (error as Error).message.split("\n")[0] };
          }
          if (index >= WARMUP) attempts.push(attempt);
        }
        report[`${route.id} cold`] = { route: route.path, role: route.role, scope: route.scope, ...summarise(attempts.map((a) => a.usable)), firstByte: summarise(attempts.map((a) => a.firstByte ?? null)), raw: attempts };
        progress(`${route.id} cold`);
      }
    }

    // Warm and uncached in-app navigation, from another page, on both profiles.
    for (const category of (["warm", "uncached"] as const).filter((mode) => MODES.includes(mode))) {
      for (const route of routes.filter((candidate) => candidate.core && candidate.link && candidate.origin)) {
        const page = await session(browser, route, category === "uncached");
        let destinationPrefetches = 0;
        let prefetches = 0;
        page.on("request", (request) => {
          if (!request.headers()["next-router-prefetch"]) return;
          prefetches += 1;
          if (new URL(request.url()).pathname === route.path.split("?")[0]) destinationPrefetches += 1;
        });
        const attempts: Attempt[] = [];
        for (let index = 0; index < WARMUP + SAMPLES; index += 1) {
          let attempt: Attempt;
          try {
            await probe(page, route, category, index);
            destinationPrefetches = 0;
            await page.goto(route.origin!, { waitUntil: "load" });
            // On a phone a sidebar entry lives in the drawer: open it first, outside the measurement.
            if (PROFILE === "mobile" && route.link!.startsWith("nav ")) {
              await page.getByRole("button", { name: /open navigation|hap navigimin/i }).click();
            }
            const link = page.locator(route.link!).filter({ visible: true }).first();
            await link.waitFor({ state: "visible", timeout: 15_000 });
            await link.hover();
            await page.waitForTimeout(400); // the link's default prefetch, when there is one
            const prefetched = destinationPrefetches > 0;
            await markStale(page, route);
            const pending = usableIn(page, route, "now");
            await link.click();
            // A client navigation keeps the page's clock. A document load
            // replaces it; that attempt is then timed from its own start and flagged.
            let documentLoad = false;
            const ready = await pending.catch(() => {
              documentLoad = true;
              return usableIn(page, route, "navigation");
            });
            attempt = { usable: ready.usable, documentLoad, prefetched, ...(ready.blocker ? { blocker: ready.blocker } : {}) };
          } catch (error) {
            attempt = { usable: null, error: (error as Error).message.split("\n")[0] };
          }
          if (index >= WARMUP) attempts.push(attempt);
        }
        // §3: warm must really have prefetched and uncached must not have. A mismatched
        // attempt is kept and counted, never dropped or silently re-labelled.
        const mismatched = attempts.filter((attempt) => attempt.prefetched !== undefined && attempt.prefetched !== (category === "warm")).length;
        report[`${route.id} ${category}`] = {
          route: route.path,
          from: route.origin,
          via: route.link,
          ...summarise(attempts.map((a) => a.usable)),
          prefetchRequests: prefetches,
          modeVerified: mismatched === 0,
          attemptsNotMatchingMode: mismatched,
          documentLoads: attempts.filter((attempt) => attempt.documentLoad).length,
          raw: attempts,
        };
        progress(`${route.id} ${category} (prefetches ${prefetches}, attempts not matching the mode ${mismatched})`);
      }
    }

    await opened.at(-1)?.close();
    // The build measured, not the working tree: the tree may already hold later work.
    const commit = process.env.AUD07_BUILD_COMMIT ?? execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const dirty = process.env.AUD07_BUILD_COMMIT ? false : execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    if (SERVER_LOG) await new Promise((resolve) => setTimeout(resolve, 1_500)); // the server writes a scope's line once it is quiet
    mkdirSync(OUT, { recursive: true });
    const file = join(OUT, `aud07-${LABEL}-${PROFILE}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          label: LABEL,
          profile: { name: PROFILE, ...PROFILES[PROFILE], throttling: "Chrome DevTools Protocol (Network.emulateNetworkConditions, Emulation.setCPUThrottlingRate)" },
          samples: SAMPLES,
          warmup: WARMUP,
          otherSamples: OTHER_SAMPLES,
          modes: MODES,
          timeoutMs: TIMEOUT_MS,
          readiness: "route path + no skeleton/busy + min records visible, hydrated, not from the origin page + primary control usable (AUD-07 §4)",
          commit,
          workingTreeDirty: dirty,
          browser: `${browserName} ${browser.version()}`,
          machine: { platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cores: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30), node: process.version },
          baseURL,
          database: (process.env.DATABASE_URL ?? "").replace(/\/\/[^@]*@/, "//").replace(/\?.*$/, ""),
          cohort: process.env.AUD07_COHORT ?? "D1",
          counts: await cohortCounts(),
          sql: SERVER_LOG ? sqlByScenario(SERVER_LOG, WARMUP) : "not measured (set AUD07_SERVER_LOG with a NESTO_PERF_SQL_COUNT=1 server)",
          at: new Date().toISOString(),
          results: report,
        },
        null,
        2,
      ),
    );
    progress(`written ${file}`);
  });
});
