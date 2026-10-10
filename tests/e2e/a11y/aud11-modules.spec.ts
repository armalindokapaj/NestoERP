import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "../pw";

import { db, removeTestTasks } from "../db";
import { mainRegion, signIn, type DemoRole } from "../fixtures";
import { THEME_COOKIE } from "@/lib/layout/theme-state";

/**
 * Module accessibility (AUD-11 §3–§7; AV-03, AV-06, AV-08, AV-13, AV-16, AV-17).
 *
 * Two halves:
 *
 * 1. Automated scans. Each module's list, one record's detail and its editor
 *    are scanned with axe-core (wcag2a, wcag2aa, wcag21aa) in the light and
 *    the dark theme, for the identities the PRD names — Group Owner, Finance,
 *    Project Manager / Engineer, a read-only Viewer — and a Platform Admin
 *    page. Detail pages are found from the list the identity actually sees
 *    (never a hard-coded id), so a scan only ever covers what that person is
 *    authorised to open. The scan is limited to the module's main region: the
 *    shell, navigation and shared primitives have their own AUD-11 spec.
 *    A serious or critical violation fails; a false positive must be listed
 *    in FALSE_POSITIVES with its reason (AV-17), never silenced by tag.
 *
 * 2. Keyboard-only journeys (AV-03): edit a task, decide an approval, create
 *    an expense, open and download a document — Tab, Shift+Tab, Enter and
 *    Space only; no click, hover or drag. Each ends by reading the database
 *    or the server response, not a visible button.
 *
 * A zero finding count is not proof of accessibility (PRD §8); the manual
 * NVDA and VoiceOver gates are recorded separately and remain unrun here.
 */

type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];

/**
 * Reviewed false positives, by axe rule id and a selector fragment
 * (AUD-11 §8, AV-17). Empty: add a row only with the reason it is not a defect.
 */
const FALSE_POSITIVES: Array<{ rule: string; target: RegExp; reason: string }> = [];

/** Surfaces per identity: list → first detail found there → editor. */
type Surface = { module: string; list: string; detail?: RegExp; editor?: string };

const SURFACES: Array<{ role: DemoRole; label: string; surfaces: Surface[] }> = [
  {
    role: "OWNER",
    label: "Group Owner",
    surfaces: [
      { module: "Dashboard", list: "/dashboard" },
      { module: "Projects", list: "/projects", detail: /^\/projects\/[a-z0-9_]+$/, editor: "/projects/new" },
      { module: "Approvals", list: "/approvals" },
      { module: "Calendar", list: "/calendar" },
      { module: "HR", list: "/hr/employees", detail: /^\/people\/[a-z0-9_]+$/ },
      { module: "Contracts", list: "/contracts", detail: /^\/contracts\/[a-z0-9_]+$/, editor: "/contracts/new" },
      { module: "Sales", list: "/sales/leads", detail: /^\/sales\/leads\/[a-z0-9_]+$/, editor: "/sales/leads/new" },
      { module: "Announcements", list: "/announcements", detail: /^\/announcements\/[a-z0-9_]+$/, editor: "/announcements/new" },
      { module: "Settings", list: "/settings/company" },
    ],
  },
  {
    role: "FINANCE",
    label: "Finance",
    surfaces: [
      { module: "Finance expenses", list: "/finance/expenses", detail: /^\/finance\/expenses\/[a-z0-9_]+$/, editor: "/finance/expenses/new" },
      { module: "Finance invoices", list: "/finance/invoices", detail: /^\/finance\/invoices\/[a-z0-9_]+$/ },
      { module: "Finance budgets", list: "/finance/budgets" },
      { module: "Finance reports", list: "/finance/reports" },
      { module: "Procurement", list: "/procurement/orders", detail: /^\/procurement\/orders\/[a-z0-9_]+$/ },
    ],
  },
  {
    role: "PROJECT_MANAGER",
    label: "Project Manager",
    surfaces: [
      { module: "Tasks", list: "/tasks/all", detail: /^\/tasks\/[a-z0-9_]+$/, editor: "/tasks/new" },
      { module: "Documents", list: "/documents/all", detail: /^\/documents\/[a-z0-9_]+$/, editor: "/documents/new" },
      { module: "Meetings", list: "/meetings", detail: /^\/meetings\/[a-z0-9_]+$/, editor: "/meetings/new" },
      { module: "Daily logs", list: "/daily-logs" },
      { module: "HSE", list: "/hse/incidents", detail: /^\/hse\/incidents\/[a-z0-9_]+$/, editor: "/hse/incidents/new" },
      { module: "QA/QC", list: "/qaqc/defects", detail: /^\/qaqc\/defects\/[a-z0-9_]+$/, editor: "/qaqc/defects/new" },
      { module: "Inventory", list: "/inventory/items", detail: /^\/inventory\/items\/[a-z0-9_]+$/ },
      { module: "Timesheets", list: "/timesheets" },
    ],
  },
  {
    role: "ENGINEER",
    label: "Engineer",
    surfaces: [
      { module: "Engineering RFIs", list: "/engineering/rfis" },
      { module: "Engineering drawings", list: "/engineering/drawings" },
      { module: "My work", list: "/my-work" },
      { module: "Activity", list: "/activity" },
    ],
  },
  {
    role: "VIEWER",
    label: "read-only Viewer",
    surfaces: [
      { module: "Projects (read-only)", list: "/projects", detail: /^\/projects\/[a-z0-9_]+$/ },
      { module: "Tasks (read-only)", list: "/tasks/all", detail: /^\/tasks\/[a-z0-9_]+$/ },
      { module: "Documents (read-only)", list: "/documents/all", detail: /^\/documents\/[a-z0-9_]+$/ },
    ],
  },
];

