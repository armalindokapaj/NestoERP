import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

import { db, removeRecordTrail, removeTestTasks } from "../db";
import { mainRegion, signIn, signOut } from "../fixtures";

/**
 * PRD #38 critical workflows (§144).
 *
 * The notification worker is a separate process in every environment, so the
 * specs run it the same way an operator would — one pass of the real script —
 * rather than waiting on a schedule or calling its code in-process.
 */

const MARKER = `e2e-prd38-${Date.now()}`;
const TASK_PREFIX = "E2E prd38";

function runWorker(args: string[]) {
  execFileSync("npx", ["tsx", ...args], { stdio: "pipe", env: process.env, timeout: 120_000 });
}
const dispatchNotifications = () => runWorker(["scripts/notifications.ts", "--limit=500"]);

async function runJob(job: string) {
  await db.workerHeartbeat.updateMany({ where: { job }, data: { nextRunAt: null, leaseOwner: null, leaseExpiresAt: null } });
  runWorker(["scripts/worker.ts", "--once", `--job=${job}`]);
}

async function openBell(page: Page) {
  await page.getByTestId("notification-bell").click();
  return page.getByRole("menu");
}

test.afterAll(async () => {
  // Comments this run wrote on seeded records, and what they caused.
  const comments = await db.comment.findMany({ where: { body: { contains: MARKER } }, select: { id: true, threadId: true } });
  if (comments.length > 0) {
    await db.mention.deleteMany({ where: { commentId: { in: comments.map((row) => row.id) } } });
    await db.comment.deleteMany({ where: { id: { in: comments.map((row) => row.id) } } });
    for (const threadId of new Set(comments.map((row) => row.threadId))) {
      const remaining = await db.comment.count({ where: { threadId, archivedAt: null } });
      await db.collaborationThread.update({ where: { id: threadId }, data: { commentCount: remaining } });
    }
  }
  await db.notification.deleteMany({ where: { title: { contains: TASK_PREFIX } } });
  await removeTestTasks(TASK_PREFIX);
  await db.$disconnect();
});

test("PM mentions the Engineer on a task, and the bell takes the Engineer there (§144)", async ({ page }) => {
  const since = new Date();
  await signIn(page, "PROJECT_MANAGER", { to: "/tasks/task_006" });

  const composer = page.getByPlaceholder("Add a comment. Type @ to mention someone.");
  await expect(composer).toBeVisible();
  await composer.fill(`Can you check the loading ${MARKER} @Eth`);
  await page.getByRole("listbox", { name: "People you can mention" }).getByRole("option", { name: /Ethan Cole/ }).click();
  await composer.press("End");
  await composer.type(" before Friday?");
  await page.getByRole("button", { name: "Comment", exact: true }).click();

  await expect(mainRegion(page).getByText(MARKER)).toBeVisible();
  await expect(mainRegion(page).getByText("@Ethan Cole").first()).toBeVisible();
  await signOut(page);

  dispatchNotifications();

  await signIn(page, "ENGINEER", { to: "/dashboard" });
  await expect(page.getByTestId("notification-badge")).toBeVisible();
  const menu = await openBell(page);
  const item = menu.getByRole("menuitem", { name: /Alex Morgan mentioned you/ }).first();
  await expect(item).toBeVisible();
  await item.click();
  await page.waitForURL(/\/tasks\/task_006$/);
  await expect(mainRegion(page).getByText(MARKER)).toBeVisible();

  // The mention notification, once followed, is read.
  const mention = await db.notification.findFirst({
    where: { recipientMemberId: "member_engineer", eventType: "COMMENT_MENTIONED", createdAt: { gte: since } },
  });
  expect(mention?.readState).toBe("READ");
  await db.notification.deleteMany({ where: { entityType: "task", entityId: "task_006", createdAt: { gte: since } } });
});

test("Sales raises a follow-up task that stays tied to its opportunity (§47, §144)", async ({ page }) => {
  await signIn(page, "SALES", { to: "/sales/opportunities/opportunity_001" });

  await mainRegion(page).getByRole("link", { name: "Create task" }).first().click();
  await page.waitForURL(/\/tasks\/new\?parentType=opportunity/);
  await expect(page.getByText("Opportunity · Riverside phase 2")).toBeVisible();

  const title = `${TASK_PREFIX} follow-up call`;
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create task" }).click();
  await page.waitForURL(/\/tasks\/[^/?]+$/);

  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(mainRegion(page).getByRole("link", { name: "Riverside phase 2" })).toBeVisible();

  const task = await db.task.findFirst({ where: { title }, select: { module: true, entityType: true, entityId: true } });
  expect(task).toEqual({ module: "sales", entityType: "opportunity", entityId: "opportunity_001" });

  // And the opportunity lists it.
  await page.goto("/sales/opportunities/opportunity_001");
  await expect(mainRegion(page).getByRole("link", { name: title })).toBeVisible();
});

