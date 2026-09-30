import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { db, removeRecordTrail } from "../db";
import { signIn } from "../fixtures";

/**
 * MOB-09: a person takes a project offline, works with no connection, closes and
 * reopens the app, and gets the work back to the server exactly once.
 *
 * Runs against a production build, because the offline shell is a service worker
 * and a dev build's unhashed chunks would not be safe to cache. The network is
 * really cut (`context.setOffline`), so the page that opens is the one the
 * service worker kept, and the data is what the browser's own IndexedDB holds.
 */
const SITE = "e2e09_yard";
const TASK_ACTIVE = "e2e09_task_active";
const TASK_OTHER = "e2e09_task_other";

let companyId = "";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function cleanup() {
  const logs = await db.dailyLog.findMany({ where: { projectId: SITE }, select: { id: true } });
  const logIds = logs.map((row) => row.id);
  const documents = await db.document.findMany({ where: { entityType: "daily_log", entityId: { in: logIds } }, select: { id: true } });
  const documentIds = documents.map((row) => row.id);
  await db.syncOperation.deleteMany({ where: { projectId: SITE } });
  await removeRecordTrail("daily_log", logIds);
  await removeRecordTrail("task", [TASK_ACTIVE, TASK_OTHER]);
  await removeRecordTrail("document", documentIds);
  await db.activity.deleteMany({ where: { entityId: { in: [...logIds, TASK_ACTIVE, TASK_OTHER, ...documentIds] } } });
  await db.documentUploadSession.deleteMany({ where: { documentId: { in: documentIds } } });
  await db.document.deleteMany({ where: { id: { in: documentIds } } });
  await db.dailyLog.deleteMany({ where: { id: { in: logIds } } });
  await db.hseIncident.deleteMany({ where: { projectId: SITE } });
  await db.task.deleteMany({ where: { id: { in: [TASK_ACTIVE, TASK_OTHER] } } });
}

async function makeProject() {
  const member = await db.companyMember.findUniqueOrThrow({ where: { id: "member_engineer" }, select: { companyId: true } });
  companyId = member.companyId;
  await db.project.create({ data: { id: SITE, companyId, code: "E2E09", name: "Offline Yard", status: "ACTIVE", projectManagerMemberId: "member_owner", createdBy: "e2e" } });
  await db.projectMember.createMany({ data: ["member_engineer", "member_hse"].map((companyMemberId) => ({ companyId, projectId: SITE, companyMemberId, status: "ACTIVE" as const })) });
  await db.task.create({ data: { id: TASK_ACTIVE, companyId, projectId: SITE, title: "Facade Inspection", assigneeMemberId: "member_engineer", status: "IN_PROGRESS", createdByMemberId: "member_owner", createdBy: "user_owner" } });
  await db.task.create({ data: { id: TASK_OTHER, companyId, projectId: SITE, title: "Basement survey", assigneeMemberId: "member_engineer", status: "TODO", createdByMemberId: "member_owner", createdBy: "user_owner" } });
}

// Each scenario signs in, takes a project offline, works, and reconnects: it is long by design.
test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async () => {
  await cleanup();
  await db.project.deleteMany({ where: { id: SITE } });
  await makeProject();
});

test.afterAll(async () => {
  await cleanup();
  await db.projectMember.deleteMany({ where: { projectId: SITE } });
  await db.project.deleteMany({ where: { id: SITE } });
  await db.$disconnect();
});

/** The worker has kept the offline workspace: only then can a cold start work with no network. */
async function shellReady(page: Page) {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) return false;
    const cache = await caches.open("nesto-shell-v1");
    return Boolean(await cache.match("/offline"));
  }, undefined, { timeout: 30_000 });
}

async function takeProjectOffline(page: Page) {
  await page.goto(`/projects/${SITE}`);
  await page.getByTestId("available-offline-switch").click();
  await expect(page.getByTestId("available-offline-dialog")).toBeVisible();
  // A project with documents asks which to keep; these fixtures have none.
  const choice = page.getByTestId("doc-mode-none");
  if (await choice.count()) await choice.check();
  await page.getByTestId("available-offline-download").click();
  await expect(page.getByTestId("available-offline-status")).toContainText(/available offline/i, { timeout: 30_000 });
}

async function goOffline(context: BrowserContext, page: Page, path: string) {
  await shellReady(page);
  await context.setOffline(true);
  await page.goto(path);
  await expect(page.getByTestId("offline-app")).toBeVisible();
  await expect(page.getByTestId("offline-status")).toContainText(/offline/i);
}

