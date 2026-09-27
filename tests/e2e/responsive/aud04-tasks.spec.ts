import { expect, test, type Browser, type Page, type Request, type TestInfo } from "@playwright/test";

import { db, removeTestTasks } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { expectInputsAtLeast16px, expectInViewport, expectNoPageOverflow, expectTouchTargets, outsideProjects } from "./geometry";

/**
 * The task journey on phones and tablets (AUD-04 §7 "Task work"; MW-11,
 * MW-15, MW-16, MW-19).
 *
 * Real demo identities, signed in through the login form: the Project Manager
 * works the task, the Owner — in a browser of their own — changes it behind
 * the PM's back through the real API, and the Viewer is the role that may only
 * read. Every task is created through the app's API and removed afterwards
 * (prefix `aud04c_`). Every outcome is checked after a reload and in the
 * database, never from a toast alone.
 *
 * Runs in the AUD-04 matrix at 360 and 390 phones, 768 and 820 tablets and the
 * 844×390 landscape phone (playwright.config.ts). Below 640px the header keeps
 * one verb in view and the rest are in the labelled More menu; from 640px they
 * are all buttons.
 */

const PREFIX = "aud04c_";
const PROJECT = "project_a";
const ENGINEER = "member_engineer";
const SIZES = /^aud04-(phone-360|phone-390|tablet-768|tablet-820|landscape-844)$/;

test.beforeEach(async ({}, testInfo) => {
  test.skip(outsideProjects(testInfo, SIZES), "The task journey runs at 360, 390, 768, 820 and 844×390.");
});

test.afterAll(async () => {
  await removeTestTasks(PREFIX);
  await db.$disconnect();
});

const phoneLayout = (page: Page) => page.viewportSize()!.width < 640;

/** A task of the PM's own on Riverside, created as the app creates one. */
async function createTask(page: Page, testInfo: TestInfo, label: string): Promise<{ id: string; title: string }> {
  const title = `${PREFIX}${label} ${testInfo.project.name} ${Date.now().toString(36)}`;
  const response = await page.request.post("/api/tasks", { data: { title, projectId: PROJECT, status: "TODO", priority: "MEDIUM" } });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { data: { id: string } };
  return { id: body.data.id, title };
}

/** The Owner, signed in in a browser of their own, acting through the API as any client would. */
async function ownerSession(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, "OWNER");
  return page;
}

const more = (page: Page) => mainRegion(page).getByRole("button", { name: "More task actions" });

/** A header verb: a button in view, or — on a phone — an item of the More menu. */
async function taskAction(page: Page, name: "Start" | "Complete" | "Reopen" | "Mark blocked" | "Edit task") {
  const button = mainRegion(page).getByRole("button", { name, exact: true });
  if (name !== "Mark blocked" && name !== "Edit task" && (await button.isVisible())) {
    await button.click();
    return;
  }
  if (name === "Edit task" && !phoneLayout(page)) {
    await mainRegion(page).getByRole("link", { name: "Edit", exact: true }).click();
    return;
  }
  await more(page).click();
  await page.getByRole("menuitem", { name }).click();
}

/** The server action a task command posts to its own page. */
const isCommandPost = (taskId: string) => (request: Request) =>
  request.method() === "POST" && new URL(request.url()).pathname === `/tasks/${taskId}` && Boolean(request.headers()["next-action"]);

