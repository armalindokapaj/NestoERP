import { expect, test, type Browser, type Page } from "@playwright/test";

import { db } from "../db";
import { DEMO_PASSWORD, signIn } from "../fixtures";

/**
 * The universal header on the surfaces that have no company (UI-01 §13, AC-02,
 * AC-23, AC-39): Platform Admin and a group-only CEO get the same three controls
 * in the same order, an account panel whose every entry opens a real page, and a
 * sign-out that ends the session.
 */

const TAG = "ui01";
const SLUG = `${TAG}-holdings`;
const USER = { username: `${TAG}-gina`, email: `${TAG}-gina@nesto.test`, first: "Gina", last: "Header" };

async function clean(): Promise<void> {
  const users = await db.user.findMany({ where: { email: USER.email }, select: { id: true, personProfileId: true } });
  const ids = users.map((user) => user.id);
  const group = await db.parentGroup.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (group) {
    await db.departmentAssignment.deleteMany({ where: { parentGroupId: group.id } });
    await db.parentGroupMember.deleteMany({ where: { parentGroupId: group.id } });
  }
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.authEvent.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  if (group) {
    await db.auditEvent.deleteMany({ where: { parentGroupId: group.id } });
    await db.personProfile.deleteMany({ where: { parentGroupId: group.id } });
    await db.groupDepartment.deleteMany({ where: { parentGroupId: group.id } });
    await db.parentGroup.delete({ where: { id: group.id } });
  }
}

/** Search, Notifications and Account, left to right, each a real target at the right edge of the bar. */
async function expectCluster(page: Page) {
  const cluster = page.getByTestId("global-actions");
  await expect(cluster).toBeVisible();
  const controls = [cluster.getByRole("button", { name: /^search/i }), cluster.getByTestId("notification-bell"), cluster.getByTestId("account-trigger")];
  const boxes = [];
  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);
    boxes.push(box!);
  }
  expect(boxes[0].x).toBeLessThan(boxes[1].x);
  expect(boxes[1].x).toBeLessThan(boxes[2].x);
}

async function accountPanel(page: Page) {
  await page.getByTestId("account-trigger").click();
  const panel = page.getByTestId("account-panel");
  await expect(panel).toBeVisible();
  return panel;
}

async function exercisePanel(page: Page, prefix: "/admin" | "/group") {
  const panel = await accountPanel(page);
  // Every entry has a real destination; none is a placeholder.
  for (const [testId, path] of [["account-help", `${prefix}/help`], ["account-whats-new", `${prefix}/whats-new`], ["account-profile", `${prefix}/account`]] as const) {
    await expect(panel.getByTestId(testId)).toHaveAttribute("href", path);
  }
  // No billing entry, and no workspace switch: that lives in the sidebar header.
  await expect(panel.getByRole("link", { name: /billing/i })).toHaveCount(0);
  await expect(panel.getByTestId("account-switch-workspace")).toHaveCount(0);

  // Appearance is a radio group and applies at once, without a reload.
  await panel.getByTestId("account-theme-dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(panel.getByTestId("account-theme-dark")).toHaveAttribute("aria-checked", "true");
  await panel.getByTestId("account-theme-light").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(panel.getByTestId("account-theme-light")).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByTestId("account-theme-system")).toHaveCount(0);

  // One universal overlay at a time: opening Search closes Account.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.getByTestId("notification-bell").click();
  await expect(page.getByTestId("activity-panel")).toBeVisible();
  await expect(page.getByTestId("activity-panel")).toContainText(/no notifications/i);
  await page.keyboard.press("Escape");

  // Help and What's New open real pages inside the same shell.
  await (await accountPanel(page)).getByTestId("account-help").click();
  await expect(page).toHaveURL(new RegExp(`${prefix}/help$`));
  await expect(page.getByTestId("surface-help")).toBeVisible();
  await expectCluster(page);
  await (await accountPanel(page)).getByTestId("account-whats-new").click();
  await expect(page).toHaveURL(new RegExp(`${prefix}/whats-new$`));
  await expect(page.getByTestId("whats-new")).toBeVisible();
  await expectCluster(page);
}

async function expectSignedOut(page: Page) {
  await (await accountPanel(page)).getByTestId("account-sign-out").click();
  await page.waitForURL(/\/login/);
  // Back must not bring the protected page back.
  await page.goBack();
  await expect(page.getByTestId("account-trigger")).toHaveCount(0);
}

test.describe.configure({ mode: "serial" });
test.beforeAll(clean);
test.afterAll(async () => {
  await clean();
  await db.$disconnect();
});

test("Platform Admin: the dashboard and its pages carry the same cluster and a working account panel", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN");
  for (const path of ["/admin", "/admin/organizations", "/admin/users", "/admin/audit"]) {
    await page.goto(path);
    await expectCluster(page);
  }
  await page.goto("/admin");
  const panel = await accountPanel(page);
  await expect(panel.getByTestId("account-context")).toContainText("Platform Admin");
  await page.keyboard.press("Escape");
  await exercisePanel(page, "/admin");

  // Search opens from the cluster and from Ctrl+K, and finds a platform entity.
  await page.getByTestId("admin-search-trigger").click();
  await expect(page.getByTestId("admin-search")).toBeVisible();
  await page.keyboard.press("Escape");
  await expectSignedOut(page);
});

test("a group-only CEO has the cluster, a group-scoped search and the same panel", async ({ page, browser }: { page: Page; browser: Browser }) => {
  await signIn(page, "PLATFORM_ADMIN");
  expect((await page.request.post("/api/platform/parent-groups", { data: { name: "UI Holdings", slug: SLUG } })).status()).toBe(201);
  const groupId = (await db.parentGroup.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })).id;
  const added = await page.request.post("/api/platform-admin/command", {
    data: { action: "group.user.add", mode: "new", groupId, roleKey: "OWNER", firstName: USER.first, lastName: USER.last, username: USER.username, email: USER.email },
  });
  expect(added.status()).toBe(201);

  const context = await browser.newContext();
  const gina = await context.newPage();
  await gina.goto("/login");
  await gina.getByLabel("Username").fill(USER.username);
  await gina.getByLabel("Password").fill(DEMO_PASSWORD);
  await gina.locator("form").getByRole("button", { name: /sign in/i }).click();
  await gina.waitForURL(/\/group/);

  await expectCluster(gina);
  const panel = await accountPanel(gina);
  await expect(panel.getByTestId("account-name")).toHaveText("Gina Header");
  await expect(panel.getByTestId("account-context")).toContainText("UI Holdings");
  await gina.keyboard.press("Escape");

  // The group's search answers for this group only, and refuses everyone else.
  const own = await gina.request.get("/api/group/search?q=Gina");
  expect(own.status()).toBe(200);
  expect(((await own.json()) as { data: { title: string }[] }).data.map((row) => row.title)).toContain("Gina Header");
  await gina.getByTestId("admin-search-trigger").click();
  await gina.getByRole("combobox").fill("Gina");
  await expect(gina.getByRole("option", { name: /Gina Header/ })).toBeVisible();
  await gina.keyboard.press("Escape");
  const tooShort = await gina.request.get("/api/group/search?q=g");
  expect(((await tooShort.json()) as { data: unknown[] }).data).toEqual([]);
  expect((await page.request.get("/api/group/search?q=Gina")).status(), "a platform session is not a group session").toBe(403);

  await exercisePanel(gina, "/group");
  await expectSignedOut(gina);
  await context.close();
});
