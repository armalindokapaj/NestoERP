import { expect, test, type Page, type Request } from "@playwright/test";

import { CHAIN, resetChainFixture } from "../approvals-fixtures";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * Failure and recovery in the browser (AUD-07 §7; PS-10, PS-13, PS-14, PS-15,
 * PS-16, PS-19). Faults are injected at the network with `page.route`: the
 * server and its data are the real ones, and every assertion checks what the
 * person can do next — a working Retry, a kept query, an honest outcome — and
 * how many requests really went out, not only what is drawn.
 *
 * The CEO reviews Aurelia's approval queue; the seeded purchase-order chain
 * (tests/e2e/approvals-fixtures.ts) is theirs to decide and is reset around
 * the file.
 *
 * Written for the lead's production-build run (`npm run test:e2e:prod`); the
 * 10-second read deadline makes two tests deliberately slow.
 */

test.beforeAll(async () => {
  await resetChainFixture();
});

test.afterAll(async () => {
  await resetChainFixture();
  await db.$disconnect();
});

const QUEUE = /\/api\/approvals\?/;

/** Uncaught errors and unhandled rejections: none may appear (PS-10, PS-19). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Unhandled|uncaught/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

function count(page: Page, pattern: RegExp, method = "GET"): Request[] {
  const seen: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === method && pattern.test(request.url())) seen.push(request);
  });
  return seen;
}

test("a failing list read retries once, then offers Retry, which recovers with the query kept (PS-13)", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, "CEO", { to: "/approvals" });
  const main = mainRegion(page);
  await expect(main.locator(`[data-approval="procurement:${CHAIN.approval}"]`)).toBeVisible();

  const reads = count(page, QUEUE);
  await page.route(QUEUE, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } }) }));
  await main.getByRole("searchbox", { name: "Search approvals" }).fill(CHAIN.poNumber);

  const alert = main.getByRole("alert").filter({ hasText: /could not|went wrong/i });
  await expect(alert).toBeVisible();
  // One automatic retry, not a loop.
  expect(reads).toHaveLength(2);
  await expect(main.locator("[aria-busy=true]")).toHaveCount(0);
  // The query is still there to retry.
  await expect(main.getByRole("searchbox", { name: "Search approvals" })).toHaveValue(CHAIN.poNumber);
  expect(page.url()).toContain(`q=${CHAIN.poNumber}`);

  await page.unroute(QUEUE);
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(main.locator(`[data-approval="procurement:${CHAIN.approval}"]`)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a read that never answers ends at the 10-second deadline with Retry, not an endless spinner (PS-13)", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page, "CEO", { to: "/approvals" });
  const main = mainRegion(page);
  await page.route(QUEUE, () => undefined); // never fulfilled
  const started = Date.now();
  await main.getByRole("searchbox", { name: "Search approvals" }).fill("hangs");
  const alert = main.getByRole("alert").filter({ hasText: /longer than expected/i });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - started).toBeLessThan(13_000);
  await expect(alert.getByRole("button", { name: "Try again" })).toBeEnabled();
});

test("a rate-limited read honours Retry-After and says when to try again (PS-13)", async ({ page }) => {
  await signIn(page, "CEO", { to: "/approvals" });
  const main = mainRegion(page);
  const reads = count(page, QUEUE);
  await page.route(QUEUE, (route) => route.fulfill({ status: 429, headers: { "retry-after": "60" }, contentType: "application/json", body: "{}" }));
  await main.getByRole("searchbox", { name: "Search approvals" }).fill("limited");
  await expect(main.getByRole("alert").filter({ hasText: "Try again in 60 seconds" })).toBeVisible();
  // Retry-After is longer than the deadline: no automatic retry at all.
  expect(reads).toHaveLength(1);
});

test("refusals are never retried: 403, 404, 409 and 422 each go out once (PS-14)", async ({ page }) => {
  await signIn(page, "CEO", { to: "/approvals" });
  const main = mainRegion(page);
  for (const [status, code] of [[403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "CONFLICT"], [422, "VALIDATION_ERROR"]] as const) {
    const reads = count(page, QUEUE);
    await page.route(QUEUE, (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message: `refused ${status}` } }) }));
    await main.getByRole("searchbox", { name: "Search approvals" }).fill(`refused ${status}`);
    await expect(main.getByRole("alert").filter({ hasText: `refused ${status}` })).toBeVisible();
    expect(reads, String(status)).toHaveLength(1);
    await page.unroute(QUEUE);
  }
});

test("a slow old search never replaces the newer one, and the old read is aborted (PS-10)", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, "CEO", { to: "/approvals" });
  const main = mainRegion(page);
  const aborted: string[] = [];
  page.on("requestfailed", (request) => {
    if (QUEUE.test(request.url())) aborted.push(request.url());
  });
  // The first query is held back; the second goes straight through.
  await page.route(/\/api\/approvals\?.*q=zzz-old/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.continue().catch(() => undefined);
  });
  const search = main.getByRole("searchbox", { name: "Search approvals" });
  await search.fill("zzz-old");
  await page.waitForRequest(/q=zzz-old/);
  await search.fill(CHAIN.poNumber);
  await expect(main.locator(`[data-approval="procurement:${CHAIN.approval}"]`)).toBeVisible();

  // Past the old answer's arrival, the newer results are still what is shown.
  await page.waitForTimeout(3_500);
  await expect(main.locator(`[data-approval="procurement:${CHAIN.approval}"]`)).toBeVisible();
  expect(aborted.some((url) => url.includes("q=zzz-old"))).toBe(true);
  expect(errors).toEqual([]);
});

test("a decision whose answer is lost is 'unknown', is not replayed, and trying again records it once (PS-15, PS-16)", async ({ page }) => {
  await signIn(page, "CEO", { to: "/approvals" });
  const main = mainRegion(page);
  await main.locator(`[data-approval="procurement:${CHAIN.approval}"]`).click();
  const detail = main.getByTestId("approval-detail");
  await expect(detail.getByTestId("approval-title")).toBeVisible();

  const decisions = count(page, /\/api\/approvals\/procurement\/[^/]+\/approve$/, "POST");
  const keys: string[] = [];
  // The request reaches the server and commits; only its answer is lost.
  await page.route(/\/approve$/, async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    await route.fetch();
    await route.abort("connectionreset");
  });
  await detail.getByTestId("decision-approve").click();

  await expect(page.getByText(/couldn't confirm whether this was recorded/i).first()).toBeVisible();
  // Never "failed" or "rolled back".
  await expect(page.getByText(/rolled back|was not recorded|nothing was saved/i)).toHaveCount(0);
  // No automatic replay.
  await page.waitForTimeout(1_000);
  expect(decisions).toHaveLength(1);

  // The person tries again: the same attempt key, so the server answers with the decision already made.
  await page.unroute(/\/approve$/);
  const retried = count(page, /\/approve$/, "POST");
  const answer = page.waitForResponse((response) => /\/approve$/.test(response.url()));
  await detail.getByTestId("decision-approve").click().catch(() => undefined);
  const response = await answer.catch(() => null);
  if (response) {
    expect(retried[0]?.headers()["idempotency-key"]).toBe(keys[0]);
    const body = (await response.json()) as { data?: { alreadyApplied?: boolean } };
    expect(body.data?.alreadyApplied).toBe(true);
  }
  // Either way, one decision on the record: the final step decided once, one receipt for the attempt.
  const step = await db.approvalStep.findFirstOrThrow({ where: { approvalId: CHAIN.approval, stepNumber: 3 }, select: { status: true } });
  expect(step.status).toBe("APPROVED");
  expect(await db.approvalDecisionReceipt.count({ where: { approvalId: CHAIN.approval } })).toBe(1);
});

test("rapid navigation across data-loading pages leaves no stuck loader and no unhandled rejection (PS-10, PS-19)", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await signIn(page, "CEO", { to: "/approvals" });
  const routes = ["/approvals", "/calendar", "/projects", "/approvals?tab=all", "/calendar"];
  for (let round = 0; round < 3; round += 1) {
    for (const path of routes) {
      // Not waiting for the page: the next navigation interrupts the reads in flight.
      await page.goto(path, { waitUntil: "commit" });
    }
  }
  await page.goto("/approvals");
  const main = mainRegion(page);
  await expect(main.locator(`[data-approval="procurement:${CHAIN.approval}"]`).or(main.getByRole("alert"))).toBeVisible();
  await expect(main.locator("[aria-busy=true]")).toHaveCount(0, { timeout: 12_000 });
  expect(errors).toEqual([]);
});
