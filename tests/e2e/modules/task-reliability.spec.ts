import { expect, test, type Browser, type Page } from "../pw";

import { db, removeTestTasks } from "../db";
import { signIn } from "../fixtures";

/**
 * Task conflict recovery in the browser (AUD-02 §7; TR-17, TR-18, TR-22).
 *
 * The Project Manager edits a task while the Owner — signed in in a second
 * browser context — changes it through the real API. The PM's save then loses
 * to the Owner's, and everything the PRD asks of the page is checked: the draft
 * is kept, the latest is reviewed beside it, only the chosen changes are
 * reapplied, an archived task offers only Restore, a task out of sight shows
 * nothing, a lost connection is reported as unconfirmed, the reason dialog
 * keeps its text, and all of it works by keyboard at 360, 390, 768 and
 * 1440 px. `AUD02_SHOTS=<dir>` saves the conflict review at each width.
 */

const PREFIX = "AUD02E";
const AURELIA = "company_demo_a";
const PM = "member_pm";
const OWNER = "member_owner";
const ENGINEER = "member_engineer";

test.afterAll(async () => {
  await removeTestTasks(PREFIX);
  await db.$disconnect();
});

async function seedTask(title: string, data: { assigneeMemberId?: string; createdByMemberId?: string } = {}) {
  const task = await db.task.create({
    data: {
      companyId: AURELIA,
      title: `${PREFIX} ${title}`,
      status: "TODO",
      priority: "MEDIUM",
      createdByMemberId: data.createdByMemberId ?? PM,
      assigneeMemberId: data.assigneeMemberId ?? null,
      createdBy: "e2e",
    },
    select: { id: true, title: true },
  });
  return task;
}

/** The Owner, signed in in a browser of their own, acting through the API as any client would. */
async function ownerSession(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, "OWNER");
  return page;
}

async function ownerEdit(owner: Page, taskId: string, body: Record<string, unknown>) {
  const response = await owner.request.patch(`/api/tasks/${taskId}`, { data: { priority: "MEDIUM", status: "TODO", ...body } });
  expect(response.status(), await response.text()).toBe(200);
}

async function ownerCommand(owner: Page, taskId: string, command: string, body: Record<string, unknown>) {
  const response = await owner.request.post(`/api/tasks/${taskId}/${command}`, { data: body });
  expect(response.status(), await response.text()).toBe(200);
}

const conflict = (page: Page) => page.getByTestId("task-conflict");

