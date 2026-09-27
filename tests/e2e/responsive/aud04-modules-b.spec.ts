import { expect, test, type Page } from "@playwright/test";

import { createPendingExpense, removeExpenses } from "../approvals-fixtures";
import { db } from "../db";
import { mainRegion, signIn, type DemoRole } from "../fixtures";
import { expectInViewport, expectNoPageOverflow, expectTouchTargets, outsideProjects, VIEWPORTS } from "./geometry";

/**
 * AUD-04 phase 2, slices 03/04/07/08/09 (agent F): HSE, QA/QC, People / HR /
 * organization / settings, work and collaboration, documents / engineering /
 * contractors and Platform Admin.
 *
 * - MW-01, MW-05, MW-19: a list → detail → primary action sweep per module at
 *   360 and 768: the page never scrolls sideways, the primary action is on
 *   screen and at least 44px tall, and the record opens.
 * - MW-05, MW-06: the cards that replaced wide tables on phones (team weeks,
 *   delegated access) and the folded people filters.
 * - MW-17: calendar month matrix and phone week, the risk matrix.
 * - Read-only identity (viewer-a): the same pages without overflow and without
 *   create actions it may not take.
 * - MW-02: Platform Admin's phone navigation is a real modal drawer.
 * - MW-16: a discussion comment typed on an approval survives the review
 *   moving between the sheet (below 1024) and the side panel.
 *
 * Runs under the AUD-04 matrix projects; each test names the sizes it is about
 * via `outsideProjects`. Only the collaboration test writes: one pending
 * expense prefixed `aud04f_`, removed afterwards with its comments.
 */

const OWNED = "aud04f_ discussion";
const SWEEP = /aud04-phone-360|aud04-tablet-768/;
const PHONES = /aud04-phone-(320|360|390)/;

type Module = {
  name: string;
  role: DemoRole;
  list: string;
  /** Link to one record from the list; omitted for single-page surfaces. */
  record?: RegExp;
  /** The page's primary action, where the role has one. */
  primary?: RegExp;
};

const MODULES: Module[] = [
  { name: "HSE hazards", role: "HSE", list: "/hse/hazards", record: /^\/hse\/hazards\/[^/]+$/, primary: /Report a hazard/ },
  { name: "HSE reports", role: "HSE", list: "/hse/reports?report=risk-matrix" },
  { name: "QA/QC inspections", role: "QAQC", list: "/qaqc/inspections", record: /^\/qaqc\/inspections\/[^/]+$/, primary: /New inspection/ },
  { name: "QA/QC overview", role: "QAQC", list: "/qaqc" },
  { name: "HR employees", role: "HR", list: "/hr/employees", record: /^\/hr\/employees\/[^/]+$/, primary: /Add employment record/ },
  { name: "People directory", role: "HR", list: "/people", record: /^\/people\/[^/]+$/ },
  { name: "Organization access", role: "OWNER", list: "/organization/access" },
  { name: "Settings users", role: "OWNER", list: "/settings/users" },
  { name: "Settings notifications", role: "VIEWER", list: "/settings/notifications" },
  { name: "Timesheets week", role: "ENGINEER", list: "/timesheets" },
  { name: "Team timesheets", role: "PROJECT_MANAGER", list: "/timesheets/team" },
  { name: "Meetings", role: "PROJECT_MANAGER", list: "/meetings", record: /^\/meetings\/(?!actions|new|calendar)[^/]+$/ },
  { name: "Calendar", role: "PROJECT_MANAGER", list: "/calendar" },
  { name: "Announcements", role: "VIEWER", list: "/announcements", record: /^\/announcements\/(?!new)[^/]+$/ },
  { name: "Activity", role: "VIEWER", list: "/activity" },
  { name: "My work", role: "PROJECT_MANAGER", list: "/my-work" },
  { name: "Documents", role: "PROJECT_MANAGER", list: "/documents/all", record: /^\/documents\/(?!all|recent|archived|new)[^/]+$/, primary: /Add document/ },
  { name: "Engineering RFIs", role: "ENGINEER", list: "/engineering/rfis", record: /\/rfis\/[^/]+$/ },
  { name: "Engineering reports", role: "ENGINEER", list: "/engineering/reports" },
  { name: "Contractors", role: "PROJECT_MANAGER", list: "/contractors", record: /^\/contractors\/(?!compliance|work-packages|new)[^/]+$/ },
  { name: "Contractor work packages", role: "PROJECT_MANAGER", list: "/contractors/work-packages" },
];

