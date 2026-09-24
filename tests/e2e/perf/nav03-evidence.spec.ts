import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type Request } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * NAV-03 evidence (§13 PERF-01, §18.3 items 1 and 4). Opt-in, production builds
 * only, run unchanged against the baseline and the NAV-03 build.
 * `NAV_BENCH_LABEL` names the output, `NAV_BENCH_OUT` its directory.
 *
 * - `NAV03_CHUNKS=1`: JavaScript transferred by a /dashboard document load with
 *   every panel closed and no intent, then what each panel adds when opened.
 * - `NAV03_ACTIVITY=1`: the bell's requests over ten visible minutes with the
 *   panel closed, and over five hidden minutes (real time; about 16 minutes).
 */

const LABEL = process.env.NAV_BENCH_LABEL ?? "after";
const OUT = process.env.NAV_BENCH_OUT ?? join(process.cwd(), "test-results");

function write(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}-${LABEL}.json`), JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data, null, 2));
}

type Script = { url: string; transfer: number; decoded: number };

/** Every script the document has fetched so far, from resource timing. */
async function scripts(page: Page): Promise<Script[]> {
  return page.evaluate(() =>
    (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .filter((entry) => entry.initiatorType === "script" || /\.js(\?|$)/.test(entry.name))
      .map((entry) => ({ url: new URL(entry.name).pathname, transfer: entry.transferSize, decoded: entry.decodedBodySize })),
  );
}

const sum = (list: Script[], key: "transfer" | "decoded") => list.reduce((total, item) => total + item[key], 0);

test.describe("panel code (P01, PERF-02)", () => {
  test.skip(process.env.NAV03_CHUNKS !== "1", "Set NAV03_CHUNKS=1 to inventory panel code.");
  test.setTimeout(5 * 60 * 1000);

  test("initial JavaScript with panels closed, then each panel's increment", async ({ page, browser }) => {
    await signIn(page, "OWNER", { to: "/tasks" });
    // A fresh context with the same session and an empty HTTP cache: a cold document load.
    const storage = await page.context().storageState();
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: storage, viewport: { width: 1440, height: 900 } });
    const cold = await context.newPage();
    await cold.goto("/dashboard", { waitUntil: "load" });
    await cold.waitForTimeout(1500);
    const initial = await scripts(cold);
    const seen = new Set(initial.map((item) => item.url));
    const steps: Array<{ panel: string; added: Script[] }> = [];
    const opened = async (panel: string, open: () => Promise<void>) => {
      await open();
      await cold.waitForTimeout(1500);
      const now = await scripts(cold);
      const added = now.filter((item) => !seen.has(item.url));
      added.forEach((item) => seen.add(item.url));
      steps.push({ panel, added });
      await cold.keyboard.press("Escape");
      await cold.waitForTimeout(300);
    };
    await opened("search", async () => cold.keyboard.press("Control+k"));
    await opened("quick_create", async () => cold.getByTestId("quick-create-button").click());
    await opened("activity", async () => cold.getByTestId("notification-bell").click());
    await opened("workspace", async () => cold.getByTestId("workspace-switcher").click());
    write("nav03-chunks", {
      label: LABEL,
      page: "/dashboard (document, panels closed, no intent)",
      initial: { files: initial.length, transfer: sum(initial, "transfer"), decoded: sum(initial, "decoded") },
      panels: steps.map((step) => ({ panel: step.panel, files: step.added.length, transfer: sum(step.added, "transfer"), decoded: sum(step.added, "decoded") })),
      all_panels_cumulative: { transfer: sum(initial, "transfer") + steps.reduce((total, step) => total + sum(step.added, "transfer"), 0) },
    });
    await context.close();
  });
});

test.describe("Activity requests (A01, A02)", () => {
  test.skip(process.env.NAV03_ACTIVITY !== "1", "Set NAV03_ACTIVITY=1 for the sixteen-minute Activity trace.");
  test.setTimeout(20 * 60 * 1000);

  test("ten visible minutes closed, then five hidden", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    const log: Array<{ at: number; kind: "count" | "list"; phase: string }> = [];
    let phase = "visible";
    const started = Date.now();
    page.on("request", (request: Request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/activity-center/unread-count") log.push({ at: Date.now() - started, kind: "count", phase });
      else if (path === "/api/activity-center") log.push({ at: Date.now() - started, kind: "list", phase });
    });
    await page.goto("/tasks");
    await expect(page.getByTestId("notification-bell")).toBeVisible();
    await page.waitForTimeout(10 * 60 * 1000);
    phase = "hidden";
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("blur"));
    });
    await page.waitForTimeout(5 * 60 * 1000);
    const count = (kind: "count" | "list", which: string) => log.filter((entry) => entry.kind === kind && entry.phase === which).length;
    write("nav03-activity", {
      label: LABEL,
      role: "PROJECT_MANAGER",
      visible_10min: { count: count("count", "visible"), list: count("list", "visible") },
      hidden_5min: { count: count("count", "hidden"), list: count("list", "hidden") },
      log,
    });
  });
});
