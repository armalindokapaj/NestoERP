import { expect, test, type Page } from "../pw";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { removeMeetings } from "../meetings-cleanup";

/**
 * Meetings, desktop (PRD #40 §297-§299): a project meeting from scheduling to
 * final minutes, an action handed off to a task and finished there, and the
 * minutes lock with an authorised reopen.
 */

const PREFIX = "E2E meeting";
const ZONE = "Europe/Tirane";
const tomorrow = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86_400_000));

test.afterAll(async () => {
  await removeMeetings(PREFIX);
  await db.$disconnect();
});

const workspace = (page: Page) => page.getByTestId("meeting-workspace");

test("runs a project meeting end to end: schedule, start, minutes, decision, action with task, complete, finalize, reopen", async ({ page, browser }) => {
  const title = `${PREFIX} coordination ${Date.now().toString(36)}`;

  // Schedule from the project's Meetings tab.
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/meetings" });
  await mainRegion(page).getByRole("link", { name: "New meeting" }).first().click();
  await expect(page).toHaveURL(/\/meetings\/new\?projectId=project_a/);
  const form = page.getByTestId("meeting-form");
  await form.getByLabel("Title").fill(title);
  await expect(form.getByLabel("Project")).toHaveValue("project_a");
  await form.getByLabel("Date").fill(tomorrow());
  await form.getByLabel("Start").fill("08:00");
  await form.getByLabel("End").fill("09:00");
  await form.getByPlaceholder("Add people by name").fill("Ethan");
  await page.getByRole("option", { name: /Ethan Cole/ }).click();
  await expect(form.getByTestId("form-participant")).toHaveCount(1);
  await form.getByRole("button", { name: "Schedule meeting" }).click();

  await expect(page).toHaveURL(/\/meetings\/c[a-z0-9]+$/);
  const meetingId = page.url().split("/").pop()!;
  await expect(workspace(page).getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(workspace(page).getByTestId("meeting-status").first()).toHaveText("Scheduled");
  await expect(workspace(page).getByTestId("participant-row")).toHaveCount(2);

  // It is on the calendar, as a meeting the calendar cannot move.
  const stored = await db.meeting.findUniqueOrThrow({ where: { id: meetingId }, select: { projectId: true, organizerMemberId: true, visibility: true } });
  expect(stored).toMatchObject({ projectId: "project_a", visibility: "PROJECT" });

  // Start: meeting mode.
  await workspace(page).getByRole("button", { name: "Start meeting" }).click();
  await expect(page.getByTestId("meeting-live-banner")).toBeVisible();
  const mode = page.getByTestId("meeting-mode");
  await expect(mode).toBeVisible();

  // Minutes save as they are written.
  await mode.getByRole("button", { name: "Summary" }).click();
  const section = mode.getByTestId("minutes-section").first();
  await section.getByRole("textbox", { name: "Summary" }).fill("Pour confirmed for Tuesday. Crane still to be booked.");
  await expect(section.getByText("Saved")).toBeVisible();

  // A decision, numbered.
  await mode.getByRole("button", { name: "Record decision" }).click();
  await mode.getByLabel("What was decided").fill("Use façade option B.");
  await mode.getByRole("button", { name: "Record", exact: true }).click();
  await expect(mode.getByTestId("decision-card")).toContainText("D-01");

  // An action for the engineer, handed off to a task at once.
  await mode.getByRole("button", { name: "Action item" }).click();
  const actionForm = mode.getByTestId("action-form");
  await actionForm.getByLabel("What needs doing").fill(`${PREFIX} book the crane`);
  await actionForm.getByLabel("Owner").selectOption({ label: "Ethan Cole" });
  await actionForm.getByRole("switch", { name: "Create a task" }).click();
  await actionForm.getByRole("button", { name: "Add action" }).click();
  const action = mode.getByTestId("meeting-action").filter({ hasText: "book the crane" });
  await expect(action.getByTestId("action-task-link")).toBeVisible();

  // Complete, then finalize the minutes.
  await page.getByRole("button", { name: "Complete meeting" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Complete meeting" }).click();
  await expect(workspace(page).getByTestId("meeting-status").first()).toHaveText("Completed");
  await expect(page.getByRole("tab", { name: /Minutes/ })).toHaveAttribute("aria-selected", "true");
  await workspace(page).getByRole("button", { name: "Finalize minutes" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finalize" }).click();
  await expect(workspace(page).getByTestId("minutes-status")).toHaveText(/Final/);
  // Final means read-only: the record, no editor, and no reopen for a project manager.
  await expect(workspace(page).getByTestId("minutes-record")).toContainText("Pour confirmed for Tuesday");
  await expect(workspace(page).getByTestId("minutes-section")).toHaveCount(0);
  await expect(workspace(page).getByRole("button", { name: "Reopen" })).toHaveCount(0);

  // The engineer opens the task from the meeting and completes it; the action follows.
  const engineerContext = await browser.newContext();
  const engineer = await engineerContext.newPage();
  await signIn(engineer, "ENGINEER", { to: `/meetings/${meetingId}?tab=actions` });
  const engineerAction = mainRegion(engineer).getByTestId("meeting-action").filter({ hasText: "book the crane" });
  await expect(engineerAction.getByRole("checkbox")).toBeDisabled();
  await engineerAction.getByTestId("action-task-link").click();
  await expect(engineer).toHaveURL(/\/tasks\/c[a-z0-9]+/);
  await expect(mainRegion(engineer).getByTestId("task-parent-link")).toHaveText(title);
  await engineer.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(engineer.getByText("Task completed.", { exact: true })).toBeVisible();
  await engineer.goto(`/meetings/${meetingId}?tab=actions`);
  await expect(mainRegion(engineer).getByTestId("meeting-action").filter({ hasText: "book the crane" }).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await engineerContext.close();

  // Only a role holding the reopen permission reopens final minutes, with a reason.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signIn(owner, "OWNER", { to: `/meetings/${meetingId}?tab=minutes` });
  await owner.getByTestId("meeting-workspace").getByRole("button", { name: "Reopen" }).click();
  await owner.getByRole("dialog").getByLabel("Reason").fill("Correct the pour day");
  await owner.getByRole("dialog").getByRole("button", { name: "Reopen minutes" }).click();
  await expect(owner.getByTestId("minutes-status")).toHaveText("Draft");
  await ownerContext.close();

  const audit = await db.auditEvent.findMany({ where: { entityId: meetingId }, select: { actionKey: true } });
  expect(audit.map((row) => row.actionKey)).toEqual(
    expect.arrayContaining(["MEETING_CREATED", "MEETING_STARTED", "MEETING_COMPLETED", "MEETING_MINUTES_FINALIZED", "MEETING_MINUTES_REOPENED", "MEETING_ACTION_TASK_CREATED"]),
  );
});

test("keeps a participants-only meeting away from someone who is not on it", async ({ page }) => {
  const pm = await db.companyMember.findFirstOrThrow({ where: { user: { email: "pm@nesto.test" } }, select: { id: true, companyId: true } });
  const start = new Date(Date.now() + 3 * 86_400_000);
  const meeting = await db.meeting.create({
    data: {
      companyId: pm.companyId,
      createdByMemberId: pm.id,
      organizerMemberId: pm.id,
      title: `${PREFIX} private review`,
      meetingType: "INTERNAL",
      visibility: "PARTICIPANTS",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3_600_000),
      timezone: ZONE,
      participants: { create: { memberId: pm.id, companyId: pm.companyId, role: "ORGANIZER", response: "ACCEPTED", displayName: "Alex Morgan" } },
    },
  });

  await signIn(page, "ARCHITECT", { to: `/meetings/${meeting.id}` });
  await expect(page.getByRole("heading", { name: /not found|could not be found|doesn.t exist/i }).first()).toBeVisible();
  const response = await page.request.get(`/api/meetings/${meeting.id}`);
  expect(response.status()).toBe(404);
});

test("lists upcoming meetings with filters and shows the seeded minutes as a formal record", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/meetings" });
  await expect(mainRegion(page).getByTestId("meeting-row").filter({ hasText: "Riverside weekly coordination" }).first()).toBeVisible();

  // Last week's occurrence holds the seeded minutes. Not `.first()`: after 10:30 today's occurrence
  // of the same weekly meeting is past too, and it lists above it.
  await page.goto("/meetings/past");
  await mainRegion(page).locator('[data-testid="meeting-row"][href="/meetings/meeting_riverside_000"]').click();
  await page.getByRole("tab", { name: /Minutes/ }).click();
  await expect(page.getByTestId("minutes-record")).toContainText("Level 3 slab pour confirmed");
  await expect(page.getByTestId("decision-card").first()).toContainText("D-01");

  const print = await page.request.get(`${page.url().split("?")[0]}/print`);
  expect(print.status()).toBe(200);
});