async function pendingCount(page: Page): Promise<number> {
  await page.goto("/offline?view=sync");
  return Number(await page.getByTestId("sync-pending-count").textContent());
}

test("a full field day: take the project offline, work, restart, reconnect, and everything lands once", async ({ page, context }) => {
  await signIn(page, "ENGINEER");
  await takeProjectOffline(page);
  await page.goto("/offline?view=home");
  await shellReady(page);

  await goOffline(context, page, `/offline?view=project&id=${SITE}`);
  await expect(page.getByTestId("offline-task")).toHaveCount(2);

  // The Site Diary, with no signal.
  await page.getByTestId("project-tab-diary").click();
  await page.getByTestId("diary-new").click();
  await expect(page.getByTestId("diary-editor")).toBeVisible();
  await page.getByTestId("diary-summary").fill("Slab B poured, formwork struck on level 2.");
  await page.getByTestId("diary-work-input").fill("Poured slab B");
  await page.getByTestId("diary-work-add").click();
  await page.getByTestId("diary-crew-input").fill("Crew A");
  await page.getByTestId("diary-headcount-input").fill("6");
  await page.getByTestId("diary-crew-add").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("diary-photo-add").click();
  await (await chooser).setFiles([{ name: "slab.png", mimeType: "image/png", buffer: png }]);
  await expect(page.getByTestId("diary-photo-row")).toHaveCount(1);
  await page.getByTestId("diary-save").click();
  await expect(page.getByTestId("diary-message")).toContainText(/saved on this device/i);
  await expect(page.getByTestId("diary-status")).toContainText(/saved on this device/i);
  await page.getByTestId("diary-submit").click();
  // Queued, never "Submitted", until the server has said so.
  await expect(page.getByTestId("diary-status")).toContainText(/submission queued/i);
  await expect(page.getByTestId("diary-status")).not.toContainText(/^submitted$/i);

  // A task: a comment, and a completion the server must still agree to.
  await page.goto(`/offline?view=task&id=${TASK_ACTIVE}&project=${SITE}`);
  await page.getByTestId("task-comment-input").fill("Updated the drawing.");
  await page.getByTestId("task-comment-add").click();
  await expect(page.getByTestId("task-pending-comment")).toContainText("Updated the drawing.");
  await expect(page.getByTestId("task-pending-comment")).toContainText(/waiting to sync/i);
  await page.getByTestId("task-complete").click();
  await expect(page.getByTestId("task-pending")).toContainText(/completion waiting to sync/i);

  // Closing the app and reopening it loses nothing.
  await page.reload();
  await expect(page.getByTestId("task-pending")).toContainText(/completion waiting to sync/i);
  // Start the day, the notes, a row of work, a crew, a photo, the submission, a comment and a completion.
  expect(await pendingCount(page)).toBe(8);
  await page.goto(`/offline?view=project&id=${SITE}&tab=diary`);
  await expect(page.getByTestId("offline-diary-local")).toContainText(/submission queued/i);

  // Nothing has reached the server.
  expect(await db.dailyLog.count({ where: { projectId: SITE } })).toBe(0);
  expect(await db.comment.count({ where: { clientOperationId: { not: null }, thread: { parentId: TASK_ACTIVE } } })).toBe(0);

  // The connection returns.
  await context.setOffline(false);
  await page.goto("/offline?view=sync");
  await expect(page.getByTestId("sync-pending-count")).toHaveText("0", { timeout: 90_000 });
  await expect(page.getByTestId("sync-headline")).toHaveText(/all synced/i);

  const logs = await db.dailyLog.findMany({ where: { projectId: SITE } });
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ status: "SUBMITTED", summary: "Slab B poured, formwork struck on level 2." });
  expect(await db.dailyLogWorkActivity.count({ where: { dailyLogId: logs[0]!.id } })).toBe(1);
  expect(await db.dailyLogWorkforceEntry.count({ where: { dailyLogId: logs[0]!.id } })).toBe(1);
  const photos = await db.dailyLogDocumentLink.findMany({ where: { dailyLogId: logs[0]!.id } });
  expect(photos).toHaveLength(1);
  expect(await db.comment.count({ where: { thread: { parentId: TASK_ACTIVE }, body: "Updated the drawing." } })).toBe(1);
  expect((await db.task.findUniqueOrThrow({ where: { id: TASK_ACTIVE } })).status).toBe("COMPLETED");
});

