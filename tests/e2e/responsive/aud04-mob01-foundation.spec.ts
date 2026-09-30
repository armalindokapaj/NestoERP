import { expect, test } from "@playwright/test";

import { db } from "../db";
import { signIn, type DemoRole } from "../fixtures";
import { expectNoPageOverflow } from "./geometry";

/**
 * MOB-01 §55, §56, §63: the overflow guard on representative routes.
 *
 * Every route below is opened at each size of the responsive matrix (the
 * `aud04-*` projects in playwright.config.ts, 320 to 1440) and must not scroll
 * sideways: `documentElement.scrollWidth <= clientWidth`. Deliberate
 * two-dimensional regions (tables, drawings) scroll inside themselves, which
 * `expectNoPageOverflow` allows. Read-only against the seeded demo.
 *
 * The tokens, primitives and their class contracts are covered without a
 * browser in tests/unit/responsive/mob01-foundation.test.ts.
 */

const ROUTES: { name: string; role: DemoRole; path: string }[] = [
  { name: "dashboard", role: "OWNER", path: "/dashboard" },
  { name: "projects", role: "PROJECT_MANAGER", path: "/projects" },
  { name: "project detail", role: "PROJECT_MANAGER", path: "/projects/project_a" },
  { name: "tasks", role: "PROJECT_MANAGER", path: "/tasks" },
  { name: "documents", role: "OWNER", path: "/documents" },
  { name: "form-heavy: new project", role: "OWNER", path: "/projects/new" },
  { name: "table-heavy: finance invoices", role: "FINANCE_A", path: "/finance/invoices" },
  { name: "clients", role: "OWNER", path: "/clients/all" },
];

test.afterAll(async () => {
  await db.$disconnect();
});

for (const route of ROUTES) {
  test(`${route.name}: no page-level horizontal overflow`, async ({ page }) => {
    await signIn(page, route.role, { to: route.path });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectNoPageOverflow(page, route.name);
  });
}

test("the page container keeps its content clear of the viewport edges", async ({ page }) => {
  await signIn(page, "OWNER", { to: "/dashboard" });
  const box = await page.locator("#nesto-main").boundingBox();
  const width = page.viewportSize()!.width;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  const gutter = await page.locator("#nesto-main").evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  // 16px on a phone, at least 24px from md (tokens.css --nesto-space-page-x).
  expect(gutter).toBeGreaterThanOrEqual(width >= 768 ? 24 : 16);
});
