import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { db } from "../db";
import { signIn as fixtureSignIn, signOut as fixtureSignOut, DEMO_USERNAME, type DemoRole } from "../fixtures";
const signIn = fixtureSignIn;
const username = (role: DemoRole) => DEMO_USERNAME[role];
async function signOut(page: import("@playwright/test").Page) {
  if (new URL(page.url()).pathname.startsWith("/admin")) {
    await page.getByRole("button", { name: /^sign out$/i }).click();
    await page.waitForURL(/\/login/);
  } else await fixtureSignOut(page);
}
test.afterAll(() => db.$disconnect());

for (const role of ["OWNER", "SALES", "ARCHITECT", "PROJECT_MANAGER", "GROUP_IT", "PLATFORM_ADMIN"] as DemoRole[]) {
  test(`${role}: refresh, logout, token replay, back and refresh protection`, async ({ page, context, playwright, baseURL }) => {
    await signIn(page, role);
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
    const oldCookies = await context.cookies();
    await signOut(page);
    const replay = await playwright.request.newContext({ baseURL, storageState: { cookies: oldCookies, origins: [] } });
    expect((await replay.get("/api/auth/lifecycle")).status()).toBe(401);
    await replay.dispose();
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
  });
}

test("logout terminates another tab and removes user storage before Sales signs in", async ({ page, context }) => {
  await signIn(page, "OWNER");
  const other = await context.newPage();
  await other.goto(page.url());
  await other.getByRole("button", { name: /open user menu/i }).waitFor();
  await page.evaluate(() => { localStorage.setItem("nesto.test-owner-cache", "owner secret"); sessionStorage.setItem("nesto.test-owner-record", "owner secret"); });
  await signOut(page);
  await expect(other).toHaveURL(/\/login/);
  await signIn(page, "SALES");
  expect(await page.evaluate(() => localStorage.getItem("nesto.test-owner-cache"))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("nesto.test-owner-record"))).toBeNull();
  await signOut(page);
});

test("failed logout request still leaves and blocks reopening the old session", async ({ page }) => {
  await signIn(page, "OWNER");
  await page.route("**/api/auth/lifecycle", (route) => route.request().method() === "POST" ? route.abort() : route.continue());
  await signOut(page);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await page.unroute("**/api/auth/lifecycle");
  await signIn(page, "SALES");
  await signOut(page);
});

test("server expiration rejects API access and sends every tab to login", async ({ page, context }) => {
  await signIn(page, "PROJECT_MANAGER");
  const other = await context.newPage();
  await other.goto(page.url());
  await other.getByRole("button", { name: /open user menu/i }).waitFor();
  const { identity } = await (await page.request.get("/api/auth/lifecycle")).json();
  const rows = await db.session.findMany({ where: { user: { username: username("PROJECT_MANAGER") } }, select: { id: true } });
  const current = rows.find((row) => createHash("sha256").update(row.id).digest("hex") === identity)!;
  expect(current).toBeTruthy();
  await db.session.update({ where: { id: current.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  expect((await page.request.get("/api/me")).status()).toBe(401);
  for (const tab of [page, other]) await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/login\?reason=session-expired/);
  await expect(other).toHaveURL(/\/login\?reason=session-expired/);
  await expect(page.getByRole("status")).toHaveText("Your work session has expired. Please sign in again.");
});

test("storage events synchronize logout without BroadcastChannel", async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(window, "BroadcastChannel", { value: undefined }));
  await signIn(page, "OWNER");
  const other = await context.newPage();
  await other.goto(page.url());
  await other.getByRole("button", { name: /open user menu/i }).waitFor();
  await signOut(page);
  await expect(other).toHaveURL(/\/login/);
});

test("logout from Finance and a nested project route", async ({ page }) => {
  for (const destination of ["/finance", "/projects"]) {
    await signIn(page, "OWNER");
    await page.goto(destination);
    await signOut(page);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("logout cancels pending authenticated fetches", async ({ page }) => {
  await signIn(page, "OWNER");
  await page.route("**/api/me?pending-logout-test", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.abort().catch(() => undefined);
  });
  await page.evaluate(() => { void fetch("/api/me?pending-logout-test").catch(() => undefined); });
  await signOut(page);
  await expect(page).toHaveURL(/\/login/);
});

test("expiration masks an unsaved form and same-user reauthentication restores it", async ({ page, context }) => {
  await signIn(page, "OWNER");
  await page.goto("/settings/profile");
  const firstName = page.locator("#nesto-main #profile-firstName");
  await firstName.fill("Unsaved work shift draft");
  const { identity } = await (await page.request.get("/api/auth/lifecycle")).json();
  const rows = await db.session.findMany({ where: { user: { username: username("OWNER") } }, select: { id: true } });
  const current = rows.find((row) => createHash("sha256").update(row.id).digest("hex") === identity)!;
  await db.session.update({ where: { id: current.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const notice = page.getByTestId("unsaved-context-notice");
  await expect(notice).toHaveAttribute("data-reason", "session-expired");
  await expect(firstName).toBeHidden();
  const other = await context.newPage();
  await signIn(other, "OWNER");
  await expect(notice).not.toHaveAttribute("data-reason", "session-expired");
  if (await page.getByTestId("unsaved-context-return").isVisible()) await page.getByTestId("unsaved-context-return").click();
  await expect(firstName).toBeVisible();
  await expect(firstName).toHaveValue("Unsaved work shift draft");
  await signOut(other);
  await expect(page).toHaveURL(/\/login/);
});

test("logout from the standalone 3D viewer and platform Experience Editor", async ({ page }) => {
  test.setTimeout(120_000);
  const { createSessionViewer } = await import("./3d-session.fixture");
  const viewer = await createSessionViewer(username("OWNER"), username("PLATFORM_ADMIN"));
  try {
    await signIn(page, "OWNER");
    const moved = await page.request.post("/api/workspace", { data: { scopeType: "COMPANY", companyId: viewer.companyId } });
    expect(moved.ok()).toBe(true);
    const ready = page.waitForResponse((response) => response.url().endsWith("/api/auth/lifecycle") && response.status() === 200);
    await page.reload();
    await ready;
    await page.goto(`/projects/${viewer.id}/3d`);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("button", { name: /^sign out$/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await signIn(page, "PLATFORM_ADMIN");
    await page.goto(`/admin/3d/projects/${viewer.id}/editor`);
    await page.getByRole("button", { name: /^sign out$/i }).click();
    await expect(page).toHaveURL(/\/login/);
  } finally { await viewer.remove(); }
});

test.describe("mobile authentication lifecycle", () => {
  test.use({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  test("logout is reachable from the mobile account control", async ({ page }) => {
    await signIn(page, "OWNER");
    await signOut(page);
    await expect(page.getByLabel("Username")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
  });
});
