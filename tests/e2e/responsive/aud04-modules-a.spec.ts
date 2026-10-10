import { expect, test, type Page } from "../pw";

import { db } from "../db";
import { mainRegion, signIn, type DemoRole } from "../fixtures";
import { expectInViewport, expectNoPageOverflow, expectTouchTargets, outsideProjects } from "./geometry";

/**
 * AUD-04 §4-§6 on the business modules of phase 2 (agent E): Projects
 * (portfolio, planning, milestones report, units, media), Finance registers
 * and reports, Inventory, Procurement, Contracts, Sales and Clients.
 *
 * Each module is swept list → detail → primary action at a phone (360) and a
 * portrait tablet (768): the page never scrolls sideways (MW-01), the primary
 * action is on screen (MW-01, MW-08), and the controls this phase resized meet
 * 44px (MW-19). Targeted checks follow for the module fixes: phone cards for
 * the quote comparison and order lines (MW-05), the folded milestone-report
 * filters (MW-06), labelled keyboard-scrollable regions (MW-17, MW-19) and a
 * removed line that can be undone (MW-08).
 *
 * Runs under the AUD-04 matrix projects (playwright.config.ts); every test
 * here skips outside `aud04-phone-360` and `aud04-tablet-768`, and the
 * phone-only or tablet-only checks narrow that further.
 *
 * Read-only against the seeded demo: nothing is saved. The one form check
 * (remove a line, undo) never submits, so there is no fixture to clean up.
 */

const SWEEP_SIZES = /aud04-(phone-360|tablet-768)$/;
const PHONE = /aud04-phone-360$/;
const TABLET = /aud04-tablet-768$/;

type Sweep = {
  module: string;
  role: DemoRole;
  list: string;
  /** A seeded record to open when the list has no DataTable cards to follow. */
  detail?: string;
  /** The primary action on the list page, which must be on screen. */
  primary?: (page: Page) => ReturnType<Page["getByRole"]>;
};

const SWEEPS: Sweep[] = [
  { module: "projects", role: "PROJECT_MANAGER", list: "/projects", detail: "/projects/project_a" },
  { module: "finance invoices", role: "FINANCE_A", list: "/finance/invoices", primary: (page) => mainRegion(page).getByRole("link", { name: "New invoice" }) },
  { module: "finance budgets", role: "FINANCE_A", list: "/finance/budgets" },
  { module: "finance commitments", role: "FINANCE_A", list: "/finance/commitments" },
  { module: "finance payments", role: "FINANCE_A", list: "/finance/payments" },
  { module: "inventory", role: "INVENTORY", list: "/inventory/items", detail: "/inventory/items/item_paper" },
  { module: "procurement orders", role: "PROCUREMENT", list: "/procurement/orders", detail: "/procurement/orders/order_004" },
  { module: "procurement requests", role: "PROCUREMENT", list: "/procurement/requests", detail: "/procurement/requests/request_005" },
  { module: "contracts", role: "LEGAL", list: "/contracts/all", detail: "/contracts/contract_001" },
  { module: "sales leads", role: "SALES", list: "/sales/leads" },
  { module: "sales opportunities", role: "SALES", list: "/sales/opportunities", detail: "/sales/opportunities/opportunity_001" },
  { module: "clients", role: "OWNER", list: "/clients/all" },
];

test.afterAll(async () => {
  await db.$disconnect();
});

/** The visible record cards (the table copy is hidden on phones). */
function cards(page: Page) {
  return mainRegion(page).locator("[data-record-card]").filter({ visible: true });
}

/** The page header's actions: the h1's row, where every record's primary action sits. */
function headerActions(page: Page) {
  return mainRegion(page).locator("h1").first().locator("xpath=ancestor::*[.//a or .//button][1]");
}