test("Legal sends a contract document for review and the Owner approves it (§59-§63, §144)", async ({ page }) => {
  const since = new Date();
  const version = await db.documentVersion.findFirstOrThrow({ where: { documentId: "document_contract_01", versionNumber: 1 } });

  try {
    await signIn(page, "LEGAL", { to: "/documents/document_contract_01" });
    const versions = mainRegion(page).getByTestId("document-version-1");
    await expect(versions).toBeVisible();
    await versions.getByRole("button", { name: "Request review" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Reviewer" }).fill("Olivia");
    await dialog.getByRole("radio", { name: /Olivia Owner/ }).check();
    await dialog.getByLabel("Note").fill(`Please confirm the signed copy ${MARKER}`);
    await dialog.getByRole("button", { name: "Send for review" }).click();
    await expect(versions.getByText("In review")).toBeVisible();
    await signOut(page);

    dispatchNotifications();

    await signIn(page, "OWNER", { to: "/dashboard" });
    const menu = await openBell(page);
    await menu.getByRole("menuitem", { name: /asked you to review/ }).first().click();
    // A review opens in the Approvals Center's drawer first, with the document one link away (PRD #41 §42).
    await page.waitForURL(/\/approvals\?approval=documents%3A/);
    await page.getByTestId("approval-detail").getByRole("link", { name: "Open full document" }).click();
    await page.waitForURL(/\/documents\/document_contract_01$/);

    const row = mainRegion(page).getByTestId("document-version-1");
    await row.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(row.getByText("Approved").first()).toBeVisible();

    expect((await db.documentVersion.findUniqueOrThrow({ where: { id: version.id } })).reviewState).toBe("APPROVED");
  } finally {
    await db.documentReview.deleteMany({ where: { documentVersionId: version.id, requestedAt: { gte: since } } });
    await db.documentVersion.update({ where: { id: version.id }, data: { reviewState: version.reviewState, supersededAt: version.supersededAt } });
    await db.notification.deleteMany({ where: { entityType: "document", entityId: "document_contract_01", createdAt: { gte: since } } });
    await db.notificationEventOutbox.deleteMany({ where: { entityType: "document", entityId: "document_contract_01", createdAt: { gte: since } } });
  }
});

test("topbar search finds a project with the keyboard alone (§87-§90)", async ({ page }) => {
  await signIn(page, "OWNER", { to: "/dashboard" });

  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByRole("combobox", { name: "Search NESTO" });
  await expect(input).toBeFocused();
  await input.fill("Riverside");

  const results = page.getByRole("listbox", { name: "Search results" });
  await expect(results.getByRole("option", { name: /^Riverside Residences/ })).toBeVisible();
  // Arrow to the project and open it.
  const options = results.getByRole("option");
  const count = await options.count();
  // Other records mention the project in their subtitle; the project's own
  // result is the one whose title is its name.
  for (let index = 0; index < count; index += 1) {
    if (((await options.nth(index).textContent()) ?? "").trim().startsWith("Riverside Residences")) break;
    await input.press("ArrowDown");
  }
  await expect(results.getByRole("option", { selected: true })).toContainText("Riverside Residences");
  await input.press("Enter");
  await page.waitForURL(/\/projects\/project_a/);
});

test("search shows the Viewer nothing from modules it cannot open (§89)", async ({ page }) => {
  await signIn(page, "VIEWER", { to: "/dashboard" });
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search NESTO" }).fill("INV-2026");
  await expect(page.getByText(/Nothing you can open matches/)).toBeVisible();
});

test("the dashboard shows the Engineer their own overdue work, linked (§83, §86)", async ({ page }) => {
  await runJob("attention.reconcile");

  await signIn(page, "ENGINEER", { to: "/dashboard" });
  const link = mainRegion(page).getByRole("link", { name: /Overdue: Technical issue response/ });
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(/\/tasks\/task_024$/);

  await page.goto("/notifications?tab=attention");
  await expect(mainRegion(page).getByTestId("attention-item").filter({ hasText: "Technical issue response" })).toBeVisible();
});

test("a notification about a record the reader cannot open says only that it is unavailable (§82)", async ({ page }) => {
  const row = await db.notification.create({
    data: {
      companyId: "company_demo_a",
      recipientMemberId: "member_viewer",
      eventType: "LEAVE_DECIDED",
      category: "hr",
      moduleKey: "hr",
      title: `${TASK_PREFIX} probe`,
      priority: "NORMAL",
      entityType: "employee",
      entityId: "member_owner",
      dedupeKey: `${MARKER}:unavailable`,
    },
  });

  await signIn(page, "VIEWER", { to: `/notifications/${row.id}/open` });
  await expect(page.getByTestId("notification-unavailable")).toBeVisible();
  await expect(page.getByText("Olivia Owner")).toHaveCount(0);
  expect(page.url()).toContain(`/notifications/${row.id}/open`);
});

test("notification preferences save, and critical safety alerts stay on (§78)", async ({ page }) => {
  try {
    await signIn(page, "ENGINEER", { to: "/settings/notifications" });
    const hse = mainRegion(page).getByTestId("preference-hse");
    await expect(hse.getByRole("switch", { name: /HSE — In the app/ })).toBeDisabled();

    const tasks = mainRegion(page).getByTestId("preference-tasks").getByRole("switch", { name: /Tasks — In the app/ });
    await expect(tasks).toBeChecked();
    await tasks.click();
    await expect(page.getByText("Preference saved.")).toBeVisible();
    await expect(tasks).not.toBeChecked();

    const saved = await db.notificationPreference.findFirst({ where: { memberId: "member_engineer", category: "tasks" } });
    expect(saved?.inAppEnabled).toBe(false);
  } finally {
    await db.notificationPreference.deleteMany({ where: { memberId: "member_engineer", category: "tasks" } });
  }
});

test("the Viewer reads a discussion but is offered no way to write in it (§127)", async ({ page }) => {
  await signIn(page, "VIEWER", { to: "/tasks/task_006" });
  await expect(mainRegion(page).getByRole("heading", { name: "Discussion" })).toBeVisible();
  await expect(page.getByPlaceholder("Add a comment. Type @ to mention someone.")).toHaveCount(0);
});

test.describe("records clean up after themselves", () => {
  test("removes the trail of the tasks this spec created", async () => {
    const tasks = await db.task.findMany({ where: { title: { startsWith: TASK_PREFIX } }, select: { id: true } });
    await removeRecordTrail("task", tasks.map((task) => task.id));
    expect(await db.collaborationThread.count({ where: { parentType: "task", parentId: { in: tasks.map((task) => task.id) } } })).toBe(0);
  });
});
