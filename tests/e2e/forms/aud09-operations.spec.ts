import { expect, test, type Request } from "@playwright/test";

import { db, removeTestTasks } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { removeMeetings } from "../meetings-cleanup";

/**
 * The operations forms in the browser (AUD-09 §3, §5, §6; FV-02, FV-03,
 * FV-08, FV-09, FV-10, FV-11, FV-12, FV-13).
 *
 * Written for the final AUD-09 run, not yet run. The payload contract is
 * proved on the server in tests/api/{tasks,clients,projects,meetings,
 * daily-logs,project-planning,project-structure}/aud09-*.test.ts; this is
 * what only a browser can show: a dependent picker reloading when its parent
 * changes, a note when a value is cleared, native constraint messages, Enter in
 * a multi-line field, a double click, focus moving to the first invalid field,
 * and the Clients "Create anyway" decision.
 *
 * Every record is named `aud09ops…`, and swept after the file.
 */

const PREFIX = "aud09ops";

test.afterAll(async () => {
  await removeTestTasks(PREFIX);
  const clients = await db.client.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  await db.activity.deleteMany({ where: { entityId: { in: clients.map((row) => row.id) } } });
  await db.contact.deleteMany({ where: { clientId: { in: clients.map((row) => row.id) } } });
  await db.client.deleteMany({ where: { id: { in: clients.map((row) => row.id) } } });
  await removeMeetings(PREFIX);
  await db.$disconnect();
});

test.describe("task form (Project Manager)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
  });

  test("the assignee list follows the project, and an assignee off the new team is cleared with a note (FV-08)", async ({ page }) => {
    const main = mainRegion(page);
    const project = main.getByLabel("Project");
    const assignee = main.getByLabel("Assignee");

    // No project: the whole company is offered; the Owner is chosen.
    await expect(project).toHaveValue("");
    await assignee.selectOption("member_owner");

    // Project A: the list is read again. The Owner is not on its team, so the
    // choice is cleared, visibly — never replaced by the first person listed.
    await project.selectOption("project_a");
    await expect(assignee).toHaveAttribute("data-picker-state", "ready");
    await expect(assignee).toHaveValue("");
    await expect(main.getByTestId("task-assignee-cleared")).toContainText("is not on this project's team");
    await expect(assignee.locator('option[value="member_owner"]')).toHaveCount(0);

    // A team member is kept when the project changes back and forth.
    await assignee.selectOption("member_engineer");
    await project.selectOption("");
    await expect(assignee).toHaveAttribute("data-picker-state", "ready");
    await expect(assignee).toHaveValue("member_engineer");
    await expect(main.getByTestId("task-assignee-cleared")).toHaveCount(0);
  });

  test("a slow answer for an earlier project never repopulates the picker (FV-08)", async ({ page }) => {
    const main = mainRegion(page);
    // Hold the first options request (Project A) until after the second has answered.
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    let calls = 0;
    let markFirst!: (request: Request) => void;
    const firstRequest = new Promise<Request>((resolve) => (markFirst = resolve));
    await page.route("**/tasks/new**", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && (await request.headerValue("next-action"))) {
        calls += 1;
        if (calls === 1) {
          markFirst(request);
          await firstHeld;
        }
      }
      await route.continue();
    });

    await main.getByLabel("Project").selectOption("project_a");
    await expect(main.getByLabel("Assignee")).toHaveAttribute("data-picker-state", "loading");
    await main.getByLabel("Project").selectOption("");
    await expect(main.getByLabel("Assignee")).toHaveAttribute("data-picker-state", "ready");
    // The whole company, the Owner included: the "no project" answer.
    await expect(main.getByLabel("Assignee").locator('option[value="member_owner"]')).toHaveCount(1);

    const held = await firstRequest;
    const late = page.waitForResponse((response) => response.request() === held);
    releaseFirst();
    await late;
    // The late Project A answer is ignored: the Owner is still offered.
    await expect(main.getByLabel("Assignee").locator('option[value="member_owner"]')).toHaveCount(1);
    await page.unroute("**/tasks/new**");
  });

  test("couldn't load options is its own state, with Retry (FV-09)", async ({ page }) => {
    const main = mainRegion(page);
    let fail = true;
    await page.route("**/tasks/new**", async (route) => {
      const request = route.request();
      if (fail && request.method() === "POST" && (await request.headerValue("next-action"))) return route.abort("failed");
      return route.continue();
    });

    await main.getByLabel("Project").selectOption("project_a");
    await expect(main.getByLabel("Assignee")).toHaveAttribute("data-picker-state", "error");
    await expect(main.getByLabel("Assignee")).toBeDisabled();
    await expect(main.getByRole("alert").filter({ hasText: "Couldn't load" })).toBeVisible();

    fail = false;
    await main.getByRole("button", { name: "Retry" }).click();
    await expect(main.getByLabel("Assignee")).toHaveAttribute("data-picker-state", "ready");
    await expect(main.getByLabel("Assignee")).toBeEnabled();
    await page.unroute("**/tasks/new**");
  });

  test("a due date before the start is stopped before sending, and Enter in the description does not submit (FV-04, FV-12)", async ({ page }) => {
    const main = mainRegion(page);
    await main.getByLabel("Title").fill(`${PREFIX} schedule`);
    await main.getByLabel("Description").fill("First line");
    await main.getByLabel("Description").press("Enter");
    await main.getByLabel("Description").pressSequentially("Second line");
    await expect(page).toHaveURL(/\/tasks\/new/);
    await expect(main.getByLabel("Description")).toHaveValue("First line\nSecond line");

    await main.getByLabel("Start date").fill("2031-05-10");
    await main.getByLabel("Due date").fill("2031-05-09");
    await main.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/tasks\/new/);
    expect(await main.getByLabel("Due date").evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);
    expect(await db.task.count({ where: { title: `${PREFIX} schedule` } })).toBe(0);
  });

  test("a double click creates one task (FV-12)", async ({ page }) => {
    const main = mainRegion(page);
    const title = `${PREFIX} once ${Date.now().toString(36)}`;
    await main.getByLabel("Title").fill(title);
    await main.getByRole("button", { name: "Create task" }).dblclick();
    await page.waitForURL(/\/tasks\/[^/]+$/);
    expect(await db.task.count({ where: { title } })).toBe(1);
  });
});