test.describe("module sweep: list → detail → primary action (MW-01, MW-05, MW-19)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(outsideProjects(testInfo, SWEEP_SIZES), "phone 360 and tablet 768 only");
  });

  for (const sweep of SWEEPS) {
    test(`${sweep.module}: nothing scrolls sideways and the actions are reachable`, async ({ page }) => {
      await signIn(page, sweep.role, { to: sweep.list });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoPageOverflow(page, `${sweep.module} list`);
      await expectTouchTargets(page, headerActions(page));
      if (sweep.primary) await expectInViewport(sweep.primary(page), `${sweep.module} primary action`);

      // List → detail: the first card on a phone, or the seeded record.
      const firstCard = cards(page).first();
      if (!sweep.detail && (await firstCard.count())) {
        const before = page.url();
        await firstCard.locator("a[data-card-link]").click();
        await page.waitForURL((url) => url.toString() !== before);
      } else if (sweep.detail) {
        await page.goto(sweep.detail);
      } else {
        return;
      }
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoPageOverflow(page, `${sweep.module} detail`);
      // The header's actions wrap within the page and stay 44px (D-02-02, D-05-07).
      await expectTouchTargets(page, headerActions(page));
      const firstAction = headerActions(page).locator("a[href], button").filter({ visible: true }).first();
      if (await firstAction.count()) await expectInViewport(firstAction, `${sweep.module} detail action`);
    });
  }

  test("a Viewer is offered no project mutation at this size (read-only identity)", async ({ page }) => {
    await signIn(page, "VIEWER", { to: "/projects" });
    await expect(mainRegion(page).getByRole("link", { name: /new project/i })).toHaveCount(0);
    await expectNoPageOverflow(page, "viewer portfolio");
    await page.goto("/projects/project_a");
    await expect(page.getByRole("heading", { name: "Riverside Residences" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expectNoPageOverflow(page, "viewer project");
  });
});

test.describe("projects (D-01-*)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(outsideProjects(testInfo, SWEEP_SIZES), "phone 360 and tablet 768 only");
  });

  test("MW-19 portfolio star and menu are 44px on a touch tablet, not 36 (D-01-16)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/projects" });
    const favorite = mainRegion(page).getByTestId("project-favorite").first();
    await expect(favorite).toBeVisible();
    await expectTouchTargets(page, mainRegion(page).locator("[data-testid=project-favorite], [data-testid=project-menu]").first().locator(".."));
    const box = (await favorite.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
  });

  test("MW-06 the milestone report folds its filters on a phone and names how many apply (D-01-01)", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONE), "phone only");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/milestones?critical=1" });
    const toggle = mainRegion(page).getByTestId("report-filters-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(mainRegion(page).getByText("Filters · 1 applied")).toBeVisible();
    // Folded: the report's totals are on the first screen, not under seven stacked fields.
    await expect(mainRegion(page).locator("select[name=status]")).toBeHidden();
    await expectInViewport(mainRegion(page).getByTestId("planning-report-totals"), "totals");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const status = mainRegion(page).locator("select[name=status]");
    await expect(status).toBeVisible();
    await expect(mainRegion(page).locator("select[name=critical]")).toHaveValue("1");
    await expectTouchTargets(page, mainRegion(page).getByRole("form", { name: "Report filters" }));
    await expectNoPageOverflow(page, "milestone report");
  });

  test("MW-05 milestone report rows are cards on a phone, a labelled scroll region on a tablet (D-01-02)", async ({ page }, testInfo) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/milestones" });
    const phone = !outsideProjects(testInfo, PHONE);
    const tables = mainRegion(page).locator("[data-testid=report-variance], [data-testid=report-overdue], [data-testid=report-critical]");
    const cardLists = mainRegion(page).locator("[data-testid=report-variance-cards], [data-testid=report-overdue-cards], [data-testid=report-critical-cards]");
    if ((await tables.count()) === 0) test.skip(true, "the seeded plan has no report rows");
    if (phone) {
      await expect(cardLists.first()).toBeVisible();
      await expect(tables.first()).toBeHidden();
    } else {
      const region = mainRegion(page).getByRole("region", { name: /Overdue milestones|Forecast variance|Critical milestones/ }).first();
      await expect(region).toBeVisible();
    }
    // The portfolio table pans in its own named region either way.
    await expect(mainRegion(page).getByRole("region", { name: "Portfolio" })).toBeVisible();
    await expectNoPageOverflow(page, "milestone report");
  });

  test("MW-17, MW-19 the planning timeline is a focusable named region with 44px zoom (D-01-03, D-01-04)", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, TABLET), "the timeline renders from 768");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/planning?view=timeline" });
    const timelineTab = mainRegion(page).getByRole("navigation", { name: "Planning views" }).getByRole("button", { name: /Timeline/ });
    if (await timelineTab.count()) await timelineTab.click();
    const region = mainRegion(page).getByRole("region", { name: "Plan timeline" });
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus();
    const before = await region.evaluate((element) => element.scrollLeft);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThanOrEqual(before);
    await expectTouchTargets(page, mainRegion(page).getByRole("group", { name: "Zoom" }));
    await expectTouchTargets(page, mainRegion(page).getByRole("navigation", { name: "Planning views" }));
  });

  test("MW-05 milestones are cards on a portrait tablet too (D-01-17)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/planning?view=milestones" });
    const milestonesTab = mainRegion(page).getByRole("navigation", { name: "Planning views" }).getByRole("button", { name: /Milestones/ });
    if (await milestonesTab.count()) await milestonesTab.click();
    // Below lg no 960px table is drawn; the cards carry the rows.
    await expect(mainRegion(page).locator("table.min-w-\\[960px\\]")).toHaveCount(0);
    await expectNoPageOverflow(page, "planning milestones");
  });

  test("MW-05 a unit card carries orientation, position, internal area and rooms (D-01-07)", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONE), "phone cards only");
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/units" });
    const card = mainRegion(page).getByTestId("unit-card").first();
    await expect(card).toBeVisible();
    await expect(mainRegion(page).getByTestId("unit-card-more").first()).toBeVisible();
    await expectTouchTargets(page, card);
    await expectNoPageOverflow(page, "units");
  });
});

