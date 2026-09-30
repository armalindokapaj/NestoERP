import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

import { db, removeTestTasks } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { expectNoPageOverflow, outsideProjects } from "./geometry";

/**
 * MOB-06 daily work: My Day, the atomic task claim and its race, the claim
 * button on a phone. Real identities through the login form; every task is
 * created through the API and removed afterwards (prefix `mob06_`).
 */

const PREFIX = "mob06_";
const PROJECT = "project_a";
const SIZES = /^aud04-(phone-320|phone-360|phone-390|tablet-768|desktop-1280)$/;

test.beforeEach(async ({}, testInfo) => {
  test.skip(outsideProjects(testInfo, SIZES), "MOB-06 runs at 320, 390, 768 and 1280.");
});

test.afterAll(async () => {
  await removeTestTasks(PREFIX);
  await db.$disconnect();
});

async function createTask(page: Page, testInfo: TestInfo, label: string, extra: Record<string, unknown> = {}) {
  const title = `${PREFIX}${label} ${testInfo.project.name} ${Date.now().toString(36)}`;
  const response = await page.request.post("/api/tasks", { data: { title, projectId: PROJECT, status: "TODO", priority: "MEDIUM", ...extra } });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { data: { id: string; version: number } };
  return { id: body.data.id, title, version: body.data.version };
}

async function session(browser: Browser, role: "OWNER" | "PROJECT_MANAGER"): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

test("a claim is atomic: the first claimant wins, the second is told who won", async ({ browser, page }, testInfo) => {
  await signIn(page, "PROJECT_MANAGER");
  const task = await createTask(page, testInfo, "race");
  expect(await db.task.findUnique({ where: { id: task.id }, select: { assigneeMemberId: true } })).toEqual({ assigneeMemberId: null });

  const owner = await session(browser, "OWNER");
  // Both hold the version they opened; fired together, exactly one may win.
  const [a, b] = await Promise.all([
    page.request.post(`/api/tasks/${task.id}/claim`, { data: { expectedVersion: task.version } }),
    owner.request.post(`/api/tasks/${task.id}/claim`, { data: { expectedVersion: task.version } }),
  ]);
  const statuses = [a.status(), b.status()].sort();
  expect(statuses).toEqual([200, 409]);
  const loser = a.status() === 409 ? a : b;
  expect(await loser.text()).toContain("This task was claimed by another user.");

  const row = await db.task.findUnique({ where: { id: task.id }, select: { assigneeMemberId: true, version: true } });
  expect(row?.assigneeMemberId).not.toBeNull();
  expect(row?.version).toBe(task.version + 1);

  // Claiming what is already yours is unchanged, not a second success.
  const winner = a.status() === 200 ? page : owner;
  const again = await winner.request.post(`/api/tasks/${task.id}/claim`, { data: { expectedVersion: row!.version } });
  expect(again.status()).toBe(200);
  expect((await db.task.findUnique({ where: { id: task.id }, select: { version: true } }))?.version).toBe(row!.version);
  await owner.context().close();
});

test("the Claim button appears on an unassigned task, claims it and goes away", async ({ page }, testInfo) => {
  await signIn(page, "PROJECT_MANAGER");
  const task = await createTask(page, testInfo, "button");
  await page.goto(`/tasks/${task.id}`);
  const claim = mainRegion(page).getByRole("button", { name: "Claim", exact: true });
  await expect(claim).toBeVisible();
  await claim.click();
  await expect(page.getByText("Task claimed. It is yours now.").first()).toBeVisible();
  await expect(claim).toHaveCount(0);
  expect((await db.task.findUnique({ where: { id: task.id }, select: { assigneeMemberId: true } }))?.assigneeMemberId).not.toBeNull();
});

test("My Day lists overdue work and keeps its counters in step with the task", async ({ page }, testInfo) => {
  await signIn(page, "PROJECT_MANAGER");
  const me = await page.request.get("/api/me");
  expect(me.ok()).toBeTruthy();
  const task = await createTask(page, testInfo, "overdue");
  const claimed = await page.request.post(`/api/tasks/${task.id}/claim`, { data: { expectedVersion: task.version } });
  expect(claimed.status()).toBe(200);
  const yesterday = new Date(Date.now() - 3 * 86_400_000).toISOString();
  await db.task.update({ where: { id: task.id }, data: { dueDate: yesterday } });

  const before = (await (await page.request.get("/api/my-day")).json()) as { data: { counters: { tasksOverdue: number } } };
  expect(before.data.counters.tasksOverdue).toBeGreaterThanOrEqual(1);

  await page.goto("/my-day");
  const region = mainRegion(page);
  await expect(region.getByTestId("my-day")).toBeVisible();
  await expect(region.getByTestId("my-day-attention")).toContainText(/overdue/i);
  await expect(region.getByTestId("my-day-tasks").getByRole("link", { name: new RegExp(task.title) })).toBeVisible();
  await expectNoPageOverflow(page);

  // The direct date edit above moved the version (the trigger bumps it), so read the current one.
  const current = await db.task.findUniqueOrThrow({ where: { id: task.id }, select: { version: true } });
  const complete = await page.request.post(`/api/tasks/${task.id}/complete`, { data: { expectedVersion: current.version } });
  expect(complete.status(), await complete.text()).toBe(200);
  const after = (await (await page.request.get("/api/my-day")).json()) as { data: { counters: { tasksOverdue: number } } };
  expect(after.data.counters.tasksOverdue).toBe(before.data.counters.tasksOverdue - 1);
});