/** The first visible link in the page body whose path matches `pattern`. */
async function firstRecordHref(page: Page, pattern: RegExp): Promise<string | null> {
  const hrefs = await mainRegion(page)
    .locator("a[href]")
    .evaluateAll((links) =>
      links
        .filter((link) => {
          const box = link.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .map((link) => new URL((link as HTMLAnchorElement).href).pathname),
    );
  return hrefs.find((href) => pattern.test(href)) ?? null;
}

test.describe("MW-01 / MW-05 / MW-19 list → detail → primary action", () => {
  for (const surface of MODULES) {
    test(`${surface.name}`, async ({ page }, testInfo) => {
      test.skip(outsideProjects(testInfo, SWEEP), "The sweep runs at 360 and 768.");
      await signIn(page, surface.role, { to: surface.list });
      await expect(mainRegion(page)).toBeVisible();
      await expectNoPageOverflow(page, `${surface.name} list`);

      if (surface.primary) {
        const action = mainRegion(page).getByRole("link", { name: surface.primary }).or(mainRegion(page).getByRole("button", { name: surface.primary })).first();
        await expectInViewport(action, `${surface.name} primary action`);
        const box = await action.boundingBox();
        expect(box?.height ?? 0, `${surface.name} primary action height`).toBeGreaterThanOrEqual(44);
      }

      if (surface.record) {
        const href = await firstRecordHref(page, surface.record);
        test.skip(!href, `No ${surface.name} record in the demo for ${surface.role}.`);
        await page.goto(href!);
        await expect(mainRegion(page)).toBeVisible();
        await expectNoPageOverflow(page, `${surface.name} detail`);
      }
    });
  }
});

test.describe("MW-05 / MW-06 phone layouts that replaced wide tables", () => {
  test("team weeks are cards on a phone, with every column's value", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONES), "Phone layout.");
    await signIn(page, "PROJECT_MANAGER", { to: "/timesheets/team" });
    const cards = mainRegion(page).getByTestId("team-card");
    test.skip((await cards.count()) === 0, "Nobody on the team this week.");
    await expect(mainRegion(page).getByTestId("team-timesheets")).toBeHidden();
    await expect(cards.first()).toContainText("Total");
    await expect(cards.first()).toContainText("Approver");
    await expectNoPageOverflow(page, "team weeks");
    await expectTouchTargets(page, mainRegion(page).locator("nav, [data-testid=team-cards]"));
  });

  test("the people filters fold behind More filters, and keep what was chosen", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONES), "Phone layout.");
    await signIn(page, "HR", { to: "/people" });
    const form = mainRegion(page).getByRole("form", { name: "Find people" });
    await expect(form.getByLabel("Department")).toBeHidden();
    await form.getByText("More filters", { exact: false }).click();
    await expect(form.getByLabel("Department")).toBeVisible();
    await form.getByLabel("Job title").fill("Engineer");
    await form.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/title=Engineer/);
    // Reload: the fold opens by itself when a folded filter is set.
    await page.reload();
    await expect(mainRegion(page).getByRole("form", { name: "Find people" }).getByLabel("Job title")).toHaveValue("Engineer");
    await expect(mainRegion(page).getByText(/More filters \(1\)/)).toBeVisible();
    await expectNoPageOverflow(page, "people directory");
  });

  test("delegated access: every grant a card, Revoke on the card", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONES), "Phone layout.");
    await signIn(page, "OWNER", { to: "/organization/access" });
    const cards = mainRegion(page).getByTestId("grant-card");
    test.skip((await cards.count()) === 0, "No delegated access in the demo.");
    await expect(mainRegion(page).getByTestId("grant-row").first()).toBeHidden();
    await expectNoPageOverflow(page, "delegated access");
    const revoke = cards.getByRole("button", { name: /^Revoke / }).first();
    if (await revoke.count()) {
      await expectInViewport(revoke, "revoke on the card");
      expect((await revoke.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("notification preferences: the Email switch is on screen at 320-390", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONES), "Phone layout.");
    await signIn(page, "VIEWER", { to: "/settings/notifications" });
    const email = mainRegion(page).getByRole("switch", { name: /Email/ }).first();
    await expectInViewport(email, "email switch");
    await expectNoPageOverflow(page, "notification preferences");
  });
});

test.describe("MW-17 viewers", () => {
  test("calendar: the phone opens on Agenda without painting the week grid first; month fits 320", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONES), "Phone layout.");
    await page.addInitScript(() => {
      const w = window as unknown as { __weekPainted?: boolean };
      new MutationObserver(() => {
        const grid = document.querySelector('[data-testid="time-grid"]');
        if (grid && getComputedStyle(grid.closest("main") ?? grid).visibility !== "hidden" && grid.getBoundingClientRect().height > 0) w.__weekPainted = true;
      }).observe(document, { subtree: true, childList: true, attributes: true });
    });
    await signIn(page, "PROJECT_MANAGER", { to: "/calendar" });
    await expect(page.getByRole("tab", { name: "Agenda" })).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => (window as unknown as { __weekPainted?: boolean }).__weekPainted ?? false)).toBe(false);

    await page.getByRole("tab", { name: "Month" }).click();
    await expectNoPageOverflow(page, "calendar month");
    const matrix = page.getByRole("grid", { name: "Month" });
    const box = await matrix.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);

    // Week on a phone pans inside its own labelled region instead of crushing seven days.
    await page.getByRole("tab", { name: "Week" }).click();
    await expect(page.getByRole("region", { name: "Week" })).toBeVisible();
    await expectNoPageOverflow(page, "calendar week");
    await expectTouchTargets(page, page.getByRole("tablist", { name: "Calendar view" }));
  });

  test("HSE risk matrix: the High/Critical corner is on screen at 320-390", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONES), "Phone layout.");
    await signIn(page, "HSE", { to: "/hse/reports?report=risk-matrix" });
    const matrix = mainRegion(page).getByRole("region", { name: "Risk matrix" });
    test.skip((await matrix.count()) === 0, "No risk matrix report for this role.");
    const table = matrix.locator("table");
    const tableBox = await table.boundingBox();
    const regionBox = await matrix.boundingBox();
    expect(tableBox!.width).toBeLessThanOrEqual(regionBox!.width + 1);
    await expectNoPageOverflow(page, "risk matrix");
  });
});

