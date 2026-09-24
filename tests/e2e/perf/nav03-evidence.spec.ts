import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type Request } from "@playwright/test";

import { signIn, type DemoRole } from "../fixtures";

/**
 * NAV-03 evidence (§13 PERF-01, §18.3 items 1 and 4). Opt-in, production builds
 * only, run unchanged against the baseline and the NAV-03 build.
 * `NAV_BENCH_LABEL` names the output, `NAV_BENCH_OUT` its directory.
 *
 * - `NAV03_CHUNKS=1`: JavaScript transferred by a /dashboard document load with
 *   every panel closed and no intent, then what each panel adds when opened.
 * - `NAV03_ACTIVITY=1`: the bell's requests over ten visible minutes with the
 *   panel closed, and over five hidden minutes (real time; about 16 minutes).
 * - `NAV03_SIDE_EFFECTS=1` (F07): hovering the five approved destinations long
 *   enough to prepare each writes nothing, against an idle control window.
 * - `NAV03_PREFETCH_LOAD=1` (PERF-02 prefetch server load): statements for a
 *   fixed mixed script of navigations and abandoned intents.
 * - `NAV03_STREAMING=1` (S01): Tasks' primary section with and without 1.5 s
 *   held on its optional counters. Needs NESTO_TEST_SHELL_DELAYS=1.
 * - `NAV03_PAGE_QUERIES=1` (PERF-01 page queries, S12): statements per
 *   document load of each streamed page, with the router's prefetching off.
 * - `NAV03_TELEMETRY=1` (T07, T10): a sampled browser's batches reach the
 *   protected scrape. Needs NESTO_NAV_TELEMETRY_SAMPLE=1 and `METRICS_TOKEN`.
 *
 * The database checks read Postgres' own statistics for the database in
 * `DATABASE_URL`, which the server under test must use with nothing else
 * running against it. A backend reports its counts up to 10 s after it goes
 * idle, so every window has 11 s of quiet on each side (as NAV-01's count).
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
    await opened("workspace", async () => cold.getByTestId("sidebar-header").getByTestId("organization-header").click());
    write("nav03-chunks", {
      label: LABEL,
      page: "/dashboard (document, panels closed, no intent)",
      initial: { files: initial.length, transfer: sum(initial, "transfer"), decoded: sum(initial, "decoded") },
      initial_files: initial.map((item) => ({ url: item.url, transfer: item.transfer, decoded: item.decoded })),
      panels: steps.map((step) => ({ panel: step.panel, files: step.added.length, transfer: sum(step.added, "transfer"), decoded: sum(step.added, "decoded") })),
      all_panels_cumulative: { transfer: sum(initial, "transfer") + steps.reduce((total, step) => total + sum(step.added, "transfer"), 0) },
    });
    await context.close();
  });
});

test.describe("initial JavaScript per required page (PERF-02)", () => {
  test.skip(process.env.NAV03_CHUNKS !== "1", "Set NAV03_CHUNKS=1 to inventory page code.");
  test.setTimeout(5 * 60 * 1000);

  test("each streamed page's cold document load, panels closed, no intent", async ({ page, browser }) => {
    await signIn(page, "OWNER", { to: "/tasks" });
    const storage = await page.context().storageState();
    const pages: Record<string, { files: number; transfer: number; decoded: number }> = {};
    for (const path of ["/dashboard", "/clients", "/tasks", "/finance", "/projects/project_a"]) {
      // A fresh context each time: an empty HTTP cache, the same session.
      const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: storage, viewport: { width: 1440, height: 900 } });
      const cold = await context.newPage();
      await cold.goto(path, { waitUntil: "load" });
      await cold.waitForTimeout(1500);
      const loaded = await scripts(cold);
      pages[path] = { files: loaded.length, transfer: sum(loaded, "transfer"), decoded: sum(loaded, "decoded") };
      await context.close();
    }
    write("nav03-page-chunks", { label: LABEL, pages });
  });
});

test.describe("Activity requests (A01, A02)", () => {
  test.skip(process.env.NAV03_ACTIVITY !== "1", "Set NAV03_ACTIVITY=1 for the sixteen-minute Activity trace.");
  test.setTimeout(20 * 60 * 1000);

  // A healthy bell for A01: no critical and no attention count (VIEWER in the demo data).
  // NAV03_ROLE=PROJECT_MANAGER measures the attention cadence instead (A06).
  const role = (process.env.NAV03_ROLE ?? "VIEWER") as DemoRole;

  test("ten visible minutes closed, then five hidden", async ({ page }) => {
    await signIn(page, role, { to: "/dashboard" });
    const log: Array<{ at: number; kind: "count" | "list"; phase: string }> = [];
    let phase = "visible";
    const started = Date.now();
    page.on("request", (request: Request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/activity-center/unread-count") log.push({ at: Date.now() - started, kind: "count", phase });
      else if (path === "/api/activity-center") log.push({ at: Date.now() - started, kind: "list", phase });
    });
    await page.goto("/dashboard");
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
      role,
      visible_10min: { count: count("count", "visible"), list: count("list", "visible") },
      hidden_5min: { count: count("count", "hidden"), list: count("list", "hidden") },
      log,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Database statistics                                                         */