test.describe("finance (D-02-*)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(outsideProjects(testInfo, SWEEP_SIZES), "phone 360 and tablet 768 only");
  });

  test("MW-05 a payment card has no unlabelled line; Void is the card's action (D-02-09)", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONE), "phone cards only");
    await signIn(page, "FINANCE_A", { to: "/finance/payments" });
    await expect(cards(page).first()).toBeVisible();
    const emptyTerms = await cards(page).locator("dt").evaluateAll((terms) => terms.filter((term) => !term.textContent?.trim()).length);
    expect(emptyTerms).toBe(0);
    const voidButton = cards(page).locator("[data-card-actions]").getByRole("button", { name: /void/i }).first();
    if (await voidButton.count()) await expectTouchTargets(page, voidButton.locator(".."));
  });

  test("MW-01 an approval row wraps its amount and decision under the record (D-02-01)", async ({ page }) => {
    await signIn(page, "FINANCE_A", { to: "/finance/approvals" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoPageOverflow(page, "finance approvals");
    const approve = mainRegion(page).getByRole("button", { name: "Approve" }).first();
    if (await approve.count()) {
      await expectInViewport(approve, "approve");
      await expectTouchTargets(page, approve.locator(".."));
    }
  });

  test("MW-19 report tables are named, keyboard-reachable regions (D-02-10)", async ({ page }) => {
    await signIn(page, "FINANCE_A", { to: "/finance/reports" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoPageOverflow(page, "finance reports");
    await expectTouchTargets(page, mainRegion(page).getByRole("navigation", { name: "Reports" }));
    const unnamed = await mainRegion(page)
      .locator("table")
      .evaluateAll((tables) => tables.filter((table) => table.getClientRects().length && !table.closest("[role=region][aria-label]")).length);
    expect(unnamed).toBe(0);
  });
});

test.describe("procurement and inventory (D-05-*)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(outsideProjects(testInfo, SWEEP_SIZES), "phone 360 and tablet 768 only");
  });

  test("MW-05 the quote comparison is one card per supplier on a phone, a sticky-header region on a tablet (D-05-01)", async ({ page }, testInfo) => {
    await signIn(page, "PROCUREMENT", { to: "/procurement/rfqs/rfq_001/comparison" });
    await expect(mainRegion(page).getByText(/Lowest qualified price/i)).toBeVisible();
    if (!outsideProjects(testInfo, PHONE)) {
      const quoteCards = mainRegion(page).getByTestId("quote-card");
      await expect(quoteCards.first()).toBeVisible();
      await expect(mainRegion(page).getByText("BuildPro Systems").filter({ visible: true }).first()).toBeVisible();
      await expectTouchTargets(page, mainRegion(page).getByTestId("quote-cards"));
      const decision = quoteCards.getByRole("button", { name: /Select|Draft order|Disqualify/ }).first();
      if (await decision.count()) await expectInViewport(decision, "quote decision");
    } else {
      await expect(mainRegion(page).getByRole("region", { name: /Supplier quotes for enquiry/ })).toBeVisible();
      await expect(mainRegion(page).getByTestId("quote-cards")).toBeHidden();
    }
    await expectNoPageOverflow(page, "quote comparison");
  });

  test("MW-05 order lines read as quantity × price = total on a phone, with the Total on screen (D-05-11)", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONE), "phone only");
    await signIn(page, "PROCUREMENT", { to: "/procurement/orders/order_004" });
    const lines = mainRegion(page).getByTestId("order-line-cards");
    await expect(lines).toBeVisible();
    await expect(lines.locator("li").first()).toContainText("×");
    await expectInViewport(mainRegion(page).getByText("Total", { exact: true }).filter({ visible: true }).first(), "order total");
    await expectNoPageOverflow(page, "order detail");
  });

  test("MW-19 item section tabs are 44px (D-05-12)", async ({ page }) => {
    await signIn(page, "INVENTORY", { to: "/inventory/items/item_paper" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectTouchTargets(page, mainRegion(page).locator("ul.overflow-x-auto").first());
    await expectNoPageOverflow(page, "item detail");
  });

  test("MW-08 a removed request line is announced and comes back with Undo (D-05-05)", async ({ page }) => {
    await signIn(page, "PROCUREMENT", { to: "/procurement/requests/new" });
    await page.locator("#items-0-description").fill("aud04e first line");
    await page.getByRole("button", { name: "Add line" }).click();
    await page.locator("#items-1-description").fill("aud04e second line");
    const remove = page.getByRole("button", { name: "Remove line 2: aud04e second line" });
    await expectTouchTargets(page, remove.locator(".."));
    await remove.click();
    const notice = page.getByTestId("line-removed-notice");
    await expect(notice).toContainText("Line 2 removed: aud04e second line");
    await notice.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#items-1-description")).toHaveValue("aud04e second line");
    // Nothing is submitted: the draft is dropped with the page (no fixture to clean up).
  });
});

