import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * Maintenance across two instances (NAV-02 §12, M06, M12). Opt-in:
 * `NAV_TWO_INSTANCES=1` with `E2E_SECOND_BASE_URL` naming a second
 * `next start` of the same build on the same database.
 *
 * Each instance keeps its own page snapshot for at most five seconds. The
 * setting is written straight to the table, as a change committed on some
 * other instance would reach these two: neither is told. Enforcement reads
 * must see it at once; pages within five seconds; and no page may bounce
 * between /dashboard and /maintenance while the two disagree.
 */

const ENABLED = process.env.NAV_TWO_INSTANCES === "1" && Boolean(process.env.E2E_SECOND_BASE_URL);
const KEY = "maintenance.enabled";

async function setMaintenance(enabled: boolean) {
  const admin = await db.user.findFirstOrThrow({ where: { platformAccess: { status: "ACTIVE" } }, select: { id: true } });
  await db.platformSetting.upsert({
    where: { key: KEY },
    update: { value: enabled, reason: "Two-instance drill", updatedByUserId: admin.id },
    create: { key: KEY, value: enabled, reason: "Two-instance drill", category: "maintenance", updatedByUserId: admin.id },
  });
}

/** A page's path after a document load, failing on a redirect loop rather than hiding it. */
async function landing(page: Page, path: string): Promise<string> {
  const response = await page.goto(path, { waitUntil: "commit" });
  expect(response, `${path} answered`).not.toBeNull();
  return new URL(page.url()).pathname;
}

test.describe("maintenance on two instances", () => {
  test.skip(!ENABLED, "Set NAV_TWO_INSTANCES=1 and E2E_SECOND_BASE_URL to run the two-instance drill.");
  test.setTimeout(120_000);

  let second: BrowserContext;
  let a: Page;
  let b: Page;

  test.beforeEach(async ({ browser, page }) => {
    await db.platformSetting.deleteMany({ where: { key: KEY } });
    a = page;
    await signIn(a, "PROJECT_MANAGER", { to: "/tasks" });
    second = await browser.newContext({ baseURL: process.env.E2E_SECOND_BASE_URL });
    b = await second.newPage();
    await signIn(b, "PROJECT_MANAGER", { to: "/tasks" });
    // Both instances now hold a fresh "off" snapshot.
    await expect(mainRegion(a).locator("h1").first()).toBeVisible();
    await expect(mainRegion(b).locator("h1").first()).toBeVisible();
  });

  test.afterEach(async () => {
    await db.platformSetting.deleteMany({ where: { key: KEY } });
    await second?.close();
  });

  test("a change is enforced on the next API call at once, and reaches pages within five seconds (M06)", async () => {
    await setMaintenance(true);
    // Enforcement reads the table, whatever either snapshot holds.
    for (const page of [a, b]) {
      const response = await page.request.get("/api/tasks");
      expect(response.status()).toBe(403);
      expect((await response.json()).error.message).toMatch(/maintenance/i);
    }
    // Pages may keep their snapshot for its remaining life, never longer.
    await expect.poll(async () => landing(b, "/tasks"), { timeout: 8_000, intervals: [500] }).toBe("/maintenance");
    await expect.poll(async () => landing(a, "/tasks"), { timeout: 8_000, intervals: [500] }).toBe("/maintenance");
  });

  test("switching maintenance off never bounces a page between the two screens (M12)", async () => {
    await setMaintenance(true);
    await expect.poll(async () => landing(b, "/dashboard"), { timeout: 8_000, intervals: [500] }).toBe("/maintenance");
    // B's snapshot now says "enabled". Off again, told to nobody.
    await setMaintenance(false);
    // An enabled snapshot is confirmed live before anybody is redirected, and
    // /maintenance reads live: both land on the application at once.
    expect(await landing(b, "/dashboard")).toBe("/dashboard");
    expect(await landing(b, "/maintenance")).toBe("/dashboard");
    expect(await landing(a, "/dashboard")).toBe("/dashboard");
  });

  test("rapid toggles on the table: every document load ends somewhere, never in a loop (M12, M18)", async () => {
    for (let round = 0; round < 6; round += 1) {
      await setMaintenance(round % 2 === 0);
      for (const page of [a, b]) {
        const path = await landing(page, round % 3 === 0 ? "/maintenance" : "/dashboard");
        expect(["/dashboard", "/maintenance"]).toContain(path);
      }
    }
    await setMaintenance(false);
    await expect.poll(async () => landing(a, "/dashboard"), { timeout: 8_000 }).toBe("/dashboard");
    await expect.poll(async () => landing(b, "/dashboard"), { timeout: 8_000 }).toBe("/dashboard");
  });
});
