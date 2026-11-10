import { expect, test, type Page } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * The group owner is protected (the user, 2026-11-10: "Group owner is
 * protected."). The CEO opens Settings → Mobile devices and sees the Owner's
 * phone read-only, marked as the group owner's, with no actions — and the
 * server refuses the action when it is sent anyway. Somebody else's phone keeps
 * its actions. The company's mobile policy says it does not reach the Owner.
 */

test.describe.configure({ mode: "serial" });

const OWNER_INSTALL = "e2eowprot".padEnd(32, "a");
const ENGINEER_INSTALL = "e2eowprot".padEnd(32, "b");
const INSTALLS = [OWNER_INSTALL, ENGINEER_INSTALL];

let ownerDevice = "";
let engineerDevice = "";

async function removeDevices() {
  const devices = (await db.deviceRegistration.findMany({ where: { installId: { in: INSTALLS } }, select: { id: true } })).map((row) => row.id);
  if (devices.length === 0) return;
  await db.session.updateMany({ where: { deviceId: { in: devices } }, data: { deviceId: null } });
  await db.auditEvent.deleteMany({ where: { entityType: "Device", entityId: { in: devices } } });
  await db.authEvent.deleteMany({ where: { OR: devices.map((id) => ({ metadata: { path: ["deviceId"], equals: id } })) } });
  await db.deviceRegistration.deleteMany({ where: { id: { in: devices } } });
}

/** The app's own registration call, from a signed-in session (as aud04-mob11-security.spec.ts does). */
async function registerPhone(page: Page, installId: string): Promise<string> {
  const registered = await page.request.post("/api/me/security/device", { data: { installId, platform: "ios", appVersion: "9.9.9", appBuild: "1" } });
  expect(registered.ok(), await registered.text()).toBe(true);
  return (await db.deviceRegistration.findFirstOrThrow({ where: { installId }, select: { id: true } })).id;
}

test.beforeAll(removeDevices);

test.afterAll(async () => {
  await removeDevices();
  await db.$disconnect();
});

test("the Owner and an Engineer each sign in on a phone", async ({ page }) => {
  await signIn(page, "OWNER");
  ownerDevice = await registerPhone(page, OWNER_INSTALL);
  await page.context().clearCookies();
  await signIn(page, "ENGINEER");
  engineerDevice = await registerPhone(page, ENGINEER_INSTALL);
  expect(ownerDevice).not.toBe(engineerDevice);
});

test("the CEO sees the Owner's phone as protected, with no actions, and the server refuses a forced one", async ({ page }) => {
  await signIn(page, "CEO");

  await page.goto("/settings/mobile-devices?q=owner");
  const row = mainRegion(page).getByTestId("device-admin-row").filter({ has: page.locator(`a[href="/settings/mobile-devices/${ownerDevice}"]`) });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("device-owner-protected")).toHaveText("Group owner · protected");

  await page.goto(`/settings/mobile-devices/${ownerDevice}`);
  await expect(mainRegion(page).getByTestId("device-admin-detail")).toBeVisible();
  await expect(mainRegion(page).getByTestId("device-owner-protected")).toBeVisible();
  await expect(mainRegion(page).getByTestId("device-owner-protected-note")).toHaveText("The group owner manages their own devices and sessions.");
  await expect(mainRegion(page).getByTestId("admin-device-actions")).toHaveCount(0);

  // Sent anyway, every action is refused by the server and the phone is untouched.
  for (const action of ["SIGN_OUT", "REAUTH", "REVOKE", "LOST", "BLOCK", "RESTORE"]) {
    const response = await page.request.post(`/api/security/devices/${ownerDevice}`, { data: { action } });
    expect(response.status(), action).toBe(403);
    const body = (await response.json()) as { error: { code: string; message: string; details?: { code?: string } } };
    expect(body.error, action).toMatchObject({ code: "FORBIDDEN", message: "The group owner manages their own devices and sessions.", details: { code: "OWNER_PROTECTED" } });
  }
  const device = await db.deviceRegistration.findUniqueOrThrow({ where: { id: ownerDevice }, select: { status: true, revokedAt: true } });
  expect(device).toEqual({ status: "ACTIVE", revokedAt: null });
});

test("the CEO keeps the actions on anyone else's phone", async ({ page }) => {
  await signIn(page, "CEO");
  await page.goto(`/settings/mobile-devices/${engineerDevice}`);
  await expect(mainRegion(page).getByTestId("device-admin-detail")).toBeVisible();
  await expect(mainRegion(page).getByTestId("device-owner-protected")).toHaveCount(0);
  await expect(mainRegion(page).getByTestId("admin-device-actions")).toBeVisible();
  const response = await page.request.post(`/api/security/devices/${engineerDevice}`, { data: { action: "SIGN_OUT" } });
  expect(response.status(), await response.text()).toBe(200);
});

test("the company's mobile policy says it does not apply to the group owner", async ({ page }) => {
  await signIn(page, "CEO");
  await page.goto("/settings/mobile-policy");
  const company = mainRegion(page).getByTestId("policy-company").first();
  await expect(company).toBeVisible();
  await expect(company.getByTestId("policy-owner-exempt")).toHaveText("This company's policy does not apply to the group owner.");
});

test("the Owner sees their own phone with its actions", async ({ page }) => {
  await signIn(page, "OWNER");
  await page.goto(`/settings/mobile-devices/${ownerDevice}`);
  await expect(mainRegion(page).getByTestId("device-admin-detail")).toBeVisible();
  await expect(mainRegion(page).getByTestId("device-owner-protected")).toHaveCount(0);
  await expect(mainRegion(page).getByTestId("admin-device-actions")).toBeVisible();
});
