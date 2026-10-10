import { expect, test, type Page } from "../pw";

import { createPendingExpense, removeExpenses } from "../approvals-fixtures";
import { db, removeTestTasks } from "../db";
import { DEMO_USERNAME, mainRegion, signIn, type DemoRole } from "../fixtures";

/**
 * AUD-05 §4-§7 — truthful page states, the primary action and contextual help
 * (UX-08, UX-10, UX-11, UX-12, UX-13, UX-15, UX-16, UX-17), per representative
 * role family.
 *
 * Nothing is taken from a visible button alone: a primary action's
 * destination is requested and must answer for this person; a hidden create
 * is checked by going to its route directly; every journey reads the stored
 * result back from the database.
 *
 * Records a test creates carry PREFIX and are removed afterwards.
 */

const PREFIX = "aud05h_";
const NO_MATCH = `zz-aud05-nomatch-${Date.now().toString(36)}`;

type ListCase = { path: string; searchParam: string };
type Family = { family: string; role: DemoRole; lists: ListCase[] };

const FAMILIES: Family[] = [
  {
    family: "Group Owner / Company Admin",
    role: "OWNER",
    lists: [
      { path: "/tasks/all", searchParam: "search" },
      { path: "/contractors", searchParam: "q" },
      { path: "/daily-logs", searchParam: "q" },
      { path: "/engineering/rfis", searchParam: "q" },
      { path: "/finance/invoices", searchParam: "search" },
    ],
  },
  {
    family: "Finance",
    role: "FINANCE",
    lists: [
      { path: "/finance/invoices", searchParam: "search" },
      { path: "/finance/expenses", searchParam: "search" },
      { path: "/finance/payments", searchParam: "search" },
    ],
  },
  {
    family: "Project Manager / Engineer",
    role: "PROJECT_MANAGER",
    lists: [
      { path: "/tasks/all", searchParam: "search" },
      { path: "/daily-logs", searchParam: "q" },
      { path: "/engineering/drawings", searchParam: "q" },
      { path: "/contractors/work-packages", searchParam: "q" },
    ],
  },
  {
    family: "Sales / Architect",
    role: "SALES",
    lists: [
      { path: "/sales/leads", searchParam: "search" },
      { path: "/sales/opportunities", searchParam: "search" },
      { path: "/tasks/all", searchParam: "search" },
    ],
  },
  {
    family: "Read-only / field",
    role: "VIEWER",
    lists: [
      { path: "/tasks/all", searchParam: "search" },
      { path: "/documents", searchParam: "search" },
    ],
  },
];

const CREATE_NAME = /^(New|Create|Add)\b/;
const NO_RESULTS_TEXT = /match(es)? these filters|No projects found|Nothing matches/i;

/** Where a list or its route actually landed: the page itself, or one of the refusals. */
function landed(page: Page): "page" | "denied" | "unavailable" {
  const path = new URL(page.url()).pathname;
  if (path.startsWith("/access-denied")) return "denied";
  if (path.startsWith("/module-unavailable")) return "unavailable";
  return "page";
}

/** Every visible create link answers for this person — a real page, not a refusal (UX-08). */
async function expectCreateLinksWork(page: Page) {
  const links = mainRegion(page).getByRole("link", { name: CREATE_NAME });
  const count = await links.count();
  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);
    if (!(await link.isVisible())) continue;
    const href = await link.getAttribute("href");
    expect(href, "a create link has a destination").toBeTruthy();
    const response = await page.request.get(href!, { maxRedirects: 0 });
    expect(response.status(), `${href} answers`).toBe(200);
  }
}

test.afterAll(async () => {
  await removeTestTasks(PREFIX);
  await removeExpenses(PREFIX);
  await db.$disconnect();
});