test.describe("read-only identity", () => {
  test("viewer-a reads people, announcements and documents without overflow or create actions", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, SWEEP), "Runs at 360 and 768.");
    await signIn(page, "VIEWER", { to: "/people" });
    await expectNoPageOverflow(page, "viewer people");
    await page.goto("/announcements");
    await expectNoPageOverflow(page, "viewer announcements");
    await expect(mainRegion(page).getByRole("link", { name: /New announcement/ })).toHaveCount(0);
    await page.goto("/documents/all");
    await expectNoPageOverflow(page, "viewer documents");
    await expect(mainRegion(page).getByRole("button", { name: /Add document/ }).or(mainRegion(page).getByRole("link", { name: /Add document/ }))).toHaveCount(0);
  });
});

test.describe("MW-02 Platform Admin on a phone", () => {
  test("the navigation is a modal drawer: focus inside, Escape closes, 44px controls", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONES), "Phone layout.");
    await signIn(page, "PLATFORM_ADMIN", { to: "/platform-admin" });
    await expectNoPageOverflow(page, "platform dashboard");
    const open = page.getByRole("button", { name: "Open navigation" });
    expect((await open.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await open.click();
    const drawer = page.getByRole("dialog", { name: "Platform administration" });
    await expect(drawer).toBeVisible();
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expectTouchTargets(page, drawer);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    // A route change closes it too.
    await open.click();
    await drawer.getByRole("link", { name: "Access Inspector" }).click();
    await expect(page).toHaveURL(/\/platform-admin\/access\/inspector/);
    await expect(drawer).toBeHidden();
    await expectNoPageOverflow(page, "access inspector");
  });
});

test.describe("MW-16 a discussion comment survives the approvals 1024px breakpoint", () => {
  test.afterAll(async () => {
    const rows = await db.expense.findMany({ where: { description: { startsWith: OWNED } }, select: { id: true } });
    const ids = rows.map((row) => row.id);
    if (ids.length) {
      const threads = (await db.collaborationThread.findMany({ where: { parentType: "expense", parentId: { in: ids } }, select: { id: true } })).map((thread) => thread.id);
      await db.mention.deleteMany({ where: { comment: { threadId: { in: threads } } } });
      await db.comment.deleteMany({ where: { threadId: { in: threads } } });
      await db.subscription.deleteMany({ where: { threadId: { in: threads } } });
      await db.collaborationThread.deleteMany({ where: { id: { in: threads } } });
    }
    await removeExpenses(OWNED);
  });

  test("typed at 768, still there at 1024 and back at 768, and posts once", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, /aud04-tablet-768/), "One rotation run is enough.");
    await page.setViewportSize(VIEWPORTS.tabletPortrait);
    const { approvalId, expenseId } = await createPendingExpense(`${OWNED} ${Date.now().toString(36)}`);
    await signIn(page, "CEO", { to: `/approvals?approval=finance%3A${approvalId}` });
    const detail = () => page.getByTestId("approval-detail");
    await detail().getByRole("button", { name: /Questions and discussion/ }).click();
    const composer = () => detail().getByLabel("Add a comment");
    await composer().fill("Typed in portrait, aud04f.");

    await page.setViewportSize(VIEWPORTS.tabletLandscape);
    await expect(page.getByTestId("approval-sheet")).toHaveCount(0);
    await expect(composer()).toHaveValue("Typed in portrait, aud04f.");

    await page.setViewportSize(VIEWPORTS.tabletPortrait);
    await expect(page.getByTestId("approval-sheet")).toBeVisible();
    await expect(composer()).toHaveValue("Typed in portrait, aud04f.");

    await detail().getByRole("button", { name: "Comment", exact: true }).click();
    await expect(composer()).toHaveValue("");
    const thread = await db.collaborationThread.findFirst({ where: { parentType: "expense", parentId: expenseId }, select: { id: true } });
    expect(await db.comment.count({ where: { threadId: thread?.id ?? "none", body: { contains: "Typed in portrait, aud04f." } } })).toBe(1);
  });
});
