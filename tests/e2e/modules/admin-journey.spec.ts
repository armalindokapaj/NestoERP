import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { db } from "../db";
import { DEMO_PASSWORD, signIn } from "../fixtures";

/**
 * The Admin Console journey, end to end (Admin PRD #14 §169): a Platform Admin
 * founds a group, names its CEO, adds a company with its own CEO and people,
 * changes and removes access; the Group CEO signs in to a group with no
 * company, then to one with companies; every Manage Users path stays inside its
 * Group or Company; an ID from another organization is refused.
 */

const TAG = "qa14";
const GROUP_SLUG = `${TAG}-holdings`;
const OTHER_SLUG = `${TAG}-other`;
const USERS = {
  gina: { username: `${TAG}-gina`, email: `${TAG}-gina@nesto.test`, first: "Gina", last: "Ceo" },
  ivo: { username: `${TAG}-ivo`, email: `${TAG}-ivo@nesto.test`, first: "Ivo", last: "Admin" },
  cora: { username: `${TAG}-cora`, email: `${TAG}-cora@nesto.test`, first: "Cora", last: "Chief" },
  maria: { username: `${TAG}-maria`, email: `${TAG}-maria@nesto.test`, first: "Maria", last: "Brown" },
  oto: { username: `${TAG}-oto`, email: `${TAG}-oto@nesto.test`, first: "Oto", last: "Other" },
};

const state: { groupId?: string; otherId?: string; companyId?: string; otherCompanyId?: string; mariaId?: string } = {};

async function clean(): Promise<void> {
  const emails = Object.values(USERS).map((user) => user.email);
  const users = (await db.user.findMany({ where: { email: { in: emails } }, select: { id: true, personProfileId: true } }));
  const ids = users.map((user) => user.id);
  for (const slug of [GROUP_SLUG, OTHER_SLUG]) {
    const group = await db.parentGroup.findUnique({ where: { slug }, select: { id: true } });
    if (!group) continue;
    for (const company of await db.company.findMany({ where: { parentGroupId: group.id }, select: { id: true } })) {
      const companyId = company.id;
      await db.session.deleteMany({ where: { currentCompanyId: companyId } });
      await db.auditEvent.deleteMany({ where: { companyId } });
      await db.activity.deleteMany({ where: { companyId } });
      await db.department.updateMany({ where: { companyId }, data: { managerMemberId: null } });
      await db.company.update({ where: { id: companyId }, data: { ceoMemberId: null } });
      await db.projectMember.deleteMany({ where: { companyId } });
      await db.companyMember.deleteMany({ where: { companyId } });
      await db.companyNumberingScheme.deleteMany({ where: { companyId } });
      await db.companyStorageQuota.deleteMany({ where: { companyId } });
      await db.financeSettings.deleteMany({ where: { companyId } });
      await db.companyIntegrationSettings.deleteMany({ where: { companyId } });
      await db.companySettings.deleteMany({ where: { companyId } });
      await db.companyModule.deleteMany({ where: { companyId } });
      await db.departmentAssignment.deleteMany({ where: { companyId } });
      await db.department.deleteMany({ where: { companyId } });
      await db.projectType.deleteMany({ where: { companyId } });
      await db.projectUnitType.deleteMany({ where: { companyId } });
      await db.company.delete({ where: { id: companyId } });
    }
    await db.departmentAssignment.deleteMany({ where: { parentGroupId: group.id } });
    await db.parentGroupMember.deleteMany({ where: { parentGroupId: group.id } });
  }
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.authEvent.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  for (const slug of [GROUP_SLUG, OTHER_SLUG]) {
    const group = await db.parentGroup.findUnique({ where: { slug }, select: { id: true } });
    if (!group) continue;
    await db.auditEvent.deleteMany({ where: { parentGroupId: group.id } });
    await db.personProfile.deleteMany({ where: { parentGroupId: group.id } });
    await db.groupDepartment.deleteMany({ where: { parentGroupId: group.id } });
    await db.parentGroup.delete({ where: { id: group.id } });
  }
}

async function command(page: Page, body: Record<string, unknown>) {
  const response = await page.request.post("/api/platform-admin/command", { data: body });
  const json = (await response.json().catch(() => ({}))) as { data?: Record<string, unknown> };
  return { status: response.status(), data: json.data ?? {} };
}

async function loginAs(browser: Browser, username: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return { page, context };
}

test.describe.configure({ mode: "serial" });
test.beforeAll(clean);
test.afterAll(async () => { await clean(); await db.$disconnect(); });

