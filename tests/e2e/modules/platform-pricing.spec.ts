import { expect, test } from "@playwright/test";

import { signIn } from "../fixtures";

test("the Platform Admin can review the active public price book", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN", { to: "/admin/modules/pricing" });
  await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active price book" })).toBeVisible();
  await expect(page.getByText("2026.09").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current promotion" })).toBeVisible();
  await expect(page.getByRole("main").getByLabel("Eligible foundation")).toHaveValue("NESTO_PLATFORM");
});

test("a tenant user cannot enter the platform pricing control plane", async ({ page }) => {
  await signIn(page, "OWNER", { to: "/dashboard" });
  await page.goto("/admin/modules/pricing");
  await expect(page).toHaveURL(/\/dashboard$/);
  const response = await page.request.get("/api/platform/pricing/versions");
  expect(response.status()).toBe(403);
});