test.describe("editing a task another person changed (TR-17, TR-22)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("keeps the draft, reviews the latest and reapplies only the chosen change", async ({ page, browser }) => {
    const task = await seedTask("review");
    const owner = await ownerSession(browser);
    await page.goto(`/tasks/${task.id}/edit`);

    await ownerEdit(owner, task.id, { title: `${PREFIX} review, renamed by the Owner`, expectedVersion: 1 });

    await page.getByLabel("Priority").selectOption("HIGH");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(conflict(page)).toBeVisible();
    await expect(conflict(page).getByRole("alert")).toHaveText("This task changed while you were editing. Your changes have not been saved.");
    // Focus moves to the review, and the draft is still in the form.
    await expect(page.getByRole("heading", { name: "Your changes have not been saved" })).toBeFocused();
    await expect(page.getByLabel("Priority")).toHaveValue("HIGH");
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}/edit$`));

    await conflict(page).getByRole("button", { name: "Review latest" }).click();
    const priority = page.getByTestId("task-conflict-field-priority");
    await expect(priority).toContainText("Medium");
    await expect(priority).toContainText("High");
    // Only the fields the PM changed are compared; the Owner's rename is simply the latest.
    await expect(page.getByTestId("task-conflict-field-title")).toHaveCount(0);
    await expect(priority.getByRole("checkbox", { name: "Use my priority" })).toBeChecked();

    await conflict(page).getByRole("button", { name: "Apply to the latest version" }).click();
    await expect(page.getByTestId("task-conflict-applied")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue(`${PREFIX} review, renamed by the Owner`);
    await expect(page.getByLabel("Priority")).toHaveValue("HIGH");

    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(new RegExp(`/tasks/${task.id}$`));
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      title: `${PREFIX} review, renamed by the Owner`,
      priority: "HIGH",
      version: 3,
    });
    await owner.context().close();
  });

  test("keeps editing on request, and conflicts again rather than saving over the latest", async ({ page, browser }) => {
    const task = await seedTask("keep editing");
    const owner = await ownerSession(browser);
    await page.goto(`/tasks/${task.id}/edit`);
    await ownerEdit(owner, task.id, { title: `${PREFIX} keep editing, renamed`, expectedVersion: 1 });

    await page.getByLabel("Description").fill("Pour sequence agreed with the site team.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(conflict(page)).toBeVisible();

    await conflict(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(conflict(page)).toHaveCount(0);
    await expect(page.getByLabel("Description")).toHaveValue("Pour sequence agreed with the site team.");

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(conflict(page)).toBeVisible();
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ title: `${PREFIX} keep editing, renamed`, description: null, version: 2 });
    await owner.context().close();
  });

  test("offers only Restore for a task archived meanwhile, then asks for a fresh review", async ({ page, browser }) => {
    const task = await seedTask("archived meanwhile");
    const owner = await ownerSession(browser);
    await page.goto(`/tasks/${task.id}/edit`);
    await ownerCommand(owner, task.id, "archive", { expectedVersion: 1 });

    await page.getByLabel("Priority").selectOption("CRITICAL");
    await page.getByRole("button", { name: "Save changes" }).click();
    await conflict(page).getByRole("button", { name: "Review latest" }).click();

    await expect(page.getByRole("heading", { name: "This task can no longer be edited" })).toBeVisible();
    await expect(conflict(page).getByRole("button", { name: "Apply to the latest version" })).toHaveCount(0);
    await conflict(page).getByRole("button", { name: "Restore task" }).click();

    // Restored, and reviewed afresh before anything can be saved.
    await expect(page.getByTestId("task-conflict-field-priority")).toBeVisible();
    await conflict(page).getByRole("button", { name: "Apply to the latest version" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(new RegExp(`/tasks/${task.id}$`));
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: "TODO", priority: "CRITICAL", archivedAt: null, version: 4 });
    await owner.context().close();
  });

  test("shows nothing of a task the person can no longer open (TR-18)", async ({ page, browser }) => {
    // The Owner's own task, assigned to the PM: the PM sees it only as its assignee.
    const task = await seedTask("out of sight", { createdByMemberId: OWNER, assigneeMemberId: PM });
    const owner = await ownerSession(browser);
    await page.goto(`/tasks/${task.id}/edit`);
    await ownerEdit(owner, task.id, { title: `${PREFIX} out of sight`, assigneeMemberId: ENGINEER, expectedVersion: 1 });

    // The save itself finds the task out of sight: access outranks the conflict.
    await page.getByLabel("Priority").selectOption("LOW");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("heading", { name: "You can no longer open this task" })).toBeFocused();
    await expect(page.getByLabel("Title")).toHaveCount(0);
    await expect(page.getByLabel("Priority")).toHaveCount(0);
    await page.getByRole("link", { name: "Go to tasks" }).click();
    await page.waitForURL(/\/tasks$/);
    await owner.context().close();
  });

  test("says an unconfirmed save is unconfirmed, keeps the draft and resends nothing", async ({ page }) => {
    const task = await seedTask("lost connection");
    await page.goto(`/tasks/${task.id}/edit`);
    await page.getByLabel("Priority").selectOption("HIGH");

    // The server action is a POST to this page; the connection drops on the way.
    await page.route(`**/tasks/${task.id}/edit`, (route) => (route.request().method() === "POST" ? route.abort("connectionreset") : route.continue()));
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(conflict(page).getByRole("alert")).toHaveText("We couldn't confirm whether this change was saved. Check the latest task before trying again.");
    await expect(page.getByLabel("Priority")).toHaveValue("HIGH");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).version).toBe(1);

    await page.unroute(`**/tasks/${task.id}/edit`);
    await conflict(page).getByRole("button", { name: "Review latest" }).click();
    await expect(page.getByTestId("task-conflict-field-priority")).toBeVisible();
  });
});

test.describe("task actions against a task that moved (TR-22)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("shows the latest state and asks again instead of starting a completed task", async ({ page, browser }) => {
    const task = await seedTask("completed meanwhile");
    const owner = await ownerSession(browser);
    await page.goto(`/tasks/${task.id}`);
    await ownerCommand(owner, task.id, "complete", { expectedVersion: 1 });

    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("This task changed since you opened it. Its latest state is shown now; choose again.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: "COMPLETED", version: 2 });
    await owner.context().close();
  });

  test("keeps the reason dialog open, with its text, until the block is confirmed", async ({ page, browser }) => {
    const task = await seedTask("blocked reason");
    const owner = await ownerSession(browser);
    await page.goto(`/tasks/${task.id}`);

    await page.getByRole("button", { name: "More task actions" }).click();
    await page.getByRole("menuitem", { name: "Mark blocked" }).click();
    const dialog = page.getByRole("dialog");
    const reason = dialog.getByLabel("Reason");
    await expect(reason).toBeFocused();
    await reason.fill("ab");
    await page.keyboard.press("Tab");
    await dialog.getByRole("button", { name: "Mark blocked" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Say why the task is blocked.");

    await ownerEdit(owner, task.id, { title: `${PREFIX} blocked reason, renamed`, expectedVersion: 1 });
    await reason.fill("Waiting for the structural engineer's sign-off");
    await dialog.getByRole("button", { name: "Mark blocked" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("This task changed since you opened it. Its latest state is shown now; choose again.");
    await expect(reason).toHaveValue("Waiting for the structural engineer's sign-off");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("TODO");

    // The page behind has the latest version. Closing the dialog asks first
    // (AUD-03): Stay keeps it, and its reason, and the block goes through now.
    await expect(page.getByRole("heading", { name: `${PREFIX} blocked reason, renamed` })).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("unsaved-prompt")).toBeVisible();
    await page.getByTestId("unsaved-stay").click();
    await expect(reason).toHaveValue("Waiting for the structural engineer's sign-off");
    await dialog.getByRole("button", { name: "Mark blocked" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("task-blocked-reason")).toContainText("Waiting for the structural engineer's sign-off");
    await owner.context().close();
  });
});

test.describe("the conflict review at every width, by keyboard (TR-22)", () => {
  test("fits 360, 390, 768 and 1440 px without sideways scrolling, and every control is reachable", async ({ page, browser }) => {
    await signIn(page, "PROJECT_MANAGER");
    const shots = process.env.AUD02_SHOTS;
    const owner = await ownerSession(browser);

    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const task = await seedTask(`width ${width}`);
      await page.goto(`/tasks/${task.id}/edit`);
      await ownerEdit(owner, task.id, { title: `${PREFIX} width ${width}, renamed by the Owner with a longer title`, expectedVersion: 1 });

      await page.getByLabel("Description").fill("A longer note the PM typed, which must wrap inside the review rather than push the page sideways.");
      await page.getByLabel("Priority").selectOption("CRITICAL");
      await page.getByRole("button", { name: "Save changes" }).click();
      const heading = page.getByRole("heading", { name: "Your changes have not been saved" });
      await expect(heading).toBeFocused();

      // By keyboard: from the focused heading, Tab reaches Review latest.
      await page.keyboard.press("Tab");
      await expect(conflict(page).getByRole("button", { name: "Review latest" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Review the latest version" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("task-conflict-field-description").getByRole("checkbox")).toBeFocused();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${width}px scrolls sideways`).toBeLessThanOrEqual(0);
      if (shots) await page.screenshot({ path: `${shots}/task-conflict-${width}.png`, fullPage: true });
    }
    await owner.context().close();
  });
});