test.describe("MW-11 task work", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("finds and filters the task, edits it with a new assignee, and drives it Start → Blocked → Complete → Reopen", async ({ page }, testInfo) => {
    const task = await createTask(page, testInfo, "journey");

    // Find it: search, then a filter — the phone's staged sheet or the tablet's inline select.
    await page.goto("/tasks/all");
    const search = mainRegion(page).getByLabel("Search tasks…");
    await search.fill(task.title);
    await search.press("Enter");
    await expect(page).toHaveURL(/search=/);
    if (page.viewportSize()!.width < 768) {
      await mainRegion(page).locator("[data-filter-sheet-trigger]").click();
      const sheet = page.getByTestId("filter-sheet");
      await sheet.getByLabel("Priority").selectOption("MEDIUM");
      await expectInViewport(sheet.getByRole("button", { name: "Apply" }), "filter sheet Apply");
      await sheet.getByRole("button", { name: "Apply" }).click();
    } else {
      await mainRegion(page).getByLabel("Priority", { exact: true }).selectOption("MEDIUM");
    }
    await expect(page).toHaveURL(/priority=MEDIUM/);
    const link = mainRegion(page).getByRole("link", { name: task.title });
    await expect(link).toBeVisible();
    await expectNoPageOverflow(page, "task list");
    await link.click();
    await page.waitForURL(new RegExp(`/tasks/${task.id}$`));

    // The header: the next step in view; everything else reachable, nothing off the page.
    await expectNoPageOverflow(page, "task detail");
    const start = mainRegion(page).getByRole("button", { name: "Start", exact: true });
    await expectInViewport(start, "Start");
    await expectTouchTargets(page, start);
    await expectTouchTargets(page, more(page));
    if (phoneLayout(page)) {
      await expect(mainRegion(page).getByRole("button", { name: "Complete", exact: true })).toBeHidden();
      await more(page).click();
      const menu = page.getByRole("menu");
      for (const item of ["Complete", "Edit task", "Mark blocked", "Archive task"]) await expect(menu.getByRole("menuitem", { name: item })).toBeVisible();
      await expectTouchTargets(page, menu);
      await page.keyboard.press("Escape");
    } else {
      await expect(mainRegion(page).getByRole("button", { name: "Complete", exact: true })).toBeVisible();
      await expect(mainRegion(page).getByRole("link", { name: "Edit", exact: true })).toBeVisible();
    }

    // Edit permitted fields and the assignee.
    await taskAction(page, "Edit task");
    await page.waitForURL(new RegExp(`/tasks/${task.id}/edit$`));
    const form = mainRegion(page).locator("form").first();
    if (page.viewportSize()!.width < 768) await expectInputsAtLeast16px(page, form);
    await page.getByLabel("Description").fill("Pour sequence agreed with the site team; formwork strikes on day three.");
    await page.getByLabel("Priority").selectOption("HIGH");
    const assignee = page.getByLabel("Assignee");
    await expect(assignee).toHaveAttribute("data-picker-state", /ready/);
    await assignee.selectOption(ENGINEER);
    const save = page.getByRole("button", { name: "Save changes" });
    await expectInViewport(save, "Save changes");
    await expectTouchTargets(page, save);
    await expectNoPageOverflow(page, "task edit");
    await save.click();
    await page.waitForURL(new RegExp(`/tasks/${task.id}$`));
    await page.reload();
    await expect(mainRegion(page).getByText("Pour sequence agreed with the site team", { exact: false })).toBeVisible();
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ priority: "HIGH", assigneeMemberId: ENGINEER, version: 2 });

    // Start.
    await taskAction(page, "Start");
    await expect(page.getByText("Task started.", { exact: true })).toBeVisible();
    await expect.poll(async () => (await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("IN_PROGRESS");

    // Block, with the reason the dialog insists on; the dialog fits and its submit is reachable.
    await page.reload();
    await taskAction(page, "Mark blocked");
    const dialog = page.getByRole("dialog");
    const reason = dialog.getByLabel("Reason");
    await expect(reason).toBeFocused();
    await dialog.getByRole("button", { name: "Mark blocked" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Say why the task is blocked.");
    await reason.fill("Waiting for the structural engineer's sign-off on the slab openings.");
    await expectInViewport(reason, "block reason");
    await expectInViewport(dialog.getByRole("button", { name: "Mark blocked" }), "Mark blocked");
    await expectTouchTargets(page, dialog.getByRole("button"));
    await dialog.getByRole("button", { name: "Mark blocked" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("task-blocked-reason")).toContainText("Waiting for the structural engineer's sign-off");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("BLOCKED");

    // Complete, then Reopen.
    await taskAction(page, "Complete");
    await expect(page.getByText("Task completed.", { exact: true })).toBeVisible();
    await page.reload();
    const reopen = mainRegion(page).getByRole("button", { name: "Reopen", exact: true });
    await expectInViewport(reopen, "Reopen");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("COMPLETED");
    await reopen.click();
    await expect(page.getByText("Task reopened.", { exact: true })).toBeVisible();
    await expect.poll(async () => (await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("TODO");

    // The history says what happened, after a reload, and fits the page.
    await page.goto(`/tasks/${task.id}/activity`);
    const history = mainRegion(page).locator("ol");
    for (const message of ["started the task", "marked the task blocked", "completed the task", "reopened the task"]) await expect(history).toContainText(message);
    await expectNoPageOverflow(page, "task activity");
  });

  test("a change another person made first is recovered, never overwritten (AUD-02)", async ({ page, browser }, testInfo) => {
    const task = await createTask(page, testInfo, "stale");
    const owner = await ownerSession(browser);

    // A command against a version that moved: the latest is shown and the person chooses again.
    await page.goto(`/tasks/${task.id}`);
    const complete = await owner.request.post(`/api/tasks/${task.id}/complete`, { data: { expectedVersion: 1 } });
    expect(complete.status(), await complete.text()).toBe(200);
    await mainRegion(page).getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByText("This task changed since you opened it. Its latest state is shown now; choose again.")).toBeVisible();
    await expect(mainRegion(page).getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: "COMPLETED", version: 2 });

    // An edit that lost to the Owner's: the draft stays, the review fits the phone and its choices are 44px.
    const reopened = await owner.request.post(`/api/tasks/${task.id}/reopen`, { data: { expectedVersion: 2 } });
    expect(reopened.status(), await reopened.text()).toBe(200);
    await page.goto(`/tasks/${task.id}/edit`);
    const rename = await owner.request.patch(`/api/tasks/${task.id}`, { data: { title: `${task.title} renamed`, expectedVersion: 3 } });
    expect(rename.status(), await rename.text()).toBe(200);
    await page.getByLabel("Priority").selectOption("CRITICAL");
    await page.getByRole("button", { name: "Save changes" }).click();
    const conflict = page.getByTestId("task-conflict");
    await expect(page.getByRole("heading", { name: "Your changes have not been saved" })).toBeFocused();
    await expectInViewport(page.getByRole("heading", { name: "Your changes have not been saved" }), "conflict heading");
    await expect(page.getByLabel("Priority")).toHaveValue("CRITICAL");
    await conflict.getByRole("button", { name: "Review latest" }).click();
    const priority = page.getByTestId("task-conflict-field-priority");
    await expect(priority.getByRole("checkbox", { name: "Use my priority" })).toBeChecked();
    await expectTouchTargets(page, conflict);
    await expectNoPageOverflow(page, "conflict review");
    await conflict.getByRole("button", { name: "Apply to the latest version" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(new RegExp(`/tasks/${task.id}$`));
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ title: `${task.title} renamed`, priority: "CRITICAL", version: 4 });
    await owner.context().close();
  });
});

test.describe("MW-11 a role that may only read", () => {
  test("the Viewer sees the task and none of its controls, and the edit page is not there", async ({ page }) => {
    await signIn(page, "VIEWER");
    const task = await db.task.findFirstOrThrow({ where: { assignee: { user: { email: "viewer@nesto.test" } }, archivedAt: null }, select: { id: true } });
    await page.goto(`/tasks/${task.id}`);
    await expect(mainRegion(page).locator("h1").first()).toBeVisible();
    for (const name of ["Start", "Complete", "Reopen"]) await expect(mainRegion(page).getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(mainRegion(page).getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(more(page)).toHaveCount(0);
    await expectNoPageOverflow(page, "viewer task detail");

    const edit = await page.goto(`/tasks/${task.id}/edit`);
    expect(edit?.status()).toBe(404);
  });
});

test.describe("MW-15 slow, doubled and failed commands", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("a slow Start shows its progress at once, and a second tap sends nothing", async ({ page }, testInfo) => {
    const task = await createTask(page, testInfo, "double tap");
    await page.goto(`/tasks/${task.id}`);
    let sent = 0;
    await page.route(
      (url) => url.pathname === `/tasks/${task.id}`,
      async (route) => {
        if (!isCommandPost(task.id)(route.request())) return route.continue();
        sent += 1;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await route.continue();
      },
    );

    const start = mainRegion(page).getByRole("button", { name: "Start", exact: true });
    // Two taps inside one frame: the second lands before the disabled state renders.
    await start.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(mainRegion(page).getByRole("button", { name: "Starting…" })).toBeVisible({ timeout: 500 });
    await expect(mainRegion(page).getByRole("button", { name: "Starting…" })).toBeDisabled();
    await expect(page.getByText("Task started.", { exact: true })).toBeVisible();
    await expect(page.getByText("This task changed since you opened it", { exact: false })).toHaveCount(0);
    expect(sent).toBe(1);
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: "IN_PROGRESS", version: 2 });
  });

  test("a lost connection is reported as unconfirmed — never as done — and nothing is resent", async ({ page }, testInfo) => {
    const task = await createTask(page, testInfo, "lost connection");
    await page.goto(`/tasks/${task.id}`);
    let sent = 0;
    await page.route(
      (url) => url.pathname === `/tasks/${task.id}`,
      async (route) => {
        if (!isCommandPost(task.id)(route.request())) return route.continue();
        sent += 1;
        await route.abort("connectionreset");
      },
    );
    await mainRegion(page).getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByText("We couldn't confirm whether this change was saved. Check the latest task before trying again.")).toBeVisible();
    await expect(page.getByText("Task started.", { exact: true })).toHaveCount(0);
    expect(sent).toBe(1);
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: "TODO", version: 1 });

    // Marking blocked over the same connection keeps the dialog, and the reason, open.
    await taskAction(page, "Mark blocked");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason").fill("Crane out of service until Thursday.");
    await dialog.getByRole("button", { name: "Mark blocked" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("We couldn't confirm whether this change was saved. Check the latest task before trying again.");
    await expect(dialog.getByLabel("Reason")).toHaveValue("Crane out of service until Thursday.");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("TODO");
  });
});

