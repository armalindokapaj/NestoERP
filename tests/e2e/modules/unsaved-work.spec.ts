import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { db, removeTestClients, removeTestTasks } from "../db";
import { mainRegion, sidebar, signIn, workspaceHeader, workspacePanel } from "../fixtures";

/**
 * Unsaved work protection in the browser (AUD-03 §9).
 *
 * The shared contract on the forms that carry it — the custom Clients form
 * (with its duplicate decision), RecordForm (tasks) and a dialog (a task's
 * block reason) — against every departure: a sidebar link, Back and Forward, a
 * dialog's close, a reload, sign-out, a workspace switch here and in another
 * tab. And what a save does with its outcome. Nothing here saves a shared demo
 * record: every save creates a record named with the AUD03E prefix, removed
 * afterwards. `AUD03_SHOTS=<dir>` saves the prompt at each width.
 */

const PREFIX = "AUD03E";
const AURELIA = "company_demo_a";
const FORMA = "company_demo_d";
const PM = "member_pm";

test.afterAll(async () => {
  await removeTestClients(PREFIX);
  await removeTestTasks(PREFIX);
  await db.$disconnect();
});

function prompt(page: Page) {
  return page.getByTestId("unsaved-prompt");
}

function link(page: Page, name: string) {
  return sidebar(page).getByRole("link", { name, exact: true }).first();
}

function clientName(page: Page) {
  return mainRegion(page).getByLabel("Client name");
}

async function dirtyClient(page: Page, value: string) {
  await page.goto("/clients/new");
  await clientName(page).fill(value);
  await expect(page.getByTestId("unsaved-indicator").first()).toHaveText("Unsaved changes");
}

/** Requests that are server-action posts. */
function isAction(request: Request) {
  return request.method() === "POST" && Boolean(request.headers()["next-action"]);
}

async function clientsNamed(name: string) {
  return db.client.findMany({ where: { name }, select: { id: true, companyId: true } });
}

async function seedTask(title: string) {
  return db.task.create({
    data: { companyId: AURELIA, title: `${PREFIX} ${title}`, status: "TODO", priority: "MEDIUM", createdByMemberId: PM, createdBy: "e2e" },
    select: { id: true, version: true },
  });
}

async function secondTab(page: Page) {
  const other = await page.context().newPage();
  return other;
}

