import { execFileSync } from "node:child_process";

import { devices, expect, test, type Page } from "@playwright/test";

import { createPendingExpense, memberId, removeExpenses } from "../approvals-fixtures";
import { db, removeTestDocuments } from "../db";
import { DEMO_PASSWORD, dropOrphanedStreamSegments, mainRegion, signIn, signOut, switchCompany } from "../fixtures";
import { removeMeetings } from "../meetings-cleanup";

/**
 * AUD-10 multi-user journeys (§9, CW-22).
 *
 * Three people per journey, each a real demo account signed in through the
 * login form — a full user switch, not a role override — and every hand-off
 * checked twice: in the browser, where the next person sees the result, and in
 * the database, where the source record, its cycle or link, its history and
 * its outbox events must agree. The notification worker is run the way an
 * operator runs it, one pass of the real script.
 *
 *   1. requester → designated approver → requester confirmation, through the
 *      Approvals Center (desktop, and the approver's step again on a phone);
 *   2. meeting organizer → assigned task worker completes the task →
 *      organizer sees the action done;
 *   3. record owner → document contributor → restricted viewer denied.
 */

const EXPENSE = "E2E aud10 expense";
const MEETING = "E2E aud10 meeting";
const DOCUMENT = "E2E aud10 document";
const ZONE = "Europe/Tirane";
/** Group Engineering's head: an Aurelia member on no Aurelia project, so Riverside's files are out of scope. */
const RESTRICTED_USERNAME = "group-engineering";

function dispatchNotifications() {
  execFileSync("npx", ["tsx", "scripts/notifications.ts", "--limit=500"], { stdio: "pipe", env: process.env, timeout: 120_000 });
}

/** Signs in an account the shared role map does not name, and settles it in Aurelia's company workspace. */
async function signInAs(page: Page, username: string) {
  await dropOrphanedStreamSegments(page);
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await switchCompany(page, "company_demo_a");
}

/** A high-value approval asks once more (PRD #41 §279); a small one is decided at once. Either way, answered. */
async function confirmIfAsked(page: Page) {
  const confirm = page.getByTestId("confirm-approve");
  await expect(confirm.or(page.getByText("Expense approved", { exact: true }))).toBeVisible();
  if (await confirm.isVisible()) await confirm.click();
}

const detail = (page: Page) => page.getByTestId("approval-detail");
const approvalRow = (page: Page, id: string) => mainRegion(page).locator(`[data-approval="${id}"]`);

test.afterAll(async () => {
  await removeExpenses(EXPENSE);
  await removeMeetings(MEETING);
  await removeTestDocuments(DOCUMENT);
  await db.$disconnect();
});