/* -------------------------------------------------------------------------- */

const database = (process.env.DATABASE_URL ?? "").replace(/\?.*$/, "");
const QUIET = 11_000;
const psql = (sql: string) => execSync(`psql "${database}" -Atc "${sql}"`).toString().trim();
const commits = () => Number(psql("select xact_commit from pg_stat_database where datname = current_database()"));
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Rows inserted, updated and deleted so far, per table. */
function tableWrites(): Map<string, number> {
  const rows = psql("select relname || '|' || (n_tup_ins + n_tup_upd + n_tup_del) from pg_stat_user_tables");
  return new Map(rows.split("\n").filter(Boolean).map((line) => [line.split("|")[0], Number(line.split("|")[1])] as const));
}

/** The tables written while `work` runs, with how many rows. */
async function writesDuring(work: () => Promise<void>): Promise<Record<string, number>> {
  await settle(QUIET);
  const before = tableWrites();
  await work();
  await settle(QUIET);
  const after = tableWrites();
  const changed: Record<string, number> = {};
  for (const [table, count] of after) if (count !== (before.get(table) ?? 0)) changed[table] = count - (before.get(table) ?? 0);
  return changed;
}

/** Statements committed while `work` runs, less this reader's own. */
async function statementsDuring(work: () => Promise<void>): Promise<number> {
  await settle(QUIET);
  const before = commits();
  await work();
  await settle(QUIET);
  return commits() - before - 1;
}

const APPROVED = ["/dashboard", "/projects", "/clients", "/tasks", "/finance"] as const;
const sidebarLink = (page: Page, href: string) => page.locator(`nav[aria-label="Main navigation"] a[href="${href}"]`).first();

/** A deliberate hover past the dwell, then away, as a person reading the sidebar would. */
async function intent(page: Page, href: string) {
  await sidebarLink(page, href).hover();
  await page.waitForTimeout(400);
  await page.mouse.move(900, 500);
}