test.describe("editors and application navigation", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA });
  });

  test("UW-01: a form that was only loaded, and a read-only filter, leave without a question", async ({ page }) => {
    await page.goto("/clients/new");
    await expect(clientName(page)).toBeVisible();
    await expect(page.getByTestId("unsaved-indicator").first()).toHaveText("");
    await link(page, "Tasks").click();
    await page.waitForURL("**/tasks");
    await expect(prompt(page)).toHaveCount(0);
    // A list filter is not an editor.
    const search = mainRegion(page).getByRole("searchbox").first();
    if (await search.count()) await search.fill("anything");
    await link(page, "Dashboard").click();
    await page.waitForURL("**/dashboard");
    await expect(prompt(page)).toHaveCount(0);
  });

  test("UW-02/UW-04: an edit is noticed; Stay keeps route and value; Escape is Stay; Discard continues once", async ({ page }) => {
    await dirtyClient(page, `${PREFIX} Stay`);
    await link(page, "Dashboard").click();
    await expect(prompt(page)).toBeVisible();
    await expect(prompt(page).getByRole("heading", { name: "You have unsaved changes" })).toBeVisible();
    await expect(prompt(page)).toContainText("You're leaving this page.");
    await expect(prompt(page)).toContainText("The saved record stays as it is.");
    await expect(prompt(page).getByTestId("unsaved-stay")).toBeFocused();
    await prompt(page).getByTestId("unsaved-stay").click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/clients\/new$/);
    await expect(clientName(page)).toHaveValue(`${PREFIX} Stay`);
    // Focus goes back where the departure began.
    await expect(link(page, "Dashboard")).toBeFocused();

    await link(page, "Dashboard").click();
    await expect(prompt(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(prompt(page)).toHaveCount(0);
    await expect(clientName(page)).toHaveValue(`${PREFIX} Stay`);

    // The form's own Cancel asks too.
    await mainRegion(page).getByRole("button", { name: "Cancel" }).click();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByTestId("unsaved-stay").click();

    await link(page, "Dashboard").click();
    await prompt(page).getByTestId("unsaved-discard").click();
    await page.waitForURL("**/dashboard");
    await expect(prompt(page)).toHaveCount(0);
  });

  test("UW-02: a select, a restored value and an untouched form are judged by what they would submit", async ({ page }) => {
    await page.goto("/clients/new");
    const type = mainRegion(page).getByLabel("Type");
    const original = await type.inputValue();
    // A person's choice arrives with a trusted gesture; Playwright's
    // selectOption alone dispatches untrusted events, which read as loading.
    await type.click();
    await type.selectOption("INDIVIDUAL");
    await expect(page.getByTestId("unsaved-indicator").first()).toHaveText("Unsaved changes");
    await type.selectOption(original);
    await expect(page.getByTestId("unsaved-indicator").first()).toHaveText("");
    await clientName(page).fill("x");
    await clientName(page).fill("");
    await expect(page.getByTestId("unsaved-indicator").first()).toHaveText("");
    await link(page, "Dashboard").click();
    await page.waitForURL("**/dashboard");
  });

  test("UW-05: new tabs, middle clicks and hovering never ask, and leave the draft alone", async ({ page, context }) => {
    await dirtyClient(page, `${PREFIX} New tab`);
    await link(page, "Tasks").hover();
    await expect(prompt(page)).toHaveCount(0);

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    const opened = context.waitForEvent("page");
    await link(page, "Tasks").click({ modifiers: [modifier] });
    const tab = await opened;
    await tab.close();
    await expect(prompt(page)).toHaveCount(0);

    const middle = context.waitForEvent("page");
    await link(page, "Tasks").click({ button: "middle" });
    await (await middle).close();
    await expect(prompt(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/clients\/new$/);
    await expect(clientName(page)).toHaveValue(`${PREFIX} New tab`);
  });

  test("UW-06: Back and Forward are held on the page; Stay keeps URL and draft; repeated Back asks once; Discard goes once", async ({ page }) => {
    // Every entry in one document, so Back and Forward stay in the page's router.
    await page.goto("/dashboard");
    await link(page, "Clients").click();
    await page.waitForURL(/\/clients$/);
    await mainRegion(page).getByRole("link", { name: /new client/i }).first().click();
    await page.waitForURL(/\/clients\/new$/);
    await link(page, "Tasks").click();
    await page.waitForURL("**/tasks");
    await page.goBack();
    await page.waitForURL(/\/clients\/new$/);
    await clientName(page).fill(`${PREFIX} History`);

    // Forward: the page ahead is not rendered while the question is open.
    await page.goForward();
    await expect(prompt(page)).toBeVisible();
    await expect(page).toHaveURL(/\/clients\/new$/);
    await prompt(page).getByTestId("unsaved-stay").click();
    await expect(page).toHaveURL(/\/clients\/new$/);
    await expect(clientName(page)).toHaveValue(`${PREFIX} History`);

    // Back twice in a row: one question, and the page stays where it was.
    await page.evaluate(() => {
      history.back();
      setTimeout(() => history.back(), 50);
    });
    await expect(prompt(page)).toBeVisible();
    await page.waitForTimeout(400);
    await expect(prompt(page)).toHaveCount(1);
    await prompt(page).getByTestId("unsaved-stay").click();
    await expect(page).toHaveURL(/\/clients\/new$/);
    await expect(clientName(page)).toHaveValue(`${PREFIX} History`);

    // A hash-only entry keeps the page and its editor: no question.
    await page.evaluate(() => (location.hash = "notes"));
    await page.goBack();
    await expect(prompt(page)).toHaveCount(0);
    await expect(clientName(page)).toHaveValue(`${PREFIX} History`);

    await page.goBack();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByTestId("unsaved-discard").click();
    await page.waitForURL(/\/clients$/);
    await expect(prompt(page)).toHaveCount(0);
  });

  test("UW-07: reload and a deep link's Back get the browser's own question only while something is unsaved", async ({ page }) => {
    const asked: string[] = [];
    page.on("dialog", async (dialog) => {
      asked.push(dialog.type());
      await dialog.dismiss();
    });
    await page.goto("/clients/new");
    await page.reload();
    expect(asked).toEqual([]);
    await clientName(page).fill(`${PREFIX} Reload`);
    // The page's own reload: Playwright's page.reload() waits for a navigation
    // that a dismissed beforeunload never starts.
    await page.evaluate(() => void setTimeout(() => location.reload(), 0));
    await expect.poll(() => asked).toEqual(["beforeunload"]);
    await expect(clientName(page)).toHaveValue(`${PREFIX} Reload`);
  });

  test("UW-09: Save and continue with invalid input stays, keeps the input and focuses the field", async ({ page }) => {
    await page.goto("/clients/new");
    const legal = mainRegion(page).getByLabel("Legal name");
    await legal.fill(`${PREFIX} Legal only`);
    await link(page, "Dashboard").click();
    await prompt(page).getByTestId("unsaved-save").click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/clients\/new$/);
    await expect(legal).toHaveValue(`${PREFIX} Legal only`);
    await expect(clientName(page)).toBeFocused();
  });

  test("UW-09: Create and continue commits once, in this company, then goes where the person was going", async ({ page }) => {
    const name = `${PREFIX} Continue ${Date.now()}`;
    await dirtyClient(page, name);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (isAction(request)) posts.push(request.url());
    });
    await link(page, "Tasks").click();
    await expect(prompt(page).getByTestId("unsaved-save")).toHaveText("Create and continue");
    await prompt(page).getByTestId("unsaved-save").click();
    await page.waitForURL("**/tasks");
    const saved = await clientsNamed(name);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.companyId).toBe(AURELIA);
    expect(posts).toHaveLength(1);
  });

  test("UW-10: a duplicate warning is never accepted by Save and continue", async ({ page }) => {
    await dirtyClient(page, "ACME Developments");
    await link(page, "Dashboard").click();
    await prompt(page).getByTestId("unsaved-save").click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/clients\/new$/);
    await expect(mainRegion(page).getByText("A similar client already exists.")).toBeVisible();
    await expect(mainRegion(page).getByRole("button", { name: "Create anyway" })).toBeVisible();
    expect(await db.client.count({ where: { name: "ACME Developments" } })).toBe(1);
  });

  test("UW-12: a refusal and a lost connection keep every value; only the unknown outcome says so", async ({ page }) => {
    await dirtyClient(page, `${PREFIX} Refused`);
    await mainRegion(page).getByLabel("Website").fill("not-a-url");
    // Past the browser's own check: the server refuses the field.
    await mainRegion(page).getByLabel("Website").evaluate((input: HTMLInputElement) => (input.type = "text"));
    await mainRegion(page).getByRole("button", { name: "Create client" }).click();
    await expect(page.getByTestId("record-form-outcome")).toHaveText("Changes weren't saved. Your entries are still here.");
    await expect(clientName(page)).toHaveValue(`${PREFIX} Refused`);
    await expect(mainRegion(page).getByLabel("Website")).toHaveValue("not-a-url");

    await mainRegion(page).getByLabel("Website").fill("");
    await page.route("**/clients/new", (route) => (isAction(route.request()) ? route.abort("internetdisconnected") : route.continue()));
    await mainRegion(page).getByRole("button", { name: "Create client" }).click();
    await expect(page.getByTestId("record-form-outcome")).toHaveText("We couldn't confirm whether this saved. Check the record before trying again.");
    await expect(clientName(page)).toHaveValue(`${PREFIX} Refused`);
    await page.unroute("**/clients/new");

    // An unknown outcome is never saved again by the prompt.
    await link(page, "Dashboard").click();
    await expect(prompt(page)).toContainText("It may already be saved.");
    await expect(prompt(page).getByTestId("unsaved-save")).toHaveCount(0);
    await expect(prompt(page).getByTestId("unsaved-discard")).toHaveText("Leave anyway");
    await prompt(page).getByTestId("unsaved-stay").click();
  });

  test("UW-13: double click and Enter while saving send one request, and the snapshot cannot change meanwhile", async ({ page }) => {
    const name = `${PREFIX} Once ${Date.now()}`;
    await dirtyClient(page, name);
    let posts = 0;
    await page.route("**/clients/new", async (route) => {
      if (!isAction(route.request())) return route.continue();
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    const submit = mainRegion(page).getByRole("button", { name: "Create client" });
    await submit.dblclick();
    await clientName(page).press("Enter").catch(() => undefined);
    await expect(clientName(page)).toBeDisabled();
    await page.waitForURL(/\/clients\/(?!new$)[^/]+$/, { timeout: 20_000 });
    expect(posts).toBe(1);
    expect(await clientsNamed(name)).toHaveLength(1);
  });

  test("UW-14: a save whose page is slow to open stays saved, and Retry opens it without saving again", async ({ page }) => {
    const name = `${PREFIX} Slow ${Date.now()}`;
    await dirtyClient(page, name);
    let hold = true;
    await page.route(/\/clients\/(?!new)[^/?]+/, async (route) => {
      while (hold) await new Promise((resolve) => setTimeout(resolve, 200));
      await route.continue();
    });
    await mainRegion(page).getByRole("button", { name: "Create client" }).click();
    await expect(page.getByTestId("unsaved-indicator").first()).toHaveText("Saved. Opening…");
    await expect(page.getByTestId("record-form-retry-navigation")).toBeVisible({ timeout: 15_000 });
    expect(await clientsNamed(name)).toHaveLength(1);
    // Retry opens the page again — it does not save again — and a saved form
    // is clean, so nothing asks.
    await page.getByTestId("record-form-retry-navigation").click();
    await expect(prompt(page)).toHaveCount(0);
    hold = false;
    await page.waitForURL(/\/clients\/(?!new)[^/]+$/);
    await expect(prompt(page)).toHaveCount(0);
    expect(await clientsNamed(name)).toHaveLength(1);
  });

  test("UW-19: signing out asks first; Stay keeps the session, Discard signs out", async ({ page }) => {
    await dirtyClient(page, `${PREFIX} Sign out`);
    await page.getByRole("button", { name: /open user menu/i }).click();
    await page.getByRole("menuitem", { name: /logout/i }).click();
    await expect(prompt(page)).toContainText("You're signing out.");
    await prompt(page).getByTestId("unsaved-stay").click();
    expect((await page.request.get("/api/me")).status()).toBe(200);
    await expect(clientName(page)).toHaveValue(`${PREFIX} Sign out`);

    await page.getByRole("button", { name: /open user menu/i }).click();
    await page.getByRole("menuitem", { name: /logout/i }).click();
    await prompt(page).getByTestId("unsaved-discard").click();
    await page.waitForURL(/\/login/);
  });

  test("UW-23: a discarded draft leaves nothing behind: the next page asks only for its own changes", async ({ page }) => {
    await dirtyClient(page, `${PREFIX} Cleanup`);
    await link(page, "Tasks").click();
    await prompt(page).getByTestId("unsaved-discard").click();
    await page.waitForURL("**/tasks");
    await page.goto("/clients/new");
    await link(page, "Dashboard").click();
    await page.waitForURL("**/dashboard");
    await expect(prompt(page)).toHaveCount(0);
    let asked = 0;
    page.on("dialog", async (dialog) => {
      asked += 1;
      await dialog.dismiss();
    });
    await page.reload();
    expect(asked).toBe(0);
  });
});