test.describe("contracts, sales and clients (D-06-*)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(outsideProjects(testInfo, SWEEP_SIZES), "phone 360 and tablet 768 only");
  });

  test("MW-01 party details wrap instead of clipping (D-06-02)", async ({ page }) => {
    await signIn(page, "LEGAL", { to: "/contracts/contract_001/parties" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const clipped = await mainRegion(page)
      .locator("dd")
      .evaluateAll((values) => values.filter((value) => getComputedStyle(value).textOverflow === "ellipsis" && value.scrollWidth > value.clientWidth + 1).length);
    expect(clipped).toBe(0);
    await expectNoPageOverflow(page, "contract parties");
  });

  test("MW-19 the unit contract request views are 44px (D-06-05)", async ({ page }) => {
    await signIn(page, "LEGAL", { to: "/contracts/requests" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const waiting = mainRegion(page).getByRole("link", { name: /Waiting/ }).first();
    if (await waiting.count()) await expectTouchTargets(page, waiting.locator(".."));
    await expectNoPageOverflow(page, "contract requests");
  });

  test("MW-05, MW-19 the pipeline on a phone: a 44px stage select and an empty stage says so (D-06-06, D-06-07)", async ({ page }, testInfo) => {
    test.skip(outsideProjects(testInfo, PHONE), "the phone pipeline only");
    await signIn(page, "SALES", { to: "/sales/pipeline" });
    const stage = mainRegion(page).locator("select").filter({ visible: true }).first();
    await expect(stage).toBeVisible();
    await expectTouchTargets(page, stage.locator(".."));
    // Every stage either lists its opportunities or says it has none.
    for (const value of await stage.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))) {
      await stage.selectOption(value);
      const cardsShown = await mainRegion(page).locator("article, [data-testid=pipeline-card]").filter({ visible: true }).count();
      if (cardsShown === 0) await expect(mainRegion(page).getByText("No open opportunities in this stage.").filter({ visible: true })).toBeVisible();
    }
    await expectNoPageOverflow(page, "pipeline");
  });

  test("MW-09 lead phone and website fields open the right keyboards (D-06-17)", async ({ page }) => {
    await signIn(page, "SALES", { to: "/sales/leads/new" });
    await expect(page.locator("#phone")).toHaveAttribute("type", "tel");
    await expect(page.locator("#website")).toHaveAttribute("inputmode", "url");
  });
});