test.describe("prefetch side effects (F07, PREFETCH-04)", () => {
  test.skip(process.env.NAV03_SIDE_EFFECTS !== "1", "Set NAV03_SIDE_EFFECTS=1 with DATABASE_URL naming the server's database.");
  test.setTimeout(10 * 60 * 1000);

  test("hovering the five approved destinations prepares them and writes nothing", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/calendar" });
    await expect(sidebarLink(page, "/finance")).toBeVisible();
    const prepared = new Set<string>();
    page.on("request", (request) => {
      if (request.headers()["next-router-prefetch"]) prepared.add(new URL(request.url()).pathname);
    });

    // The same page, idle for as long, is the control: what the shell writes with nobody hovering.
    const control = await writesDuring(() => page.waitForTimeout(75_000));
    prepared.clear();
    const hovered = await writesDuring(async () => {
      const started = Date.now();
      for (const [index, href] of APPROVED.entries()) {
        // At most four issues in a rolling minute: the fifth waits for the window to open.
        if (index === 4) await page.waitForTimeout(Math.max(0, 61_000 - (Date.now() - started)));
        await intent(page, href);
        await page.waitForTimeout(1_700);
      }
    });

    const business = ["recent_items", "announcement_reads", "notifications", "user_favorites", "sessions", "audit_events", "unit_reservations", "announcement_acknowledgments"];
    write("nav03-side-effects", {
      label: LABEL,
      prepared_approved: [...prepared].filter((path) => (APPROVED as readonly string[]).includes(path)).sort(),
      prepared_by_other_links: [...prepared].filter((path) => !(APPROVED as readonly string[]).includes(path)).sort(),
      control_writes: control,
      hover_writes: hovered,
      hover_only_tables: Object.keys(hovered).filter((table) => !(table in control)),
      business_tables_checked: business,
    });
    // Each approved destination was asked for; other links keep the framework's own prefetch.
    for (const href of APPROVED) expect([...prepared], href).toContain(href);
    expect(Object.keys(hovered).filter((table) => !(table in control))).toEqual([]);
    for (const table of business) expect(hovered[table] ?? 0, table).toBeLessThanOrEqual(control[table] ?? 0);
  });
});

test.describe("prefetch server load (PERF-02, F12)", () => {
  test.skip(process.env.NAV03_PREFETCH_LOAD !== "1", "Set NAV03_PREFETCH_LOAD=1 with DATABASE_URL naming the server's database.");
  test.setTimeout(20 * 60 * 1000);

  test("statements for a fixed mix of navigations and abandoned intents", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    // Each step: a deliberate hover that is abandoned, then a click somewhere (approved or not).
    const script: Array<{ abandon: string; go: string }> = [
      { abandon: "/finance", go: "/tasks" },
      { abandon: "/clients", go: "/projects" },
      { abandon: "/dashboard", go: "/calendar" },
      { abandon: "/tasks", go: "/clients" },
      { abandon: "/projects", go: "/finance" },
      { abandon: "/clients", go: "/meetings" },
      { abandon: "/finance", go: "/dashboard" },
      { abandon: "/projects", go: "/tasks" },
      { abandon: "/dashboard", go: "/clients" },
      { abandon: "/tasks", go: "/dashboard" },
    ];
    const rounds: Array<{ statements: number; prefetch: number; abandoned_prefetch: number; navigation: number; document: number }> = [];
    for (let round = 0; round < 3; round += 1) {
      await page.goto("about:blank");
      const seen = { prefetch: [] as string[], navigation: 0, document: 0 };
      const onRequest = (request: Request) => {
        const headers = request.headers();
        if (headers["next-router-prefetch"]) seen.prefetch.push(new URL(request.url()).pathname);
        else if (headers.rsc === "1") seen.navigation += 1;
        if (request.resourceType() === "document") seen.document += 1;
      };
      page.on("request", onRequest);
      const statements = await statementsDuring(async () => {
        // The arrival is part of the script: a policy that prepares on sight pays for it here.
        await page.goto("/dashboard", { waitUntil: "load" });
        await page.locator("#nesto-main h1").first().waitFor({ state: "visible", timeout: 30_000 });
        await settle(2_000);
        for (const step of script) {
          await intent(page, step.abandon);
          await sidebarLink(page, step.go).click();
          await page.waitForURL((url) => url.pathname === step.go, { timeout: 30_000 });
          await page.locator("#nesto-main h1").first().waitFor({ state: "visible", timeout: 30_000 });
          await settle(1_500);
        }
      });
      page.off("request", onRequest);
      const visited = new Set(script.map((step) => step.go));
      rounds.push({ statements, prefetch: seen.prefetch.length, abandoned_prefetch: seen.prefetch.filter((path) => !visited.has(path)).length, navigation: seen.navigation, document: seen.document });
    }
    write("nav03-prefetch-load", {
      label: LABEL,
      script: "document /dashboard, then 10 steps of (hover one sidebar link 400 ms and leave, click another)",
      statements: { median: median(rounds.map((round) => round.statements)) },
      rounds,
    });
  });
});

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
  return { n: sorted.length, median: Math.round(at(0.5)), p95: Math.round(at(0.95)) };
}