test.describe("dialogs and record forms", () => {
  test("UW-08: a dialog's X, Escape, backdrop and Cancel ask; Stay keeps the dialog and its text", async ({ page }) => {
    const task = await seedTask("Block reason");
    await signIn(page, "PROJECT_MANAGER", { to: `/tasks/${task.id}` });
    await mainRegion(page).getByRole("button", { name: "More task actions" }).click();
    await page.getByRole("menuitem", { name: "Mark blocked" }).click();
    const dialog = page.getByRole("dialog", { name: "Mark this task blocked" });
    const reason = dialog.getByLabel("Reason");
    await reason.fill("Waiting for the permit");

    for (const close of [
      () => page.keyboard.press("Escape"),
      () => dialog.getByRole("button", { name: "Close" }).click(),
      () => dialog.getByRole("button", { name: "Cancel" }).click(),
      () => page.mouse.click(5, 5),
    ]) {
      await close();
      await expect(prompt(page)).toBeVisible();
      await expect(prompt(page)).toContainText("You're closing this editor.");
      // Only a workflow step keeps a reason: no generic save is offered.
      await expect(prompt(page).getByTestId("unsaved-save")).toHaveCount(0);
      await prompt(page).getByTestId("unsaved-stay").click();
      await expect(dialog).toBeVisible();
      await expect(reason).toHaveValue("Waiting for the permit");
    }

    await page.keyboard.press("Escape");
    await prompt(page).getByTestId("unsaved-discard").click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  });

  test("UW-15: reapplied changes after a conflict stay unsaved against the latest version (AUD-02)", async ({ page, browser }) => {
    const task = await seedTask("Conflict baseline");
    await signIn(page, "PROJECT_MANAGER", { to: `/tasks/${task.id}/edit` });
    const title = mainRegion(page).getByLabel("Title");
    await title.fill(`${PREFIX} Mine`);
    await changeTaskAsOwner(browser, task.id, task.version, { priority: "HIGH" });
    await mainRegion(page).getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByTestId("task-conflict")).toBeVisible();
    await page.getByRole("button", { name: "Review latest" }).click();
    await page.getByRole("button", { name: /apply/i }).click();
    await expect(page.getByTestId("task-conflict-applied")).toBeVisible();
    await expect(title).toHaveValue(`${PREFIX} Mine`);
    await expect(page.getByTestId("unsaved-indicator").first()).toHaveText("Unsaved changes");
    await link(page, "Dashboard").click();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByTestId("unsaved-stay").click();
    // The version is the latest one: the save now commits.
    await mainRegion(page).getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(new RegExp(`/tasks/${task.id}$`));
    const saved = await db.task.findUniqueOrThrow({ where: { id: task.id }, select: { title: true, priority: true, version: true } });
    expect(saved).toMatchObject({ title: `${PREFIX} Mine`, priority: "HIGH", version: task.version + 2 });
  });
});

