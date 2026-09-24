import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";

import { signIn, type DemoRole } from "../fixtures";

/**
 * NAV-02 server-load evidence (§16 PERF-03, PERF-04). Opt-in, production
 * builds only. `NAV_BENCH_LABEL` names the output, `NAV_BENCH_OUT` its directory.
 *
 * - `NAV_SLOT_ISOLATION=1`: a document load's time to usable content with and
 *   without 1.5 s added to the workspace chooser's read and to the banner's —
 *   the frame must not wait for either (target: at most 100 ms added). Needs a
 *   server started with NESTO_TEST_SHELL_DELAYS=1.
 * - `NAV_CONCURRENCY=1`: twenty people at once, each running the same mix of
 *   document loads and shell API calls; latency percentiles, server errors and
 *   refused connections, before and after on the same machine.
 */

const LABEL = process.env.NAV_BENCH_LABEL ?? "after";
const OUT = process.env.NAV_BENCH_OUT ?? join(process.cwd(), "test-results");
const SAMPLES = Number(process.env.NAV_BENCH_SAMPLES ?? 30);

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
  return { n: sorted.length, median: Math.round(at(0.5)), p95: Math.round(at(0.95)) };
}

function write(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}-${LABEL}.json`), JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data, null, 2));
}

test.describe("slot isolation (PERF-03)", () => {
  test.skip(process.env.NAV_SLOT_ISOLATION !== "1", "Set NAV_SLOT_ISOLATION=1 (and start the server with NESTO_TEST_SHELL_DELAYS=1).");
  test.setTimeout(20 * 60 * 1000);

  test("a slow chooser or banner adds nothing to a page's usable time", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    const origin = new URL(page.url()).origin;
    const cohorts: Record<string, string> = { none: "", slow_workspaces: "workspaces=1500", slow_banner: "banner=1500" };
    const report: Record<string, ReturnType<typeof stats>> = {};
    const samples: Record<string, number[]> = { none: [], slow_workspaces: [], slow_banner: [] };
    // Interleaved, so the three cohorts see the same machine.
    for (let index = 0; index < SAMPLES; index += 1) {
      for (const [cohort, rules] of Object.entries(cohorts)) {
        await page.context().clearCookies({ name: "nesto-test-shell-delay" });
        if (rules) await page.context().addCookies([{ name: "nesto-test-shell-delay", value: rules, url: origin }]);
        const started = Date.now();
        await page.goto("/tasks", { waitUntil: "commit" });
        await page.locator("#nesto-main h1").first().waitFor({ state: "visible" });
        samples[cohort].push(Date.now() - started);
        await page.waitForLoadState("load");
      }
    }
    for (const [cohort, values] of Object.entries(samples)) report[cohort] = stats(values);
    const added = { slow_workspaces: report.slow_workspaces.median - report.none.median, slow_banner: report.slow_banner.median - report.none.median };
    write("nav02-slot-isolation", { label: LABEL, samples: SAMPLES, page: "/tasks (document)", report, added_median_ms: added });
    expect(added.slow_workspaces).toBeLessThanOrEqual(100);
    expect(added.slow_banner).toBeLessThanOrEqual(100);
  });
});

test.describe("twenty people at once (PERF-04 step 5)", () => {
  test.skip(process.env.NAV_CONCURRENCY !== "1", "Set NAV_CONCURRENCY=1 to run the concurrency case.");
  test.setTimeout(20 * 60 * 1000);

  const ROLES: DemoRole[] = ["OWNER", "GROUP_IT", "HR", "CEO", "PROJECT_MANAGER", "ARCHITECT", "ENGINEER", "FINANCE", "LEGAL", "SALES", "PROCUREMENT", "INVENTORY", "QAQC", "HSE", "VIEWER", "SALES_HEAD", "ARCHITECTURE_HEAD", "CEO_B", "ENGINEER_C", "MULTI_COMPANY"];
  // Requests both builds serve: document loads, the shell's lists and the bell.
  const SCRIPT = ["/dashboard", "/api/workspaces", "/tasks", "/api/activity-center/unread-count", "/projects", "/api/search/home", "/finance", "/api/quick-create/actions?pathname=%2Fdashboard"];
  const ROUNDS = Number(process.env.NAV_CONCURRENCY_ROUNDS ?? 5);

  async function session(browser: Browser, role: DemoRole): Promise<APIRequestContext> {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const page = await context.newPage();
    await signIn(page, role, { to: "/dashboard" });
    return context.request;
  }

  test("the same mix for twenty signed-in people, all at once", async ({ browser }) => {
    const people: APIRequestContext[] = [];
    for (const role of ROLES) people.push(await session(browser, role));
    const durations: Record<string, number[]> = {};
    const statuses: Record<string, number> = {};
    const started = Date.now();
    await Promise.all(
      people.map(async (request) => {
        for (let round = 0; round < ROUNDS; round += 1) {
          for (const path of SCRIPT) {
            const begun = performance.now();
            const response = await request.get(path, { maxRedirects: 0, failOnStatusCode: false });
            (durations[path] ??= []).push(performance.now() - begun);
            const bucket = response.status() >= 500 ? "5xx" : response.status() >= 400 ? `${response.status()}` : "ok";
            statuses[bucket] = (statuses[bucket] ?? 0) + 1;
          }
        }
      }),
    );
    const report = Object.fromEntries(Object.entries(durations).map(([path, values]) => [path, stats(values)]));
    write("nav02-concurrency", { label: LABEL, people: people.length, rounds: ROUNDS, wall_ms: Date.now() - started, statuses, report });
    expect(statuses["5xx"] ?? 0).toBe(0);
  });
});