test.describe("requester → approver → requester (Approvals Center)", () => {
  test("Finance asks, the CEO approves in the Center, and Finance sees the decision and is told", async ({ page }) => {
    const started = new Date();
    const { expenseId, approvalId } = await createPendingExpense(`${EXPENSE} scaffold hire`);
    const requester = await memberId("finance@nesto.test");

    // The designated approver decides in the Center.
    await signIn(page, "CEO", { to: `/approvals?approval=finance%3A${approvalId}` });
    await expect(detail(page).getByTestId("approval-title")).toContainText(`${EXPENSE} scaffold hire`);
    await detail(page).getByRole("button", { name: "Approve this expense" }).click();
    await confirmIfAsked(page);
    await expect(page.getByText("Expense approved", { exact: true })).toBeVisible();

    // One transition, one cycle decision, one event — committed together.
    expect((await db.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("APPROVED");
    expect(await db.financeApproval.findUniqueOrThrow({ where: { id: approvalId } })).toMatchObject({ status: "APPROVED" });
    expect(await db.financeApproval.count({ where: { recordId: expenseId, status: "PENDING" } })).toBe(0);
    expect(await db.notificationEventOutbox.count({ where: { entityId: expenseId, eventType: "APPROVAL_APPROVED", createdAt: { gte: started } } })).toBe(1);
    await signOut(page);

    dispatchNotifications();
    expect(await db.notification.count({ where: { entityId: expenseId, recipientMemberId: requester, eventType: "APPROVAL_APPROVED" } })).toBe(1);

    // The requester, signed in as themself, finds it decided where they asked for it.
    await signIn(page, "FINANCE", { to: "/approvals?tab=requested" });
    await approvalRow(page, `finance:${approvalId}`).click();
    await expect(detail(page).getByTestId("approval-history")).toContainText(/approved/i);
    await expect(detail(page).getByRole("button", { name: "Approve this expense" })).toHaveCount(0);

    // A second worker pass tells nobody twice.
    dispatchNotifications();
    expect(await db.notification.count({ where: { entityId: expenseId, recipientMemberId: requester, eventType: "APPROVAL_APPROVED" } })).toBe(1);
  });
});

/** A phone, as the mobile project runs it; the browser type is the file's own (a describe cannot change it). */
const { defaultBrowserType: _browser, ...phone } = devices["Pixel 7"];

test.describe("the approver's step on a phone", () => {
  test.use(phone);

  test("the CEO approves from the full-screen sheet and the queue and source agree", async ({ page }) => {
    const { expenseId, approvalId } = await createPendingExpense(`${EXPENSE} phone welding`);
    await signIn(page, "CEO", { to: "/approvals" });
    const item = approvalRow(page, `finance:${approvalId}`);
    await item.scrollIntoViewIfNeeded();
    await item.click();

    const sheet = page.getByTestId("approval-sheet");
    await expect(sheet).toBeVisible();
    const approve = sheet.getByTestId("decision-bar").getByRole("button", { name: "Approve this expense" });
    await expect(approve).toBeInViewport();
    await approve.click();
    await confirmIfAsked(page);
    await expect(page.getByText("Expense approved", { exact: true })).toBeVisible();
    await expect(item).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    expect((await db.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("APPROVED");
    expect(await db.financeApproval.findUniqueOrThrow({ where: { id: approvalId } })).toMatchObject({ status: "APPROVED" });
  });
});

test.describe("meeting organizer → task worker → organizer", () => {
  test("the organizer turns an action into a task, the Engineer completes the task, and the organizer sees the action done", async ({ page }) => {
    const pm = await db.companyMember.findFirstOrThrow({ where: { id: "member_pm" }, select: { id: true, companyId: true } });
    const start = new Date(Date.now() + 2 * 86_400_000);
    const meeting = await db.meeting.create({
      data: {
        companyId: pm.companyId,
        projectId: "project_a",
        createdByMemberId: pm.id,
        organizerMemberId: pm.id,
        title: `${MEETING} crane booking`,
        meetingType: "INTERNAL",
        visibility: "PROJECT",
        startsAt: start,
        endsAt: new Date(start.getTime() + 3_600_000),
        timezone: ZONE,
        participants: { create: [{ memberId: pm.id, companyId: pm.companyId, role: "ORGANIZER", response: "ACCEPTED", displayName: "Alex Morgan" }] },
        actionItems: { create: [{ companyId: pm.companyId, title: `${MEETING} book the tower crane`, ownerMemberId: "member_engineer", createdByMemberId: pm.id }] },
      },
      select: { id: true, actionItems: { select: { id: true } } },
    });
    const actionId = meeting.actionItems[0].id;

    // The organizer hands the action off to a task.
    await signIn(page, "PROJECT_MANAGER", { to: `/meetings/${meeting.id}?tab=actions` });
    const action = mainRegion(page).getByTestId("meeting-action").filter({ hasText: "book the tower crane" });
    await action.getByRole("button", { name: "Create task" }).click();
    await expect(action.getByTestId("action-task-link")).toBeVisible();
    const linked = await db.meetingActionItem.findUniqueOrThrow({ where: { id: actionId }, select: { linkedTaskId: true, status: true } });
    expect(linked.linkedTaskId).not.toBeNull();
    const taskId = linked.linkedTaskId!;
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { assigneeMemberId: true, status: true } })).toEqual({ assigneeMemberId: "member_engineer", status: "TODO" });
    await signOut(page);

    // The Engineer — a full user switch — completes the task from the meeting.
    await signIn(page, "ENGINEER", { to: `/meetings/${meeting.id}?tab=actions` });
    const engineerAction = mainRegion(page).getByTestId("meeting-action").filter({ hasText: "book the tower crane" });
    // A linked action follows its task: it is not ticked off on its own.
    await expect(engineerAction.getByRole("checkbox")).toBeDisabled();
    await engineerAction.getByTestId("action-task-link").click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}`));
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(page.getByText("Task completed.", { exact: true })).toBeVisible();

    // Task and action moved in one transaction; one completion event each.
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("COMPLETED");
    const done = await db.meetingActionItem.findUniqueOrThrow({ where: { id: actionId }, select: { status: true, completedAt: true } });
    expect(done.status).toBe("DONE");
    expect(done.completedAt).not.toBeNull();
    expect(await db.notificationEventOutbox.count({ where: { entityId: taskId, eventType: "TASK_COMPLETED" } })).toBe(1);
    expect(await db.notificationEventOutbox.count({ where: { entityId: meeting.id, eventType: "MEETING_ACTION_COMPLETED" } })).toBe(1);
    await signOut(page);

    dispatchNotifications();
    expect(await db.notification.count({ where: { entityId: meeting.id, recipientMemberId: pm.id, eventType: "MEETING_ACTION_COMPLETED" } })).toBe(1);

    // The organizer sees the action done.
    await signIn(page, "PROJECT_MANAGER", { to: `/meetings/${meeting.id}?tab=actions` });
    await expect(mainRegion(page).getByTestId("meeting-action").filter({ hasText: "book the tower crane" }).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("record owner → document contributor → restricted viewer", () => {
  test("the Architect files a document on Riverside, the Project Manager opens it, and a member off the project is refused it", async ({ page }) => {
    const name = `${DOCUMENT} slab reinforcement`;

    // The contributor uploads it to the project.
    await signIn(page, "ARCHITECT", { to: "/documents/new?projectId=project_a" });
    await page.getByLabel("Document name").fill(name);
    await page.getByLabel("Choose files to upload").setInputFiles({ name: "slab-reinforcement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nAUD-10 journey\n%%EOF\n") });
    await expect(mainRegion(page).getByText(/· Uploaded$/)).toBeVisible({ timeout: 20_000 });
    const stored = await db.document.findFirstOrThrow({ where: { name }, select: { id: true, projectId: true, storageStatus: true } });
    expect(stored).toMatchObject({ projectId: "project_a", storageStatus: "AVAILABLE" });
    await signOut(page);

    // The project's owner finds it on the project and downloads it.
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/documents" });
    await expect(mainRegion(page).getByText(name).first()).toBeVisible();
    const grant = await page.request.post(`/api/documents/${stored.id}/download`);
    expect(grant.status()).toBe(200);
    await signOut(page);

    // A member of the same company, off the project: nothing by page, list, download or preview.
    await signInAs(page, RESTRICTED_USERNAME);
    const opened = await page.goto(`/documents/${stored.id}`);
    expect(opened?.status()).toBe(404);
    await page.goto(`/documents/all?search=${encodeURIComponent(DOCUMENT)}`);
    await expect(mainRegion(page).getByText(name)).toHaveCount(0);
    expect((await page.request.post(`/api/documents/${stored.id}/download`)).status()).toBe(404);
    expect((await page.request.post(`/api/documents/${stored.id}/preview`)).status()).toBe(404);
    // The refusal changed nothing.
    expect(await db.document.findUniqueOrThrow({ where: { id: stored.id }, select: { storageStatus: true, status: true } })).toEqual({ storageStatus: "AVAILABLE", status: "ACTIVE" });
  });
});
