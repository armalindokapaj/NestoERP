import { expect, test } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { outsideProjects } from "./geometry";

/**
 * MOB-08 server side of the native shell: device registration, the version
 * gate, and the browser staying untouched. The native runtime itself (Capacitor)
 * needs a device; its adapters and link rules are unit-tested in
 * tests/unit/native.
 */
const SIZES = /^aud04-(phone-390|desktop-1280)$/;
const TOKEN = "mob08-test-token-0123456789abcdef";
const APP_UA = (version: string) => `Mozilla/5.0 NESTOApp/${version} (android; build 7)`;

test.beforeEach(async ({}, testInfo) => {
  test.skip(outsideProjects(testInfo, SIZES), "MOB-08 server checks run at 390 and 1280.");
});

test.afterAll(async () => {
  await db.deviceRegistration.deleteMany({ where: { pushToken: { startsWith: "mob08-" } } });
  await db.$disconnect();
});

test("the browser shows no native UI and the compatibility answer is public", async ({ page, request }) => {
  await signIn(page, "PROJECT_MANAGER");
  await page.goto("/dashboard");
  await expect(mainRegion(page)).toBeVisible();
  await expect(page.locator("#native-blocker-title")).toHaveCount(0);

  const answer = await request.get("/api/app/compatibility", { headers: { "user-agent": APP_UA("0.1.0") } });
  expect(answer.status()).toBe(200);
  expect(await answer.json()).toMatchObject({ status: "update-required", platform: "android" });
});

test("a device registers, refreshes without duplicating, and is removed on sign-out", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER");
  const body = { platform: "android", pushToken: `${TOKEN}-a`, appVersion: "1.0.0", appBuild: "100" };

  const first = await page.request.post("/api/me/devices", { data: body });
  expect(first.status(), await first.text()).toBe(200);
  const again = await page.request.post("/api/me/devices", { data: { ...body, appVersion: "1.0.1" } });
  expect(again.status()).toBe(200);

  const rows = await db.deviceRegistration.findMany({ where: { pushToken: body.pushToken } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ platform: "ANDROID", appVersion: "1.0.1", enabled: true });
  expect(rows[0]!.sessionId).not.toBeNull();

  expect((await page.request.post("/api/me/devices", { data: { platform: "windows", pushToken: "x" } })).status()).toBe(422);

  // Ending the session releases the push token (the device row itself stays, MOB-11).
  const origin = new URL(page.url()).origin;
  const out = await page.request.post("/api/auth/lifecycle", { headers: { origin } });
  expect(out.ok(), await out.text()).toBe(true);
  expect(await db.deviceRegistration.count({ where: { pushToken: body.pushToken } })).toBe(0);
});

test("a person can remove only their own device registration", async ({ browser }) => {
  const pm = await (await browser.newContext()).newPage();
  await signIn(pm, "PROJECT_MANAGER");
  const token = `${TOKEN}-b`;
  await pm.request.post("/api/me/devices", { data: { platform: "ios", pushToken: token, appVersion: "1.0.0" } });

  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, "OWNER");
  await owner.request.delete("/api/me/devices", { data: { pushToken: token } });
  expect(await db.deviceRegistration.count({ where: { pushToken: token } })).toBe(1);

  await pm.request.delete("/api/me/devices", { data: { pushToken: token } });
  expect(await db.deviceRegistration.count({ where: { pushToken: token } })).toBe(0);
});

test("an obsolete app may read but not change data; a current one may do both", async ({ browser }) => {
  const old = await browser.newContext({ userAgent: APP_UA("0.9.0") });
  const page = await old.newPage();
  await signIn(page, "PROJECT_MANAGER");
  expect((await page.request.get("/api/me")).status()).toBe(200);
  const blocked = await page.request.post("/api/me/devices", { data: { platform: "android", pushToken: `${TOKEN}-c`, appVersion: "0.9.0" } });
  expect(blocked.status()).toBe(426);
  expect(await blocked.json()).toMatchObject({ error: { code: "UPDATE_REQUIRED" } });

  const current = await browser.newContext({ userAgent: APP_UA("1.0.0") });
  const ok = await current.newPage();
  await signIn(ok, "PROJECT_MANAGER");
  expect((await ok.request.post("/api/me/devices", { data: { platform: "android", pushToken: `${TOKEN}-d`, appVersion: "1.0.0" } })).status()).toBe(200);
});