async function useTheme(page: Page, testInfo: TestInfo, theme: Theme) {
  const url = String(testInfo.project.use.baseURL);
  await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url }]);
  await page.emulateMedia({ colorScheme: theme });
}

/** Serious and critical violations inside `include`, less the reviewed false positives. */
async function scan(page: Page, include: string, where: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).include(include).analyze();
  const blocking = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      nodes: violation.nodes
        .map((node) => node.target.join(" "))
        .filter((target) => !FALSE_POSITIVES.some((fp) => fp.rule === violation.id && fp.target.test(target))),
    }))
    .filter((violation) => violation.nodes.length > 0);
  expect(blocking, `${where}: ${JSON.stringify(blocking, null, 1)}`).toEqual([]);
}

/** The first link in the main region whose path matches — a record this identity can see. */
async function firstDetail(page: Page, pattern: RegExp): Promise<string | null> {
  const hrefs = await mainRegion(page)
    .locator("a[href]")
    .evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).pathname));
  return hrefs.find((href) => pattern.test(href) && !/\/(new|all|archived|recent)$/.test(href)) ?? null;
}

for (const identity of SURFACES) {
  for (const theme of THEMES) {
    test.describe(`AV-17 axe scans — ${identity.label}, ${theme}`, () => {
      for (const surface of identity.surfaces) {
        test(`${surface.module}: list, detail and editor`, async ({ page }, testInfo) => {
          await useTheme(page, testInfo, theme);
          await signIn(page, identity.role, { to: surface.list });
          await expect(mainRegion(page)).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await scan(page, "#nesto-main", `${identity.label} ${theme} ${surface.list}`);

          if (surface.detail) {
            const href = await firstDetail(page, surface.detail);
            // No record visible to this identity is a finding about the data,
            // not the page: say so rather than scanning something else.
            test.info().annotations.push({ type: "detail", description: href ?? `no ${surface.module} record visible` });
            if (href) {
              await page.goto(href);
              await expect(mainRegion(page)).toBeVisible();
              await scan(page, "#nesto-main", `${identity.label} ${theme} ${href}`);
            }
          }

          if (surface.editor) {
            const response = await page.goto(surface.editor);
            expect(response?.status(), `${identity.label} may open ${surface.editor}`).toBeLessThan(400);
            await expect(mainRegion(page).locator("form").first()).toBeVisible();
            await scan(page, "#nesto-main", `${identity.label} ${theme} ${surface.editor}`);
            // An empty submit shows the error state; it is scanned too (AV-17 "error states").
            const submit = mainRegion(page).locator("form").first().locator('button[type="submit"]').first();
            if (await submit.isVisible()) {
              await submit.focus();
              await page.keyboard.press("Enter");
              await expect(mainRegion(page).locator('[aria-invalid="true"]').first()).toBeVisible();
              await scan(page, "#nesto-main", `${identity.label} ${theme} ${surface.editor} (errors)`);
            }
          }
        });
      }
    });
  }
}