test.describe("MW-16 rotation keeps what was typed", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("the edit form and the block reason survive portrait ↔ landscape and the 1024px crossing", async ({ page }, testInfo) => {
    const task = await createTask(page, testInfo, "rotation");
    const original = page.viewportSize()!;
    const rotated = { width: original.height, height: original.width };

    await page.goto(`/tasks/${task.id}/edit`);
    await page.getByLabel("Description").fill("Typed before turning the phone.");
    await page.getByLabel("Priority").selectOption("LOW");
    for (const size of [rotated, { width: 1024, height: 768 }, original]) {
      await page.setViewportSize(size);
      await expect(page.getByLabel("Description")).toHaveValue("Typed before turning the phone.");
      await expect(page.getByLabel("Priority")).toHaveValue("LOW");
      await expectNoPageOverflow(page, `edit at ${size.width}×${size.height}`);
    }
    // Leaving the form asks about the draft (AUD-03); discarded here, nothing saved.
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByTestId("unsaved-prompt")).toBeVisible();
    await page.getByTestId("unsaved-discard").click();
    await page.waitForURL(new RegExp(`/tasks/${task.id}$`));

    await taskAction(page, "Mark blocked");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason").fill("Scaffold inspection pending.");
    for (const size of [rotated, { width: 1024, height: 768 }, original]) {
      await page.setViewportSize(size);
      await expect(dialog.getByLabel("Reason")).toHaveValue("Scaffold inspection pending.");
      await expectInViewport(dialog.getByRole("button", { name: "Mark blocked" }), `Mark blocked at ${size.width}×${size.height}`);
    }
    await dialog.getByRole("button", { name: "Mark blocked" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("task-blocked-reason")).toContainText("Scaffold inspection pending.");
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: "BLOCKED", priority: "MEDIUM" });
  });
});
