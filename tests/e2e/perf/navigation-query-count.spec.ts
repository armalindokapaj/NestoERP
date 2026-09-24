import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { test, type Page } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * NAV-01 query-count evidence (§17 items 4 and 5). Opt-in: `NAV_QUERY_COUNT=1`,
 * with `DATABASE_URL` naming the isolated database the server under test uses
 * and nothing else using it. `NAV_BENCH_LABEL` names the output,
 * `NAV_BENCH_OUT` its directory.
 *
 * Statements are counted as Postgres transaction commits for the whole
 * database: each statement Prisma sends outside a transaction commits on its
 * own. A backend reports its counts up to 10 s after it goes idle, so every
 * window has 11 s of quiet on each side.
 */

const ENABLED = process.env.NAV_QUERY_COUNT === "1";
const LABEL = process.env.NAV_BENCH_LABEL ?? "after";
const OUT = process.env.NAV_BENCH_OUT ?? join(process.cwd(), "test-results");
const QUIET = 11_000;
const CRAWLER = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const database = (process.env.DATABASE_URL ?? "").replace(/\?.*$/, "");
const commits = () =>
  Number(execSync(`psql "${database}" -Atc "select xact_commit from pg_stat_database where datname = current_database()"`).toString().trim());
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Statements committed while `work` runs, less this reader's own. */
async function statements(work: () => Promise<void>) {
  await settle(QUIET);
  const before = commits();
  await work();
  await settle(QUIET);
  return commits() - before - 1;
}

test.describe("NAV-01 query count", () => {
  test.skip(!ENABLED, "Set NAV_QUERY_COUNT=1 to count statements.");
  test.setTimeout(15 * 60 * 1000);

  test("the shell summary, a dashboard load, its prefetches and ten navigations", async ({ page, context }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await page.goto("about:blank");

    // The shell's workspace list, which carries + Create's summary, with no page running beside it.
    const perWorkspacesCall: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      perWorkspacesCall.push(
        (await statements(async () => {
          for (let call = 0; call < 20; call += 1) await page.request.get("/api/workspaces");
        })) / 20,
      );
    }

    // A /dashboard document load with the router's prefetching off (it skips crawlers) and on.
    const dashboardLoad = async (target: Page) => {
      const counts: number[] = [];
      const prefetchCounts: number[] = [];
      let prefetches = 0;
      target.on("request", (request) => {
        if (request.headers()["next-router-prefetch"]) prefetches += 1;
      });
      for (let round = 0; round < 3; round += 1) {
        await target.goto("about:blank");
        prefetches = 0;
        counts.push(
          await statements(async () => {
            await target.goto("/dashboard", { waitUntil: "load" });
            await settle(4000);
          }),
        );
        prefetchCounts.push(prefetches);
      }
      return { statements: median(counts), prefetches: median(prefetchCounts), rounds: counts };
    };
    const crawler = await context.newPage();
    await crawler.addInitScript((agent) => {
      Object.defineProperty(Navigator.prototype, "userAgent", { get: () => agent });
    }, CRAWLER);
    const withoutPrefetch = await dashboardLoad(crawler);
    await crawler.close();
    const withPrefetch = await dashboardLoad(page);

    // Ten sidebar navigations with + Create closed.
    await page.goto("/dashboard", { waitUntil: "load" });
    const requests = { quickCreate: 0, prefetch: 0, navigation: 0, document: 0 };
    page.on("request", (request) => {
      const headers = request.headers();
      if (request.url().includes("/api/quick-create/")) requests.quickCreate += 1;
      if (headers["next-router-prefetch"]) requests.prefetch += 1;
      else if (headers.rsc === "1") requests.navigation += 1;
      if (request.resourceType() === "document") requests.document += 1;
    });
    await settle(4000);
    Object.assign(requests, { quickCreate: 0, prefetch: 0, navigation: 0, document: 0 });
    const route = ["/tasks", "/projects", "/meetings", "/documents", "/clients", "/calendar", "/approvals", "/finance", "/hr", "/dashboard"];
    const navigations = await statements(async () => {
      for (const href of route) {
        await page.locator(`nav[aria-label="Main navigation"] a[href="${href}"]`).first().click();
        await page.waitForURL((url) => url.pathname === href, { timeout: 30_000 });
        await page.locator("#nesto-main h1").first().waitFor({ state: "visible", timeout: 30_000 });
        await settle(1000);
      }
    });

    const output = {
      label: LABEL,
      statements_per_workspaces_call: { median: median(perWorkspacesCall), rounds: perWorkspacesCall },
      dashboard_load_without_prefetch: withoutPrefetch,
      dashboard_load_with_prefetch: withPrefetch,
      statements_per_prefetch: withPrefetch.prefetches
        ? Math.round(((withPrefetch.statements - withoutPrefetch.statements) / withPrefetch.prefetches) * 10) / 10
        : null,
      ten_navigations: { statements: navigations, requests },
    };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `nav-query-count-${LABEL}.json`), JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
  });
});