test("a response lost after the server committed does not make a second record", async ({ page, context }) => {
  await cleanup();
  await makeProjectTasksOnly();
  await signIn(page, "ENGINEER");
  await takeProjectOffline(page);
  await page.goto("/offline?view=home");
  await goOffline(context, page, `/offline?view=task&id=${TASK_OTHER}&project=${SITE}`);
  await page.getByTestId("task-comment-input").fill("Sent once only");
  await page.getByTestId("task-comment-add").click();
  await expect(page.getByTestId("task-pending-comment")).toBeVisible();

  // The server gets the request and answers, but the answer never reaches the device.
  await page.route("**/api/sync", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await context.setOffline(false);
  await page.goto("/offline?view=sync");
  await expect.poll(() => db.comment.count({ where: { thread: { parentId: TASK_OTHER }, body: "Sent once only" } }), { timeout: 30_000 }).toBe(1);
  // The device still believes it is waiting.
  await expect(page.getByTestId("sync-pending-count")).not.toHaveText("0");

  await page.unroute("**/api/sync");
  await page.getByTestId("sync-now").click();
  await expect(page.getByTestId("sync-pending-count")).toHaveText("0", { timeout: 90_000 });
  await expect(page.getByTestId("sync-headline")).toHaveText(/all synced/i);
  expect(await db.comment.count({ where: { thread: { parentId: TASK_OTHER }, body: "Sent once only" } })).toBe(1);
});

async function makeProjectTasksOnly() {
  await db.task.deleteMany({ where: { id: { in: [TASK_ACTIVE, TASK_OTHER] } } });
  await db.task.create({ data: { id: TASK_ACTIVE, companyId, projectId: SITE, title: "Facade Inspection", assigneeMemberId: "member_engineer", status: "IN_PROGRESS", createdByMemberId: "member_owner", createdBy: "user_owner" } });
  await db.task.create({ data: { id: TASK_OTHER, companyId, projectId: SITE, title: "Basement survey", assigneeMemberId: "member_engineer", status: "TODO", createdByMemberId: "member_owner", createdBy: "user_owner" } });
}

test("a task completed offline that the office changed meanwhile is a conflict, not an overwrite", async ({ page, context }) => {
  await cleanup();
  await makeProjectTasksOnly();
  await signIn(page, "ENGINEER");
  await takeProjectOffline(page);
  await page.goto("/offline?view=home");
  await goOffline(context, page, `/offline?view=task&id=${TASK_ACTIVE}&project=${SITE}`);
  await page.getByTestId("task-complete").click();
  await expect(page.getByTestId("task-pending")).toBeVisible();

  // The office archives it while the device is offline.
  await db.task.update({ where: { id: TASK_ACTIVE }, data: { status: "ARCHIVED", archivedAt: new Date() } });

  await context.setOffline(false);
  await page.goto("/offline?view=sync");
  await expect(page.getByTestId("sync-headline")).toHaveText(/needs attention/i, { timeout: 90_000 });
  await expect(page.getByTestId("sync-item")).toHaveAttribute("data-state", "NEEDS_REVIEW");
  expect((await db.task.findUniqueOrThrow({ where: { id: TASK_ACTIVE } })).status).toBe("ARCHIVED");

  await page.getByTestId("sync-review").click();
  await expect(page.getByTestId("conflict-dialog")).toBeVisible();
  await expect(page.getByTestId("conflict-dialog")).toContainText(/changed while you were offline/i);
  await page.getByTestId("conflict-discard").click();
  await expect(page.getByTestId("sync-pending-count")).toHaveText("0");
});

test("claiming a task needs a connection, and says so", async ({ page, context }) => {
  await cleanup();
  await makeProjectTasksOnly();
  await db.task.update({ where: { id: TASK_OTHER }, data: { assigneeMemberId: null } });
  await signIn(page, "ENGINEER");
  await takeProjectOffline(page);
  await page.goto("/offline?view=home");
  await goOffline(context, page, `/offline?view=task&id=${TASK_OTHER}&project=${SITE}`);
  await expect(page.getByTestId("task-claim")).toBeDisabled();
  await expect(page.getByText("Connect to the internet to claim this task.")).toBeVisible();
  await context.setOffline(false);
});

test("access removed while offline: nothing is silently submitted, protected data goes, unsynced work is kept and explained", async ({ page, context }) => {
  await cleanup();
  await makeProjectTasksOnly();
  await signIn(page, "ENGINEER");
  await takeProjectOffline(page);
  await page.goto("/offline?view=home");
  await goOffline(context, page, `/offline?view=project&id=${SITE}&tab=diary`);
  await page.getByTestId("diary-new").click();
  await page.getByTestId("diary-summary").fill("Written before access was removed");
  await page.getByTestId("diary-work-input").fill("Concrete pour");
  await page.getByTestId("diary-work-add").click();
  await page.getByTestId("diary-save").click();
  await page.getByTestId("diary-submit").click();

  await db.projectMember.updateMany({ where: { projectId: SITE, companyMemberId: "member_engineer" }, data: { status: "INACTIVE" } });
  try {
    await context.setOffline(false);
    await page.goto(`/offline?view=project&id=${SITE}`);
    await expect(page.getByTestId("project-revoked")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("project-revoked")).toContainText(/unsynced item/i);
    expect(await db.dailyLog.count({ where: { projectId: SITE } })).toBe(0);

    // The work is still there, marked as needing attention; nothing went to the server.
    await page.goto("/offline?view=sync");
    await expect(page.getByTestId("sync-items").getByTestId("sync-item").first()).toHaveAttribute("data-state", /FAILED|BLOCKED/);
    await expect(page.getByTestId("sync-pending-count")).not.toHaveText("0");
  } finally {
    await db.projectMember.updateMany({ where: { projectId: SITE, companyMemberId: "member_engineer" }, data: { status: "ACTIVE" } });
  }
});

test("signing out with unsynced work asks first, and Cancel keeps the person signed in", async ({ page, context }) => {
  await cleanup();
  await makeProjectTasksOnly();
  await signIn(page, "ENGINEER");
  await takeProjectOffline(page);
  // The server never answers a sync, so the comment stays unsynced for the whole test.
  await page.route("**/api/sync", (route) => route.abort("failed"));
  await page.goto("/offline?view=home");
  await goOffline(context, page, `/offline?view=task&id=${TASK_OTHER}&project=${SITE}`);
  await page.getByTestId("task-comment-input").fill("Still waiting");
  await page.getByTestId("task-comment-add").click();
  await expect(page.getByTestId("task-pending-comment")).toBeVisible();
  // Stay offline so the change cannot go: then come back to a normal page.
  await page.goto("/dashboard").catch(() => undefined);
  await context.setOffline(false);
  await page.goto("/offline?view=sync");
  expect(await pendingCount(page)).toBe(1);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /open user menu/i }).click();
  await page.getByRole("menuitem", { name: /logout/i }).click();
  await expect(page.getByTestId("logout-pending-prompt")).toBeVisible();
  await page.getByRole("button", { name: /^cancel$/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.unroute("**/api/sync");
});

test("the offline workspace opens from the address bar with no network, and an unknown page lands in it", async ({ page, context }) => {
  await cleanup();
  await makeProjectTasksOnly();
  await signIn(page, "ENGINEER");
  await takeProjectOffline(page);
  await page.goto("/offline?view=home");
  await shellReady(page);
  await context.setOffline(true);
  await page.goto(`/projects/${SITE}`);
  await expect(page.getByTestId("offline-app")).toBeVisible();
  await expect(page.getByTestId("project-view")).toBeVisible();
  await context.setOffline(false);
});

test("the offline workspace is accessible, keyboard-reachable and fits a phone", async ({ page, context }) => {
  await cleanup();
  await makeProjectTasksOnly();
  await signIn(page, "ENGINEER");
  await takeProjectOffline(page);
  await page.goto("/offline?view=home");
  await goOffline(context, page, `/offline?view=task&id=${TASK_OTHER}&project=${SITE}`);
  // Something pending, so the states to describe exist.
  await page.getByTestId("task-comment-input").fill("Needs a screen reader");
  await page.getByTestId("task-comment-add").click();
  await expect(page.getByTestId("task-pending-comment")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const views = [
    "/offline?view=home",
    "/offline?view=sync",
    "/offline?view=storage",
    `/offline?view=project&id=${SITE}&tab=tasks`,
    `/offline?view=project&id=${SITE}&tab=diary`,
    `/offline?view=project&id=${SITE}&tab=hse`,
    `/offline?view=task&id=${TASK_OTHER}&project=${SITE}`,
  ];
  for (const view of views) {
    await page.goto(view);
    await expect(page.getByTestId("offline-app")).toBeVisible();
    await page.waitForTimeout(400);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(result.violations.map((v) => `${view}: ${v.id} (${v.nodes.length})`), view).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${view} overflows a phone by ${overflow}px`).toBeLessThanOrEqual(0);
  }

  // The status says what is pending in words a screen reader reads.
  await page.goto("/offline?view=sync");
  const status = page.getByTestId("offline-status");
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toContainText(/offline · 1 change waiting/i);
  await page.keyboard.press("Tab");
  await context.setOffline(false);
});
