import { expect, test } from "../pw";

import { db, removeTestTasks } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * The Tasks journey (PRD #11 §228–§236).
 *
 * Runs against the seeded demo data, so what these specs assert is what a real
 * person signing in as that role would meet.
 */
const TEST_PREFIX = "E2E task";

test.afterAll(async () => {
  await removeTestTasks(TEST_PREFIX);
  await db.$disconnect();
});

test.describe("Project Manager (PRD #11 §229)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("moves a task through its whole lifecycle", async ({ page }) => {
    await page.goto("/tasks/new");

    const title = `${TEST_PREFIX} lifecycle`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Priority").selectOption("HIGH");
    await page.getByRole("button", { name: "Create task" }).click();

    await page.waitForURL(/\/tasks\/[^/]+$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Start → Complete → Reopen, each a dedicated action (PRD #11 §159).
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("In Progress").first()).toBeVisible();

    await page.getByRole("button", { name: "Complete" }).click();
    await expect(page.getByText("Completed").first()).toBeVisible();

    await page.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByText("To Do").first()).toBeVisible();
  });

  test("keeps Project C tasks out of the list (PRD #11 §220)", async ({ page }) => {
    await page.goto("/tasks/all?search=Marina");
    await expect(mainRegion(page).getByText(/no tasks match these filters/i)).toBeVisible();
  });

  test("answers not found for a task outside scope (PRD #11 §206)", async ({ page }) => {
    const hidden = await db.task.findFirst({
      where: { projectId: "project_c" },
      select: { id: true },
    });

    const response = await page.goto(`/tasks/${hidden!.id}`);
    expect(response?.status()).toBe(404);
  });

  test("shows the same task inside the project it belongs to (PRD #11 §12)", async ({ page }) => {
    const task = await db.task.findFirstOrThrow({
      where: { projectId: "project_a", archivedAt: null },
      select: { id: true, title: true },
    });

    await page.goto("/projects/project_a/tasks");
    await expect(page.getByRole("link", { name: new RegExp(task.title) }).first()).toBeVisible();

    // The row opens the canonical task URL, not a project-local copy.
    await page.getByRole("link", { name: new RegExp(task.title) }).first().click();
    await page.waitForURL(new RegExp(`/tasks/${task.id}$`));
  });

  test("keeps filters and search in the URL (PRD #11 §223)", async ({ page }) => {
    await page.goto("/tasks/all?status=BLOCKED&sort=priority-desc");

    const main = mainRegion(page);
    await expect(main.getByLabel("Status")).toHaveValue("BLOCKED");
    await expect(main.getByLabel("Sort")).toHaveValue("priority-desc");

    await page.reload();
    await expect(mainRegion(page).getByLabel("Status")).toHaveValue("BLOCKED");
  });
});

test.describe("Architect (PRD #11 §230)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "ARCHITECT");
  });

  test("sees only their own work under My Tasks", async ({ page }) => {
    await page.goto("/tasks/my-tasks");
    await expect(
      mainRegion(page).getByRole("link", { name: /Review apartment layouts/ }).first(),
    ).toBeVisible();
  });

  /** Without task.assign the picker offers this user alone (PRD #11 §122). */
  test("cannot assign work to somebody else", async ({ page }) => {
    await page.goto("/tasks/new");

    const options = await mainRegion(page)
      .getByLabel("Assignee")
      .locator("option")
      .allTextContents();
    expect(options.filter((option) => option.trim() !== "Unassigned")).toHaveLength(1);
    expect(options.join(" ")).toContain("(you)");
  });
});

test.describe("Viewer (PRD #11 §228)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "VIEWER");
  });

  test("is offered no mutation controls at all", async ({ page }) => {
    await page.goto("/tasks/my-tasks");

    await expect(page.getByRole("link", { name: "New task" })).toHaveCount(0);

    const task = await db.task.findFirstOrThrow({
      where: { assignee: { user: { email: "viewer@nesto.test" } } },
      select: { id: true },
    });

    await page.goto(`/tasks/${task.id}`);
    await expect(page.getByRole("button", { name: "Complete" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);
  });

  test("is refused a direct mutation API call (PRD #11 §228)", async ({ page }) => {
    const task = await db.task.findFirstOrThrow({
      where: { assignee: { user: { email: "viewer@nesto.test" } } },
      select: { id: true },
    });

    const response = await page.request.post(`/api/tasks/${task.id}/complete`);
    expect(response.status()).toBe(403);
  });
});