test.describe("streaming delay isolation (S01, PERF-01 Streaming)", () => {
  test.skip(process.env.NAV03_STREAMING !== "1", "Set NAV03_STREAMING=1 (and start the server with NESTO_TEST_SHELL_DELAYS=1).");
  test.setTimeout(30 * 60 * 1000);

  test("1.5 s held on Tasks' counters adds nothing to Priority work, and the counters still arrive", async ({ page }) => {
    const samples = Number(process.env.NAV_BENCH_SAMPLES ?? 30);
    // Each section's first appearance is timed in the page, on the mutation that adds it:
    // a locator's wait re-checks at widening intervals (up to 500 ms) and would round the
    // times to its next check.
    await page.addInitScript(() => {
      const w = window as unknown as { __s: { start: number; path: string; primary: number | null; stats: number | null } };
      w.__s = { start: 0, path: "/tasks", primary: null, stats: null };
      new MutationObserver(() => {
        const main = document.getElementById("nesto-main");
        if (!main || location.pathname !== w.__s.path) return;
        const now = performance.now() - w.__s.start;
        if (w.__s.primary === null && main.querySelector('[data-section="primary"]')) w.__s.primary = now;
        if (w.__s.stats === null && main.querySelector('[data-section="stats"]')) w.__s.stats = now;
      }).observe(document, { subtree: true, childList: true, attributes: true });
    });
    await signIn(page, "OWNER", { to: "/dashboard" });
    const origin = new URL(page.url()).origin;
    const cohorts: Record<string, string> = { none: "", slow_counters: "section-tasks-stats=1500" };
    const primary: Record<string, Record<string, number[]>> = { document: { none: [], slow_counters: [] }, spa: { none: [], slow_counters: [] } };
    const counters: Record<string, Record<string, number[]>> = { document: { none: [], slow_counters: [] }, spa: { none: [], slow_counters: [] } };
    const measure = async (kind: "document" | "spa", cohort: string, start: () => Promise<void>) => {
      await start();
      const times = await page.waitForFunction(
        () => {
          const s = (window as unknown as { __s?: { primary: number | null; stats: number | null } }).__s;
          return s && s.primary !== null && s.stats !== null ? { primary: s.primary, stats: s.stats } : null;
        },
        undefined,
        { timeout: 30_000, polling: 50 },
      );
      const { primary: primaryAt, stats: statsAt } = (await times.jsonValue())!;
      primary[kind][cohort].push(primaryAt);
      counters[kind][cohort].push(statsAt);
      await page.waitForLoadState("load");
    };
    // From navigation start for a document; from the click for a sidebar navigation.
    const clickTasks = () =>
      page.evaluate(() => {
        const w = window as unknown as { __s: { start: number; primary: number | null; stats: number | null } };
        w.__s.start = performance.now();
        w.__s.primary = null;
        w.__s.stats = null;
        document.querySelector<HTMLAnchorElement>('nav[aria-label="Main navigation"] a[href="/tasks"]')!.click();
      });
    // Interleaved, so both cohorts see the same machine.
    for (let index = 0; index < samples; index += 1) {
      for (const [cohort, rules] of Object.entries(cohorts)) {
        await page.context().clearCookies({ name: "nesto-test-shell-delay" });
        if (rules) await page.context().addCookies([{ name: "nesto-test-shell-delay", value: rules, url: origin }]);
        await measure("document", cohort, () => page.goto("/tasks", { waitUntil: "commit" }).then(() => undefined));
        await page.goto("/calendar", { waitUntil: "load" });
        await sidebarLink(page, "/tasks").waitFor({ state: "visible" });
        await measure("spa", cohort, clickTasks);
      }
    }
    await page.context().clearCookies({ name: "nesto-test-shell-delay" });
    const report = (kind: "document" | "spa") => {
      const none = stats(primary[kind].none);
      const slow = stats(primary[kind].slow_counters);
      return {
        primary_ready: { none, slow_counters: slow },
        counters_ready: { none: stats(counters[kind].none), slow_counters: stats(counters[kind].slow_counters) },
        added_to_primary_ms: { median: slow.median - none.median, p95: slow.p95 - none.p95 },
      };
    };
    const output = { label: LABEL, page: "/tasks", held: "section-tasks-stats=1500", budget_ms: 150, document: report("document"), spa: report("spa") };
    write("nav03-streaming", output);
    for (const kind of ["document", "spa"] as const) {
      expect(output[kind].added_to_primary_ms.median, `${kind}: added to Priority work`).toBeLessThanOrEqual(150);
      // The held section still finishes, after its hold.
      expect(output[kind].counters_ready.slow_counters.median).toBeGreaterThanOrEqual(1_500);
    }
  });
});