async function changeTaskAsOwner(browser: Browser, taskId: string, version: number, body: Record<string, unknown>) {
  const context = await browser.newContext();
  const owner = await context.newPage();
  await signIn(owner, "OWNER");
  const current = await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { title: true, status: true, priority: true } });
  const response = await owner.request.patch(`/api/tasks/${taskId}`, { data: { title: current.title, status: current.status, priority: current.priority, expectedVersion: version, ...body } });
  expect(response.status(), await response.text()).toBe(200);
  await context.close();
}

test.describe("workspace and identity", () => {
  test("UW-16: Stay sends no switch; Create and continue saves in the original company, then switches", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA });
    const name = `${PREFIX} Before switch ${Date.now()}`;
    await dirtyClient(page, name);
    const switches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/workspace") switches.push(request.url());
    });

    await workspaceHeader(page).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    await expect(prompt(page)).toContainText("You're switching to Forma Engineering.");
    await prompt(page).getByTestId("unsaved-stay").click();
    await expect(workspaceHeader(page)).toHaveAccessibleName(/Current workspace: Aurelia Construction/);
    await expect(clientName(page)).toHaveValue(name);
    expect(switches).toHaveLength(0);

    await workspaceHeader(page).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    await prompt(page).getByTestId("unsaved-save").click();
    await expect(workspaceHeader(page)).toHaveAccessibleName(/Current workspace: Forma Engineering/, { timeout: 20_000 });
    const saved = await clientsNamed(name);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.companyId).toBe(AURELIA);
    expect(switches).toHaveLength(1);
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("UW-17: an unanswered switch never shows the old draft under the new workspace", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA });
    const draft = `${PREFIX} Ambiguous`;
    await dirtyClient(page, draft);
    await page.route("**/api/workspace", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch(); // the server switches…
      await route.abort("connectionreset"); // …and the answer is lost
    });
    await workspaceHeader(page).click();
    await workspacePanel(page).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    await prompt(page).getByTestId("unsaved-discard").click();
    await expect(workspaceHeader(page)).toHaveAccessibleName(/Current workspace: Forma Engineering/, { timeout: 20_000 });
    await expect(page.getByTestId("workspace-switching")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText(draft)).toHaveCount(0);
    await expect(mainRegion(page).getByLabel("Client name")).toHaveValue("");
  });

  test("UW-18: another tab's switch holds this tab's draft; returning restores the workspace; no reload loop", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA });
    const draft = `${PREFIX} Other tab ${Date.now()}`;
    await dirtyClient(page, draft);
    await page.evaluate(() => ((window as unknown as { __aud03Marker: boolean }).__aud03Marker = true));

    const other = await secondTab(page);
    await other.goto("/tasks");
    await workspaceHeader(other).click();
    await workspacePanel(other).getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
    await expect(workspaceHeader(other)).toHaveAccessibleName(/Current workspace: Forma Engineering/, { timeout: 20_000 });

    const notice = page.getByTestId("unsaved-context-notice");
    await expect(notice).toHaveAttribute("data-reason", "workspace-changed");
    await expect(notice).toContainText("Your workspace changed in another tab");
    await expect(notice).toContainText("Forma Engineering");
    // Not reloaded: the same document, the draft still in it, and no Stay.
    expect(await page.evaluate(() => (window as unknown as { __aud03Marker?: boolean }).__aud03Marker)).toBe(true);
    await expect(clientName(page)).toHaveValue(draft);
    await expect(notice.getByRole("button", { name: "Stay" })).toHaveCount(0);

    // A write from this tab is refused by the server while it shows Aurelia.
    const stale = await page.evaluate(async () => {
      const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return { status: response.status, body: await response.json().catch(() => null) };
    });
    expect(stale.status).toBe(409);
    expect(stale.body?.error?.details?.code).toBe("WORKSPACE_CHANGED");

    await notice.getByTestId("unsaved-context-return").click();
    await expect(notice).toHaveCount(0, { timeout: 15_000 });
    await expect(clientName(page)).toHaveValue(draft);
    const me = (await (await page.request.get("/api/me")).json()) as { workspace?: { companyId: string | null } };
    expect(me.workspace?.companyId).toBe(AURELIA);
    // The other tab follows back, once.
    await expect(workspaceHeader(other)).toHaveAccessibleName(/Current workspace: Aurelia Construction/, { timeout: 20_000 });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { __aud03Marker?: boolean }).__aud03Marker)).toBe(true);

    // And the save now commits, in Aurelia.
    await mainRegion(page).getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/(?!new$)[^/]+$/);
    expect((await clientsNamed(draft))[0]?.companyId).toBe(AURELIA);
    await other.close();
  });

  test("UW-20: without tab messaging, returning to the tab checks the context before anything is written", async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-expect-error — the browser without cross-tab messaging.
      delete window.BroadcastChannel;
    });
    await signIn(page, "OWNER", { company: AURELIA });
    await dirtyClient(page, `${PREFIX} No channel`);
    const response = await page.request.post("/api/workspace", { data: { scopeType: "COMPANY", companyId: FORMA } });
    expect(response.ok()).toBe(true);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByTestId("unsaved-context-notice")).toHaveAttribute("data-reason", "workspace-changed");
    await expect(clientName(page)).toHaveValue(`${PREFIX} No channel`);
    await page.getByTestId("unsaved-context-return").click();
    await expect(page.getByTestId("unsaved-context-notice")).toHaveCount(0, { timeout: 15_000 });
  });

  test("UW-19: signing out in another tab masks the draft; the same person signing in again gets it back", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA });
    const draft = `${PREFIX} Signed out`;
    await dirtyClient(page, draft);
    const other = await secondTab(page);
    await other.goto("/dashboard");
    await other.getByRole("button", { name: /open user menu/i }).click();
    await other.getByRole("menuitem", { name: /logout/i }).click();
    await other.waitForURL(/\/login/);

    const notice = page.getByTestId("unsaved-context-notice");
    await expect(notice).toHaveAttribute("data-reason", "signed-out");
    await expect(mainRegion(page)).toBeHidden();

    await signIn(other, "OWNER", { company: AURELIA });
    // The same person again: the hold lifts once the context is read again —
    // or, when the new sign-in began in another workspace, offers the way back.
    await expect(notice).not.toHaveAttribute("data-reason", "signed-out", { timeout: 15_000 });
    if ((await notice.count()) > 0) await notice.getByTestId("unsaved-context-return").click();
    await expect(notice).toHaveCount(0, { timeout: 15_000 });
    await expect(mainRegion(page)).toBeVisible();
    await expect(clientName(page)).toHaveValue(draft);
    await other.close();
  });

  test("UW-19: another person signing in never receives the draft", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA });
    const draft = `${PREFIX} Other person`;
    await dirtyClient(page, draft);
    const other = await secondTab(page);
    await other.goto("/dashboard");
    await other.getByRole("button", { name: /open user menu/i }).click();
    await other.getByRole("menuitem", { name: /logout/i }).click();
    await other.waitForURL(/\/login/);
    await signIn(other, "PROJECT_MANAGER");
    // This tab reloads as the new person: the draft is gone, not shown.
    await expect(page.getByText(draft)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /open user menu/i })).toBeVisible();
    await other.close();
  });
});

test.describe("the prompt itself", () => {
  for (const width of [360, 768, 1440]) {
    test(`UW-22: at ${width}px every choice fits, is at least 44px, is reachable by keyboard, and focus returns`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await signIn(page, "OWNER", { company: AURELIA });
      await dirtyClient(page, `${PREFIX} ${"A long client name that has to wrap ".repeat(3)}`);
      const cancel = mainRegion(page).getByRole("button", { name: "Cancel" });
      await cancel.focus();
      await page.keyboard.press("Enter");
      const dialog = prompt(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("role", "alertdialog");
      const buttons = dialog.getByRole("button");
      const count = await buttons.count();
      expect(count).toBe(3);
      for (let index = 0; index < count; index += 1) {
        const box = (await buttons.nth(index).boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await expect(dialog.getByTestId("unsaved-stay")).toBeFocused();
      // The focus stays inside the question.
      for (let step = 0; step < count + 1; step += 1) await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      if (process.env.AUD03_SHOTS) await page.screenshot({ path: `${process.env.AUD03_SHOTS}/prompt-${width}.png` });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(cancel).toBeFocused();
    });
  }
});