for (const family of FAMILIES) {
  test.describe(`${family.family} (${DEMO_USERNAME[family.role]})`, () => {
    for (const list of family.lists) {
      test(`UX-11 ${list.path}: truthful first-run or rows, no-results with Clear, authorized primary action`, async ({ page }) => {
        await signIn(page, family.role, { to: list.path });
        const main = mainRegion(page);

        // Denied is its own answer: never a fake empty list (§3, §6).
        const where = landed(page);
        if (where !== "page") {
          await expect(page.getByRole("heading").first()).toBeVisible();
          await expect(main.getByTestId("empty-state")).toHaveCount(0);
          return;
        }

        await expect(main.getByRole("heading", { level: 1 }).first()).toBeVisible();

        // An empty answer is never both "nothing yet" and a table of rows; a first-run
        // empty offers Create only when the destination opens for this person.
        const empty = main.getByTestId("empty-state");
        if (await empty.first().isVisible().catch(() => false)) {
          await expect(main.getByRole("table")).toHaveCount(0);
        }
        await expectCreateLinksWork(page);

        // No results: says so, offers Clear filters, and Clear restores the unfiltered list (UX-10, UX-11).
        await page.goto(`${list.path}?${list.searchParam}=${NO_MATCH}`);
        await expect(main.getByText(NO_RESULTS_TEXT).first()).toBeVisible();
        await expect(main.getByText(/No .* yet\./)).toHaveCount(0);
        const clear = main.getByRole("link", { name: /^Clear (filters|search)$/ }).first();
        await expect(clear).toBeVisible();
        await clear.click();
        await expect(page).not.toHaveURL(new RegExp(`${list.searchParam}=${NO_MATCH}`));
        await expect(main.getByText(NO_RESULTS_TEXT)).toHaveCount(0);
      });
    }
  });
}

test.describe("Read-only / field: never offered, never able to create (UX-08, UX-15)", () => {
  test("a viewer sees no create action and the create route refuses", async ({ page }) => {
    await signIn(page, "VIEWER", { to: "/tasks/all" });
    const main = mainRegion(page);
    await expect(main.getByRole("link", { name: /^New task$/ })).toHaveCount(0);
    // Any first-run empty state explains how records arrive, never "create".
    const empty = main.getByTestId("empty-state");
    if (await empty.first().isVisible().catch(() => false)) {
      await expect(empty.getByRole("link", { name: CREATE_NAME })).toHaveCount(0);
    }
    const response = await page.goto("/tasks/new");
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("not-found")).toBeVisible();
  });

  test("a finance register the viewer may not open is refused without naming a record", async ({ page }) => {
    const invoice = await db.invoice.findFirst({ where: { companyId: "company_demo_a" }, select: { id: true, invoiceNumber: true } });
    test.skip(!invoice, "no seeded invoice");
    await signIn(page, "VIEWER");
    await page.goto(`/finance/invoices/${invoice!.id}`);
    expect(["denied", "unavailable", "page"]).toContain(landed(page));
    // Missing, denied or unavailable: the invoice number never appears (§6, UX-05).
    await expect(page.locator("body")).not.toContainText(invoice!.invoiceNumber);
  });
});