test.describe("telemetry reaches the scrape (T07, T10)", () => {
  test.skip(process.env.NAV03_TELEMETRY !== "1" || !process.env.METRICS_TOKEN, "Set NAV03_TELEMETRY=1 and METRICS_TOKEN (server: NESTO_NAV_TELEMETRY_SAMPLE=1).");
  test.setTimeout(5 * 60 * 1000);

  test("a sampled browser's batches are enums and numbers only, and show up as histograms", async ({ page }) => {
    const scrape = async () => {
      const response = await page.request.get("/api/internal/metrics", { headers: { authorization: `Bearer ${process.env.METRICS_TOKEN}` } });
      expect(response.status()).toBe(200);
      return response.text();
    };
    const count = (text: string, series: string) =>
      text
        .split("\n")
        .filter((line) => line.startsWith(`${series}_count`))
        .reduce((total, line) => total + Number(line.split(" ").pop()), 0);
    const accepted = (text: string) => Number(text.split("\n").find((line) => line.startsWith('telemetry_batch_total{outcome="accepted"}'))?.split(" ").pop() ?? 0);
    await signIn(page, "OWNER", { to: "/dashboard" });
    await page.locator("#nesto-main h1").first().waitFor({ state: "visible" });
    // Sign-in lands on a page before opening Dashboard, and that sampled page flushes its
    // own batch while unloading, where the browser reports no request. The window starts
    // here, once that batch has been counted.
    await page.waitForTimeout(1_000);
    const before = await scrape();

    // Keepalive requests are not reported as finished; the server's own count says what it accepted.
    const batches: Array<{ body: string }> = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/telemetry/navigation") batches.push({ body: request.postData() ?? "" });
    });
    for (const href of ["/tasks", "/clients", "/finance", "/projects", "/dashboard"]) {
      await sidebarLink(page, href).click();
      await page.waitForURL((url) => url.pathname === href);
      await page.locator("#nesto-main h1").first().waitFor({ state: "visible" });
      await page.waitForTimeout(800);
    }
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(1_000);
    await page.keyboard.press("Escape");
    await page.getByTestId("notification-bell").click();
    await page.waitForTimeout(1_000);
    await page.keyboard.press("Escape");
    // Hidden: the one final batch.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => batches.length, { timeout: 45_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    const after = await scrape();

    const events = batches.flatMap((batch) => (JSON.parse(batch.body) as { events: Array<Record<string, unknown>> }).events);
    // T07: nothing but the fixed vocabulary and numbers.
    const vocabulary = new Set(["navigation", "panel", "web_vital", "request_summary", "dashboard", "projects", "clients", "tasks", "finance", "other", "feedback", "commit", "core", "primary", "settled", "ready", "document", "spa", "history", "workspace", "success", "partial_failure", "error", "timeout", "superseded", "abandoned", "backgrounded", "issued", "not_issued", "unknown", "compact", "wide", "search", "quick_create", "activity", "cold", "warm", "LCP", "INP", "CLS", "FCP", "TTFB", "activity_count", "activity_list", "search_home", "route"]);
    const strays = events.flatMap((event) => Object.values(event).filter((value) => typeof value === "string" && !vocabulary.has(value)));
    const series = ["navigation_duration_ms", "panel_ready_ms", "web_vital", "web_vital_cls", "activity_read_ms"];
    const output = {
      label: LABEL,
      batches: batches.map((batch) => ({ bytes: batch.body.length, events: (JSON.parse(batch.body) as { events: unknown[] }).events.length })),
      accepted_by_server: { before: accepted(before), after: accepted(after) },
      event_kinds: events.reduce<Record<string, number>>((all, event) => ({ ...all, [`${event.kind}:${event.stage ?? event.metric ?? ""}`]: (all[`${event.kind}:${event.stage ?? event.metric ?? ""}`] ?? 0) + 1 }), {}),
      stray_strings: strays,
      // Fixed enums and numbers only, so the payload itself is the example the evidence shows.
      first_batch: batches[0] ? JSON.parse(batches[0].body) : null,
      scrape_counts: Object.fromEntries(series.map((name) => [name, { before: count(before, name), after: count(after, name) }])),
      scrape_excerpt: after.split("\n").filter((line) => /^(# TYPE )?(navigation_duration_ms|panel_ready_ms|activity_read_ms)/.test(line) && !/_bucket/.test(line)).slice(0, 40),
    };
    write("nav03-telemetry", output);
    // The raw exposition for the NAV-03 families, for the histogram query in the evidence.
    writeFileSync(
      join(OUT, `nav03-telemetry-scrape-${LABEL}.txt`),
      after
        .split("\n")
        .filter((line) => /^(# (TYPE|HELP) )?(navigation_duration_ms|navigation_outcome_total|panel_ready_ms|panel_outcome_total|web_vital|web_vital_cls|activity_read_ms|browser_request_total|telemetry_batch_total)(_bucket|_sum|_count)?[{ ]/.test(line))
        .join("\n"),
    );
    expect(accepted(after) - accepted(before)).toBe(batches.length);
    expect(strays).toEqual([]);
    expect(count(after, "navigation_duration_ms")).toBeGreaterThan(count(before, "navigation_duration_ms"));
    expect(count(after, "activity_read_ms")).toBeGreaterThan(count(before, "activity_read_ms"));
  });
});

test.describe("page queries (PERF-01, S12)", () => {
  test.skip(process.env.NAV03_PAGE_QUERIES !== "1", "Set NAV03_PAGE_QUERIES=1 with DATABASE_URL naming the server's database.");
  test.setTimeout(20 * 60 * 1000);

  test("statements per document load of each streamed page", async ({ page, context }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    // The router skips prefetching for crawlers: only the page's own reads are counted.
    const reader = await context.newPage();
    await reader.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "userAgent", { get: () => "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
    });
    const pages = ["/dashboard", "/clients", "/tasks", "/finance", "/projects/project_a"];
    const LOADS = 3;
    const perLoad: Record<string, number> = {};
    for (const path of pages) {
      const statements = await statementsDuring(async () => {
        for (let load = 0; load < LOADS; load += 1) {
          await reader.goto("about:blank");
          await reader.goto(path, { waitUntil: "load" });
          await reader.locator("#nesto-main h1").first().waitFor({ state: "visible", timeout: 30_000 });
          // Every section has arrived: nothing is still loading when the window closes.
          await expect(reader.locator('#nesto-main [data-testid="section-skeleton"]')).toHaveCount(0, { timeout: 30_000 });
          await settle(1_000);
        }
      });
      perLoad[path] = Math.round((statements / LOADS) * 10) / 10;
    }
    write("nav03-page-queries", { label: LABEL, loads_per_page: LOADS, statements_per_document_load: perLoad });
  });
});