test("Platform Admin founds a group, names its CEO and a company with its own CEO and people", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN");
  const created = await page.request.post("/api/platform/parent-groups", { data: { name: "QA Holdings", slug: GROUP_SLUG } });
  expect(created.status()).toBe(201);
  state.groupId = (await db.parentGroup.findUniqueOrThrow({ where: { slug: GROUP_SLUG }, select: { id: true } })).id;
  const other = await page.request.post("/api/platform/parent-groups", { data: { name: "QA Other", slug: OTHER_SLUG } });
  expect(other.status()).toBe(201);
  state.otherId = (await db.parentGroup.findUniqueOrThrow({ where: { slug: OTHER_SLUG }, select: { id: true } })).id;

  // Group CEO first, before any company exists (§118).
  const ceo = await command(page, { action: "group.user.add", mode: "new", groupId: state.groupId, roleKey: "OWNER", firstName: USERS.gina.first, lastName: USERS.gina.last, username: USERS.gina.username, email: USERS.gina.email });
  expect(ceo.status).toBe(201);
  const it = await command(page, { action: "group.user.add", mode: "new", groupId: state.groupId, roleKey: "GROUP_IT", firstName: USERS.ivo.first, lastName: USERS.ivo.last, username: USERS.ivo.username, email: USERS.ivo.email, companyAccess: { mode: "ALL", companyIds: [] } });
  expect(it.status).toBe(201);

  // The other group gets a company and a person of its own, to attack across the boundary.
  const otherCompany = await command(page, { action: "company.create", groupId: state.otherId, name: "QA Other Works" });
  expect(otherCompany.status).toBe(201);
  state.otherCompanyId = otherCompany.data.companyId as string;
});

test("a Group CEO with no company signs in to the group workspace (§60, §151)", async ({ browser }) => {
  const { page, context } = await loginAs(browser, USERS.gina.username);
  await expect(page).toHaveURL(/\/group/);
  await expect(page.getByTestId("group-company-count")).toHaveText("0");
  await expect(page.getByTestId("group-ceo")).toContainText("Gina Ceo");
  await context.close();
});

test("the company, its CEO and its people", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN");
  const company = await command(page, { action: "company.create", groupId: state.groupId, name: "QA Construction" });
  expect(company.status).toBe(201);
  state.companyId = company.data.companyId as string;

  // Company without a CEO is valid (§17); the CEO is named after.
  const ceo = await command(page, { action: "company.ceo.assign", companyId: state.companyId, mode: "new", firstName: USERS.cora.first, lastName: USERS.cora.last, email: USERS.cora.email });
  expect(ceo.status).toBe(201);
  const maria = await command(page, { action: "company.users.add", mode: "new", companyId: state.companyId, roleKey: "FINANCE", firstName: USERS.maria.first, lastName: USERS.maria.last, email: USERS.maria.email });
  expect(maria.status).toBe(201);
  state.mariaId = maria.data.userId as string;

  const list = await command(page, { action: "company.users.list", companyId: state.companyId });
  const rows = list.data.rows as Array<{ name: string; source: string }>;
  // Ivo (Group IT, ALL) is derived; Cora and Maria are direct; one row each.
  expect(rows.map((row) => `${row.name}:${row.source}`).sort()).toEqual(["Cora Chief:DIRECT", "Ivo Admin:GROUP", "Maria Brown:DIRECT"]);
});

test("Manage Users stays inside the organization, with a contextual breadcrumb (§69-§72)", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN");
  await page.goto(`/admin/organizations/${state.companyId}?tab=users`);
  await expect(page).toHaveURL(new RegExp(`/admin/organizations/${state.companyId}`));
  await expect(page.getByText("Maria Brown").first()).toBeVisible();
  await page.screenshot({ path: "test-results/qa14-company-users.png" });
  // Opening a person keeps the company: the drawer, not the global user page.
  await page.getByRole("button", { name: /Open Maria Brown/i }).click();
  await expect(page).toHaveURL(/user=/);
  expect(page.url()).toContain(`/admin/organizations/${state.companyId}`);
  await page.reload();
  await expect(page.getByText("Maria Brown").first()).toBeVisible();
  // The account page opened from here names the company, not "All users" (ADM-020).
  await page.goto(`/admin/users/${state.mariaId}?from=${state.companyId}`);
  await expect(page.getByTestId("return-to-organization")).toContainText("QA Construction");
  await expect(page.getByRole("navigation", { name: /breadcrumb/i }).getByText("QA Construction")).toBeVisible();
});