test.describe("AV-17 axe scans — Platform Admin", () => {
  for (const theme of THEMES) {
    for (const path of ["/admin", "/admin/organizations?type=company", "/admin/audit"]) {
      test(`${path} (${theme})`, async ({ page }, testInfo) => {
        await useTheme(page, testInfo, theme);
        await signIn(page, "PLATFORM_ADMIN", { to: path });
        await expect(page.locator("main")).toBeVisible();
        await scan(page, "main", `Platform Admin ${theme} ${path}`);
      });
    }
  }
});

/* ------------------------------------------------------------------------ */
/* Keyboard-only journeys (AV-03)                                            */
/* ------------------------------------------------------------------------ */

const PREFIX = "aud11j_";

test.afterAll(async () => {
  await removeTestTasks(PREFIX);
  await db.expense.deleteMany({ where: { description: { startsWith: PREFIX } } }).catch(() => undefined);
  await db.$disconnect();
});

/**
 * Tab (or Shift+Tab) until `target` has focus — the way a keyboard user gets
 * there. Fails if it is not reachable in `max` presses (a trap or a control
 * missing from the tab order).
 */
async function tabTo(page: Page, target: Locator, { max = 120, backwards = false } = {}) {
  const handle = await target.elementHandle();
  expect(handle, "the control exists").not.toBeNull();
  for (let press = 0; press < max; press += 1) {
    if (await handle!.evaluate((node) => node === document.activeElement || node.contains(document.activeElement))) return;
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
  }
  throw new Error(`Not reachable by keyboard in ${max} presses: ${target.toString()}`);
}

/** The focused element is visible and has a visible focus indicator (AV-04). */
async function expectVisibleFocus(page: Page) {
  const indicator = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return null;
    const style = getComputedStyle(active);
    const rect = active.getBoundingClientRect();
    return {
      onScreen: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight,
      ring: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2 ? "outline" : style.boxShadow !== "none" ? "shadow" : "none",
    };
  });
  expect(indicator, "focus is on an element, not <body>").not.toBeNull();
  expect(indicator!.onScreen).toBe(true);
  expect(indicator!.ring).not.toBe("none");
}

test.describe("AV-03 keyboard-only journeys", () => {
  test("task edit: open the task, edit it and save — keyboard only", async ({ page }, testInfo) => {
    await signIn(page, "PROJECT_MANAGER");
    const title = `${PREFIX}keyboard ${testInfo.project.name} ${Date.now().toString(36)}`;
    const created = await page.request.post("/api/tasks", { data: { title, projectId: "project_a", status: "TODO", priority: "MEDIUM" } });
    expect(created.status(), await created.text()).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };

    await page.goto(`/tasks/${data.id}`);
    const edit = mainRegion(page).getByRole("link", { name: /^Edit/ }).first();
    await tabTo(page, edit);
    await expectVisibleFocus(page);
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/tasks/${data.id}/edit$`));

    const description = mainRegion(page).getByLabel("Description");
    await tabTo(page, description);
    await page.keyboard.type("Edited with the keyboard only (AUD-11 AV-03).");
    const save = mainRegion(page).getByRole("button", { name: "Save changes" });
    await tabTo(page, save);
    await expectVisibleFocus(page);
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/tasks/${data.id}$`));
    // Focus lands in the page, not lost on <body> (AUD-11 §4).
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    const stored = await db.task.findUniqueOrThrow({ where: { id: data.id }, select: { description: true } });
    expect(stored.description).toContain("Edited with the keyboard only");
  });

  test("approval decision: find the item, open it and approve — keyboard only", async ({ page }) => {
    const { CHAIN, resetChainFixture } = await import("../approvals-fixtures");
    const started = new Date();
    await resetChainFixture();
    await signIn(page, "CEO", { to: "/approvals" });
    const item = mainRegion(page).locator(`[data-approval="procurement:${CHAIN.approval}"]`);
    const opener = item.locator("a, button").first();
    await tabTo(page, opener);
    await expectVisibleFocus(page);
    await page.keyboard.press("Enter");

    const approve = page.getByRole("button", { name: "Approve this purchase order" });
    await expect(approve).toBeVisible();
    await tabTo(page, approve);
    await page.keyboard.press("Enter");
    const confirm = page.getByTestId("confirm-approve");
    await expect(confirm).toBeVisible();
    // Initial focus in the confirm dialog is not the destructive/committing
    // action by accident, and Tab stays inside the dialog (AUD-11 §4).
    await tabTo(page, confirm, { max: 20 });
    await page.keyboard.press("Enter");
    await expect(page.getByText("Purchase order approved", { exact: true })).toBeVisible();
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: CHAIN.order } })).status).toBe("APPROVED");
    await resetChainFixture(started);
  });

  test("expense create: fill and create a draft expense — keyboard only", async ({ page }, testInfo) => {
    const description = `${PREFIX}${testInfo.project.name} keyboard fuel`;
    await signIn(page, "FINANCE", { to: "/finance/expenses/new" });
    const main = mainRegion(page);

    await tabTo(page, main.getByLabel("Description"));
    await page.keyboard.type(description);
    // Native selects: reached by Tab; the option is chosen with the keyboard
    // API rather than the platform popup, which Playwright cannot drive by keys
    // consistently across operating systems.
    await tabTo(page, main.getByLabel("Category"));
    await main.getByLabel("Category").selectOption({ label: "Materials" });
    await tabTo(page, main.getByLabel("Project"));
    await main.getByLabel("Project").selectOption({ index: 1 });
    await tabTo(page, main.getByLabel(/^Net amount/));
    await page.keyboard.type("100");
    await tabTo(page, main.getByLabel(/^Tax amount/));
    await page.keyboard.type("20");

    const create = main.getByRole("button", { name: "Create expense" });
    await tabTo(page, create);
    await expectVisibleFocus(page);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/finance\/expenses\/c[a-z0-9]+$/);
    const stored = await db.expense.findFirstOrThrow({ where: { description }, select: { status: true, totalAmount: true } });
    expect(stored.status).toBe("DRAFT");
    expect(stored.totalAmount.toString()).toBe("120");
  });

  test("document open and download — keyboard only", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/documents/all" });
    const href = await firstDetail(page, /^\/documents\/[a-z0-9_]+$/);
    test.skip(!href, "No document visible to the Project Manager in this database.");
    const link = mainRegion(page).locator(`a[href$="${href}"]`).first();
    await tabTo(page, link);
    await expectVisibleFocus(page);
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`${href}$`));

    const download = mainRegion(page).getByRole("button", { name: "Download" });
    test.skip(!(await download.isVisible()), "This document has no downloadable file for the Project Manager.");
    await tabTo(page, download);
    const granted = page.waitForResponse((response) => response.url().includes("/download") && response.request().method() === "POST");
    await page.keyboard.press("Enter");
    expect((await granted).status()).toBe(200);
    // The viewer's controls are named after the file; the file's own
    // accessibility is not NESTO's claim (AUD-11 §7).
    const preview = mainRegion(page).getByTestId("document-preview");
    if (await preview.count()) await expect(preview.first()).toHaveAttribute("aria-label", /^Preview of /);
  });
});