test.describe("Error vs not found vs denied (UX-11, UX-12)", () => {
  test("a record outside scope is a 404 that names nothing", async ({ page }) => {
    const hidden = await db.task.findFirst({ where: { projectId: "project_c" }, select: { id: true, title: true } });
    test.skip(!hidden, "no out-of-scope task");
    await signIn(page, "PROJECT_MANAGER");
    const response = await page.goto(`/tasks/${hidden!.id}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(hidden!.title);
  });

  test("a failed approvals read shows Try again and recovers; nothing claims 'all caught up'", async ({ page }) => {
    await signIn(page, "CEO", { to: "/approvals" });
    const main = mainRegion(page);
    await expect(main.getByTestId("approvals-center")).toBeVisible();
    await page.route("**/api/approvals?**", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Approvals could not be loaded." } }) })
        : route.continue(),
    );
    await main.getByRole("tab", { name: "Requested by me" }).click();
    const alert = main.getByRole("alert").filter({ hasText: "Approvals could not be loaded." });
    await expect(alert).toBeVisible();
    await expect(main.getByTestId("approvals-empty")).toHaveCount(0);
    await page.unroute("**/api/approvals?**");
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(alert).toHaveCount(0);
  });

  test("a failed discussion read on a task offers Retry, not an empty thread", async ({ page }) => {
    const task = await db.task.findFirstOrThrow({ where: { projectId: "project_a", archivedAt: null }, select: { id: true } });
    await page.route("**/api/collaboration/**/comments**", (route) =>
      route.request().method() === "GET" ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.continue(),
    );
    await signIn(page, "PROJECT_MANAGER", { to: `/tasks/${task.id}` });
    const main = mainRegion(page);
    const failure = main.getByRole("alert").filter({ hasText: "The discussion could not be loaded." });
    await expect(failure).toBeVisible();
    await page.unroute("**/api/collaboration/**/comments**");
    await failure.getByRole("button", { name: "Retry" }).click();
    await expect(failure).toHaveCount(0);
  });

  test("loading announces itself and shows no empty message or total", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
    // Hold the next page's server payload so its loading boundary is what is on screen.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/tasks/all**", async (route) => {
      if (route.request().headers()["rsc"]) await held;
      await route.continue();
    });
    await page.goto("/dashboard");
    await page.getByRole("navigation").getByRole("link", { name: /^Tasks$/ }).first().click();
    const skeleton = page.getByTestId("page-skeleton");
    if (await skeleton.isVisible().catch(() => false)) {
      await expect(page.getByRole("status").filter({ hasText: /Loading/i }).first()).toBeAttached();
      await expect(mainRegion(page).getByTestId("empty-state")).toHaveCount(0);
      await expect(mainRegion(page).getByText(/^\d+ (results?|tasks?)$/)).toHaveCount(0);
    }
    release();
    await page.unroute("**/tasks/all**");
  });
});

test.describe("Contextual help (AUD-05 §7, UX-15, UX-16)", () => {
  test("What is this? opens by keyboard, hides for this identity only, and stays hidden across routes", async ({ page }) => {
    await signIn(page, "CEO", { to: "/approvals" });
    const help = mainRegion(page).getByTestId("help-approvals.queue");
    const trigger = help.getByRole("button", { name: "What is this?" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(help.getByRole("region", { name: "The approvals queue" })).toBeVisible();
    // Help never grants: the decision buttons are explained, not added.
    await expect(help.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
    await help.getByRole("button", { name: "Hide this tip" }).click();
    await expect(help).toHaveCount(0);

    // A route change does not bring it back.
    await page.goto("/tasks/all");
    await page.goto("/approvals");
    await expect(mainRegion(page).getByTestId("help-approvals.queue")).toHaveCount(0);
    // Nothing went to localStorage.
    expect(await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("nesto.help")))).toEqual([]);

    // Another identity in the same tab sees it again (UX-06).
    await page.context().clearCookies();
    await signIn(page, "FINANCE", { to: "/approvals" });
    await expect(mainRegion(page).getByTestId("help-approvals.queue")).toBeVisible();
  });

  test("the Projects page explains Group versus Company results", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/projects", workspace: "GROUP" });
    const help = mainRegion(page).getByTestId("help-workspace.scope.projects");
    await help.getByRole("button", { name: "What is this?" }).click();
    await expect(help).toContainText("Group workspace");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects" });
    const company = mainRegion(page).getByTestId("help-workspace.scope.projects");
    await company.getByRole("button", { name: "What is this?" }).click();
    await expect(company).toContainText("company workspace");
  });
});

test.describe("Journeys (UX-13) — persisted results, never just a toast", () => {
  test("task: project and assignee chosen at creation, status moved, each step stored", async ({ page }) => {
    const title = `${PREFIX}journey ${Date.now().toString(36)}`;
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
    const main = mainRegion(page);
    // The help sits beside the choice it explains.
    await main.getByTestId("help-tasks.create.project").getByRole("button", { name: "What is this?" }).click();
    await expect(main.getByTestId("help-tasks.create.project")).toContainText("assignee list follows the project");

    await main.getByLabel("Title").fill(title);
    await main.getByLabel("Project").selectOption({ index: 1 });
    await main.getByRole("button", { name: "Create task" }).click();
    await page.waitForURL(/\/tasks\/[^/]+$/);
    const stored = await db.task.findFirstOrThrow({ where: { title }, select: { id: true, status: true, projectId: true } });
    expect(stored.status).toBe("TODO");
    expect(stored.projectId).not.toBeNull();

    // One primary action at a time: Complete is the primary verb, Start secondary (UX-08).
    await main.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Task started.").first()).toBeVisible();
    await expect.poll(async () => (await db.task.findUniqueOrThrow({ where: { id: stored.id } })).status).toBe("IN_PROGRESS");

    // An unanswered command is never reported as done (UX-12).
    await page.route(`**/tasks/${stored.id}`, (route) =>
      route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("connectionreset") : route.continue(),
    );
    await main.getByRole("button", { name: "Complete" }).click();
    await expect(page.getByText("We couldn't confirm whether this change was saved.").first()).toBeVisible();
    await expect(page.getByText("Task completed.")).toHaveCount(0);
    await page.unroute(`**/tasks/${stored.id}`);

    await page.reload();
    const status = (await db.task.findUniqueOrThrow({ where: { id: stored.id } })).status;
    if (status !== "COMPLETED") {
      await main.getByRole("button", { name: "Complete" }).click();
      await expect(page.getByText("Task completed.").first()).toBeVisible();
    }
    await expect.poll(async () => (await db.task.findUniqueOrThrow({ where: { id: stored.id } })).status).toBe("COMPLETED");
  });

  test("approval: the decision is the primary action and the stored status follows it", async ({ page }) => {
    const { expenseId } = await createPendingExpense(`${PREFIX}approval journey`);
    await signIn(page, "CEO", { to: `/finance/expenses/${expenseId}` });
    const main = mainRegion(page);
    const approve = main.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeVisible();
    // No generic "Save" competes with the decision.
    await expect(main.getByRole("button", { name: /^Save/ })).toHaveCount(0);
    await approve.click();
    await expect(page.getByText("Expense approved.").first()).toBeVisible();
    await expect.poll(async () => (await db.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("APPROVED");
  });

  test("expense: the requester cannot decide their own; the Approvals queue explains why", async ({ page }) => {
    const { expenseId } = await createPendingExpense(`${PREFIX}own request`);
    await signIn(page, "FINANCE", { to: `/finance/expenses/${expenseId}` });
    await expect(mainRegion(page).getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await page.goto("/approvals");
    const help = mainRegion(page).getByTestId("help-approvals.queue");
    await help.getByRole("button", { name: "What is this?" }).click();
    await expect(help).toContainText("never see them on a request you submitted yourself");
    expect((await db.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("PENDING_APPROVAL");
  });

  test("invoice: list → record, the primary action matches the status", async ({ page }) => {
    const draft = await db.invoice.findFirst({ where: { companyId: "company_demo_a", status: "DRAFT", archivedAt: null }, select: { id: true } });
    test.skip(!draft, "no draft invoice in the seed");
    await signIn(page, "FINANCE", { to: `/finance/invoices/${draft!.id}` });
    const main = mainRegion(page);
    await expect(main.getByRole("button", { name: "Submit for approval" })).toBeVisible();
    // A draft is not decided by its author: no Approve beside Submit.
    await expect(main.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    // Destructive actions are behind More actions and a confirmation, never a primary button.
    await expect(main.getByRole("button", { name: /^(Cancel|Archive)\b/ })).toHaveCount(0);
  });

  test("project: the overview explains how its records connect, and its tabs open", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
    const main = mainRegion(page);
    const help = main.getByTestId("help-projects.detail.relationships");
    await help.getByRole("button", { name: "What is this?" }).click();
    await expect(help).toContainText("opens from the tabs of this project");
    await main.getByRole("link", { name: "Tasks", exact: true }).first().click();
    await expect(page).toHaveURL(/\/projects\/project_a\/tasks/);
  });
});