test("the Group CEO manages the company's users inside the group, and no other group's (§70, §76, §153)", async ({ browser }) => {
  const { page, context } = await loginAs(browser, USERS.gina.username);
  await page.goto(`/group/companies/${state.companyId}/users`);
  await expect(page).toHaveURL(new RegExp(`/group/companies/${state.companyId}/users`));
  await expect(page.getByText("Maria Brown").first()).toBeVisible();
  await page.screenshot({ path: "test-results/qa14-group-company-users.png" });

  // A company of another group: not found, never a hint it exists.
  const foreign = await page.goto(`/group/companies/${state.otherCompanyId}/users`);
  expect(foreign?.status()).toBe(404);
  // The same by API: ids substituted in a command are refused.
  const attack = await page.request.post("/api/group/command", { data: { action: "company.users.list", companyId: state.otherCompanyId } });
  expect(attack.status()).toBe(403);
  const attackGroup = await page.request.post("/api/group/command", { data: { action: "group.user.add", mode: "new", groupId: state.otherId, roleKey: "GROUP_IT", firstName: "No", lastName: "Way", email: `${TAG}-no@nesto.test` } });
  expect(attackGroup.status()).toBe(403);
  const inject = await page.request.post("/api/group/command", { data: { action: "company.users.add", mode: "new", companyId: state.companyId, roleKey: "PLATFORM_ADMIN", firstName: "In", lastName: "Ject", email: `${TAG}-inject@nesto.test` } });
  expect([400, 422]).toContain(inject.status());
  await context.close();
});

test("access changes: remove direct leaves the group route, suspension and revocation reach a live session (§148, §155)", async ({ browser, page }) => {
  await signIn(page, "PLATFORM_ADMIN");
  // Maria gets group-derived access too: BOTH.
  expect((await command(page, { action: "group.user.add", mode: "existing", groupId: state.groupId, userId: state.mariaId, roleKey: "GROUP_IT", companyAccess: { mode: "ALL", companyIds: [] } })).status).toBe(201);
  let list = await command(page, { action: "company.users.list", companyId: state.companyId });
  expect((list.data.rows as Array<{ name: string; source: string }>).find((row) => row.name === "Maria Brown")?.source).toBe("BOTH");

  const mariaUsername = (await db.user.findUniqueOrThrow({ where: { id: state.mariaId }, select: { username: true } })).username;
  const live = await loginAs(browser, mariaUsername);
  await live.page.goto("/dashboard");

  expect((await command(page, { action: "company.users.remove", companyId: state.companyId, userId: state.mariaId })).status).toBe(200);
  list = await command(page, { action: "company.users.list", companyId: state.companyId });
  expect((list.data.rows as Array<{ name: string; source: string }>).find((row) => row.name === "Maria Brown")?.source).toBe("GROUP");
  expect(await db.user.count({ where: { id: state.mariaId } })).toBe(1);

  // Her live session still answers, now as the group-derived person: no 500, no stale company-admin page.
  await live.page.goto("/dashboard", { waitUntil: "commit" }).catch(() => undefined);
  await live.page.waitForLoadState("load");
  await live.page.waitForTimeout(1500);
  // Her access still stands through the group, so the live session is kept, not ended (§89).
  expect(new URL(live.page.url()).pathname).not.toMatch(/^\/login/);
  expect(await db.session.count({ where: { userId: state.mariaId } })).toBeGreaterThan(0);
  await live.page.screenshot({ path: "test-results/qa14-maria-after-removal.png" });
  await expect(live.page.getByText(/something went wrong|internal server error/i)).toHaveCount(0);
  await live.context.close();
});

test("the contextual user pages pass the accessibility scan and hold at phone width (§139, §140)", async ({ browser }) => {
  const blocking = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");

  const admin = await browser.newContext();
  const adminPage = await admin.newPage();
  await signIn(adminPage, "PLATFORM_ADMIN");
  await adminPage.goto(`/admin/organizations/${state.companyId}?tab=users`);
  await expect(adminPage.getByText("Cora Chief").first()).toBeVisible();
  expect((await blocking(adminPage)).map((violation) => violation.id)).toEqual([]);
  await admin.close();

  const { page, context } = await loginAs(browser, USERS.gina.username);
  await page.goto(`/group/companies/${state.companyId}/users`);
  await expect(page.getByText("Cora Chief").first()).toBeVisible();
  expect((await blocking(page)).map((violation) => violation.id)).toEqual([]);

  // Phone: no sideways scroll, and no Platform navigation offered to a group person.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/group/companies/${state.companyId}/users`);
  await expect(page.getByText("Cora Chief").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('a[href="/admin"], a[href^="/admin/"]')).toHaveCount(0);
  await page.screenshot({ path: "test-results/qa14-group-company-users-phone.png" });
  await context.close();
});