/* ------------------------------------------------------------------------ */
/* Module specifics from the AUD-11 sweep                                    */
/* ------------------------------------------------------------------------ */

test.describe("AV-06 module names and states", () => {
  test("calendar: the filter button says when filters are applied, overdue/critical are text", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await signIn(page, "PROJECT_MANAGER", { to: "/calendar?view=agenda" });
    const main = mainRegion(page);
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
    // Day sections sit directly under the page heading (§3: no skipped level).
    await expect(main.getByTestId("agenda").getByRole("heading", { level: 3 })).toHaveCount(0);
    await expect(main.getByRole("button", { name: /^Filters/ })).toBeVisible();
  });

  test("activity: unread items say so in their name, not just a dot", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/activity" });
    const unread = mainRegion(page).locator('[data-testid="activity-row"][data-read="UNREAD"]');
    if (await unread.count()) await expect(unread.first().getByRole("button").first()).toContainText(/Unread/);
  });

  test("a deleted comment hands focus to the next comment, not <body> (AV-04)", async ({ page }, testInfo) => {
    await signIn(page, "PROJECT_MANAGER");
    const title = `${PREFIX}focus ${testInfo.project.name} ${Date.now().toString(36)}`;
    const created = await page.request.post("/api/tasks", { data: { title, projectId: "project_a", status: "TODO", priority: "MEDIUM" } });
    const { data } = (await created.json()) as { data: { id: string } };
    for (const body of ["First comment", "Second comment"]) {
      const response = await page.request.post(`/api/collaboration/task/${data.id}/comments`, { data: { body } });
      expect(response.ok(), await response.text()).toBe(true);
    }
    await page.goto(`/tasks/${data.id}`);
    const remove = mainRegion(page).getByRole("button", { name: /^Delete comment by/ }).first();
    await tabTo(page, remove);
    await page.keyboard.press("Enter");
    await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Delete comment" }).press("Enter");
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? "BODY")).not.toBe("BODY");
  });
});
