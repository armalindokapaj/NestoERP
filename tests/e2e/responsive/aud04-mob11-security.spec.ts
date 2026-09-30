import { expect, test } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { outsideProjects } from "./geometry";

/**
 * MOB-11: the security surfaces render for the roles that hold them, a revoked
 * device is refused on the server, and the signed-out app can ask about removal.
 * Native behaviour (app lock, FLAG_SECURE, app switcher) needs a device; see
 * docs/security/mobile-security-testing.md.
 */
const SIZES = /^aud04-(phone-390|desktop-1280)$/;
const INSTALL = "e2e11".padEnd(32, "b");

test.beforeEach(async ({}, testInfo) => {
  test.skip(outsideProjects(testInfo, SIZES), "MOB-11 checks run at 390 and 1280.");
});

test.afterAll(async () => {
  await db.deviceRegistration.deleteMany({ where: { installId: INSTALL } });
  await db.$disconnect();
});

test("a person sees their own security page and devices", async ({ page }) => {
  await signIn(page, "ENGINEER");
  for (const path of ["/settings/security", "/settings/mobile-devices"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(mainRegion(page)).toBeVisible();
    await expect(mainRegion(page).getByRole("heading").first()).toBeVisible();
  }
});

test("the admin pages are refused to a role without the permission and open for the owner", async ({ page }) => {
  await signIn(page, "ENGINEER");
  // A refused page can stream behind a 200; what matters is that none of the policy is rendered.
  await page.goto("/settings/mobile-policy");
  await expect(mainRegion(page)).toBeVisible();
  await expect(page.getByTestId("policy-company")).toHaveCount(0);
  await expect(page.getByTestId("policy-form-company")).toHaveCount(0);
  await page.context().clearCookies();
  await signIn(page, "OWNER");
  for (const path of ["/settings/mobile-policy", "/settings/security-events"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(mainRegion(page)).toBeVisible();
  }
  await page.goto("/settings/mobile-policy");
  await expect(page.getByTestId("policy-company").first()).toBeVisible();
});

test("a revoked install is refused and learns it must remove its data, without a session", async ({ page, request }) => {
  await signIn(page, "ENGINEER");
  const registered = await page.request.post("/api/me/security/device", { data: { installId: INSTALL, platform: "ios", appVersion: "9.9.9", appBuild: "1" } });
  expect(registered.ok(), await registered.text()).toBe(true);
  const device = await db.deviceRegistration.findFirstOrThrow({ where: { installId: INSTALL } });
  await db.deviceRegistration.update({ where: { id: device.id }, data: { status: "REVOKED", dataRemovalMode: "FULL", dataRemovalRequestedAt: new Date() } });

  const probe = await request.post("/api/app/device-state", { data: { installId: INSTALL, userIds: [device.userId] } });
  expect(probe.status()).toBe(200);
  const body = JSON.stringify(await probe.json());
  expect(body).toContain("REVOKED");
  expect(body).toContain("FULL");

  const nobody = await request.post("/api/app/device-state", { data: { installId: INSTALL, userIds: ["someone-else"] } });
  expect(JSON.stringify(await nobody.json())).not.toContain("REVOKED");
});