test("My Day opens from the dashboard and never scrolls sideways", async ({ page }) => {
  await signIn(page, "ARCHITECT");
  await page.goto("/dashboard");
  await mainRegion(page).getByTestId("open-my-day").click();
  await page.waitForURL(/\/my-day$/);
  await expect(mainRegion(page).getByTestId("my-day-counters")).toBeVisible();
  await expectNoPageOverflow(page);
});

test("My Tasks offers Today / Upcoming / All and keeps the current view marked", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER");
  await page.goto("/tasks/my-tasks");
  const views = mainRegion(page).getByTestId("my-tasks-views");
  await expect(views.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  await views.getByRole("link", { name: "Upcoming" }).click();
  await page.waitForURL(/due=next7/);
  await expect(mainRegion(page).getByTestId("my-tasks-views").getByRole("link", { name: "Upcoming" })).toHaveAttribute("aria-current", "page");
  await expectNoPageOverflow(page);
});

test("a task completes from its My Day row and the counters follow", async ({ page }, testInfo) => {
  await signIn(page, "PROJECT_MANAGER");
  const task = await createTask(page, testInfo, "quick");
  expect((await page.request.post(`/api/tasks/${task.id}/claim`, { data: { expectedVersion: task.version } })).status()).toBe(200);
  await db.task.update({ where: { id: task.id }, data: { dueDate: new Date(Date.now() - 2 * 86_400_000).toISOString() } });

  await page.goto("/my-day");
  const button = mainRegion(page).getByRole("button", { name: `Complete: ${task.title}` });
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveCount(0);
  expect((await db.task.findUnique({ where: { id: task.id }, select: { status: true } }))?.status).toBe("COMPLETED");
});

test("My Day and the notification centre have no accessibility violations", async ({ page }) => {
  await signIn(page, "ARCHITECT");
  for (const path of ["/my-day", "/notifications"]) {
    await page.goto(path);
    await expect(mainRegion(page).getByRole("heading").first()).toBeVisible();
    const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`), path).toEqual([]);
  }
});

test("the notification centre groups New above Earlier without sideways scroll", async ({ page }) => {
  await signIn(page, "ARCHITECT");
  await page.goto("/notifications");
  await expect(mainRegion(page).getByTestId("notification-center-list").or(mainRegion(page).getByText(/no notifications|all caught up|nothing/i)).first()).toBeVisible();
  const fresh = mainRegion(page).getByTestId("notification-section-new");
  const earlier = mainRegion(page).getByTestId("notification-section-earlier");
  if ((await fresh.count()) && (await earlier.count())) {
    const a = await fresh.boundingBox();
    const b = await earlier.boundingBox();
    expect(a!.y).toBeLessThan(b!.y);
  }
  await expectNoPageOverflow(page);
});

const ROLES = ["OWNER", "CEO", "PROJECT_MANAGER", "ARCHITECT", "ARCHITECTURE_HEAD", "SALES", "FINANCE_A", "PROCUREMENT", "ENGINEER", "VIEWER", "MULTI_COMPANY"] as const;

for (const role of ROLES) {
  test(`My Day loads for ${role} with no failed section and keeps each person's own data`, async ({ page }) => {
    await signIn(page, role);
    const api = await page.request.get("/api/my-day");
    expect(api.status(), await api.text()).toBe(200);
    const body = (await api.json()) as { data: { tasks: { status: string }; approvals: { status: string }; events: { status: string } } };
    for (const name of ["tasks", "approvals", "events"] as const) expect(body.data[name].status, `${role} ${name}`).not.toBe("error");

    await page.goto("/my-day");
    await expect(mainRegion(page).getByTestId("my-day")).toBeVisible();
    await expect(mainRegion(page).locator('[data-testid$="-error"]')).toHaveCount(0);
    await expectNoPageOverflow(page);
  });
}

test("switching identity shows the new person's day, nothing of the previous one", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER");
  const pm = (await (await page.request.get("/api/my-day")).json()) as { data: { tasks: { data?: { overdue: { id: string }[] } } } };
  await page.context().clearCookies();
  await signIn(page, "VIEWER");
  const viewer = (await (await page.request.get("/api/my-day")).json()) as { data: { tasks: { data?: { overdue: { id: string }[] } } } };
  const pmIds = new Set((pm.data.tasks.data?.overdue ?? []).map((task) => task.id));
  for (const task of viewer.data.tasks.data?.overdue ?? []) expect(pmIds.has(task.id), "a task of the previous person leaked").toBe(false);
});