test.describe("task edit keeps what the pickers cannot offer (FV-10)", () => {
  test("an inactive assignee is shown as the current assignee and survives an untouched save", async ({ page }) => {
    const task = await db.task.create({
      data: { companyId: "company_demo_a", projectId: "project_a", title: `${PREFIX} legacy`, assigneeMemberId: "member_architect", status: "TODO", createdByMemberId: "member_pm", createdBy: "user_pm" },
    });
    await db.companyMember.update({ where: { id: "member_architect" }, data: { status: "INACTIVE" } });
    try {
      await signIn(page, "PROJECT_MANAGER", { to: `/tasks/${task.id}/edit` });
      const main = mainRegion(page);
      await expect(main.getByLabel("Assignee")).toHaveValue("member_architect");
      await expect(main.getByText("no longer active")).toBeVisible();
      await main.getByLabel("Title").fill(`${PREFIX} legacy kept`);
      await main.getByRole("button", { name: "Save changes" }).click();
      await page.waitForURL(new RegExp(`/tasks/${task.id}$`));
      expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ title: `${PREFIX} legacy kept`, assigneeMemberId: "member_architect" });
    } finally {
      await db.companyMember.update({ where: { id: "member_architect" }, data: { status: "ACTIVE" } });
    }
  });
});

test.describe("client form (Sales)", () => {
  test("a soft duplicate asks once; Create anyway creates; a taken code lands on the code field (FV-11, FV-13)", async ({ page }) => {
    const name = `${PREFIX} Client ${Date.now().toString(36)}`;
    const code = `AUD09OPS-${Date.now().toString(36).toUpperCase()}`;
    await signIn(page, "SALES", { to: "/clients/new" });
    const main = mainRegion(page);
    await main.getByLabel("Client name").fill(name);
    await main.getByLabel("Client code").fill(code);
    await main.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[^/]+$/);

    // The same name again: the warning, with a link to the match, and nothing created.
    await page.goto("/clients/new");
    await main.getByLabel("Client name").fill(name);
    await main.getByLabel("Client code").fill(code);
    await main.getByRole("button", { name: "Create client" }).click();
    await expect(main.getByRole("alert").filter({ hasText: "A similar client already exists." })).toBeVisible();
    expect(await db.client.count({ where: { name } })).toBe(1);

    // Create anyway with the taken code: the unique code still refuses, on its field, and the input is kept.
    await main.getByRole("button", { name: "Create anyway" }).click();
    await expect(main.getByText("That client code is already used in your company. Choose another code.").first()).toBeVisible();
    await expect(main.getByLabel("Client name")).toHaveValue(name);
    expect(await db.client.count({ where: { name } })).toBe(1);

    // A free code, and the warning answered again: now it is created.
    await main.getByLabel("Client code").fill(`${code}-2`);
    await main.getByRole("button", { name: "Create client" }).click();
    await main.getByRole("button", { name: "Create anyway" }).click();
    await page.waitForURL(/\/clients\/[^/]+$/);
    expect(await db.client.count({ where: { name } })).toBe(2);
  });
});

test.describe("meeting form (Project Manager)", () => {
  test("an end before the start focuses the end time, with its message linked (FV-03)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/meetings/new" });
    const form = page.getByTestId("meeting-form");
    await form.getByLabel("Title").fill(`${PREFIX} meeting`);
    await form.getByLabel("Start").fill("10:00");
    await form.getByLabel("End").fill("09:30");
    await form.getByRole("button", { name: "Schedule meeting" }).click();

    const end = form.getByLabel("End");
    await expect(end).toBeFocused();
    await expect(end).toHaveAttribute("aria-invalid", "true");
    await expect(end).toHaveAttribute("aria-describedby", "meeting-endTime-error");
    await expect(page.locator("#meeting-endTime-error")).toHaveText("The meeting must end after it starts.");
    expect(await db.meeting.count({ where: { title: `${PREFIX} meeting` } })).toBe(0);
  });
});
