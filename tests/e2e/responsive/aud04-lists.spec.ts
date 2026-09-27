import { expect, test, type Page, type Request } from "@playwright/test";

import { db, removeTestClients } from "../db";
import { mainRegion, signIn, type DemoRole } from "../fixtures";
import { atViewport, expectNoPageOverflow, expectTouchTargets, outsideProjects } from "./geometry";

/**
 * AUD-04 §5 on the shared list components (MW-05, MW-06, MW-16, MW-21):
 * DataTable cards and tablet columns, the phone Sort control, the staged
 * filter sheet with its chips, pagination sizes, and rotation.
 *
 * Runs under the AUD-04 matrix projects (playwright.config.ts): phone tests
 * skip on tablets and desktops and the other way round, via `outsideProjects`.
 *
 * Owned fixture: thirty clients in Aurelia named `aud04b client NN`, a few
 * with a long unbroken code and email, removed afterwards. The task, invoice
 * and item lists are read from the seeded demo only; nothing there changes.
 */

const PREFIX = "aud04b";
const AURELIA = "company_demo_a";
const LONG_CODE = "AUD04B-CODE-WITHOUT-ANY-BREAK-0000000000000000000000000001";
const CLIENTS = `/clients?search=${PREFIX}`;

const LISTS: Array<{ path: string; role: DemoRole; hasStatus: boolean }> = [
  { path: "/tasks/all", role: "PROJECT_MANAGER", hasStatus: true },
  { path: "/finance/invoices", role: "FINANCE_A", hasStatus: true },
  { path: CLIENTS, role: "OWNER", hasStatus: true },
  { path: "/inventory/items", role: "INVENTORY", hasStatus: true },
];

test.beforeAll(async () => {
  await removeTestClients(PREFIX);
  const owner = await db.user.findFirstOrThrow({ where: { email: "owner@nesto.test" }, select: { id: true } });
  await db.client.createMany({
    data: Array.from({ length: 30 }, (_, index) => ({
      id: `aud04b_c${String(index + 1).padStart(2, "0")}`,
      companyId: AURELIA,
      name: `${PREFIX} client ${String(index + 1).padStart(2, "0")}`,
      code: index === 0 ? LONG_CODE : `AUD04B-${String(index + 1).padStart(3, "0")}`,
      email: index === 0 ? "a.very.long.unbroken.address.for.wrapping.checks@aud04b-example-domain.test" : null,
      createdBy: owner.id,
    })),
  });
});

test.afterAll(async () => {
  await removeTestClients(PREFIX);
  await db.$disconnect();
});

/** The visible record cards (the table copy is hidden on phones). */
function cards(page: Page) {
  return mainRegion(page).locator("[data-record-card]").filter({ visible: true });
}

/** List navigations (RSC fetches and documents) for `path` while `during` runs. */
async function listRequests(page: Page, path: string, during: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname === path && (request.resourceType() === "document" || request.resourceType() === "fetch")) seen.push(request.url());
  };
  page.on("request", onRequest);
  try {
    await during();
    // Let any effect-driven refetch start before counting.
    await page.waitForLoadState("networkidle");
  } finally {
    page.off("request", onRequest);
  }
  return seen;
}

test.describe("phones: cards, sort, staged filters (MW-05, MW-06)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(outsideProjects(testInfo, /phone|mobile/), "phone layout only");
  });

  for (const list of LISTS) {
    test(`MW-05 ${list.path}: cards keep title, status and an explicit open affordance; the whole card opens the record`, async ({ page }) => {
      await signIn(page, list.role, { to: list.path });
      await expect(cards(page).first()).toBeVisible();
      await expectNoPageOverflow(page, list.path);
      await expect(mainRegion(page).getByRole("table")).toBeHidden();

      const card = cards(page).first();
      const link = card.locator("a[data-card-link]");
      await expect(link).toHaveCount(1);
      await expect(card.locator("svg.lucide-chevron-right")).toBeVisible();
      if (list.hasStatus) await expect(card.locator("dt", { hasText: /^Status$/ })).toBeVisible();

      // The stretched link answers at the card's corners, not only on the title text.
      const box = (await card.boundingBox())!;
      const target = await link.getAttribute("href");
      const cornerHit = await page.evaluate(
        ({ x, y }) => (document.elementFromPoint(x, y)?.closest("a[data-card-link]") as HTMLAnchorElement | null)?.getAttribute("href") ?? null,
        { x: box.x + box.width - 6, y: box.y + box.height - 6 },
      );
      // A card with an actions row answers with its actions there instead.
      if ((await card.locator("[data-card-actions]").count()) === 0) expect(cornerHit).toBe(target);

      await card.click({ position: { x: box.width - 10, y: 10 } });
      await expect(page).toHaveURL(new RegExp(`${target!.replace(/[?]/g, "\\?")}$`));
    });
  }

  test("MW-05 a long unbroken code and email wrap inside the card", async ({ page }) => {
    await signIn(page, "OWNER", { to: `${CLIENTS}&sort=name-asc` });
    const card = cards(page).filter({ hasText: `${PREFIX} client 01` });
    await expect(card).toBeVisible();
    await expect(card.getByText(LONG_CODE)).toBeVisible();
    const cardBox = (await card.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(viewport.width + 1);
    await expectNoPageOverflow(page, "long client code");
  });

  test("MW-06 Sort is one labelled control showing the applied order, and applies through the URL", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/all" });
    const sorts = mainRegion(page).getByRole("combobox", { name: /^Sort/ }).filter({ visible: true });
    // The toolbar's Sort; the table's own steps aside, so a phone never shows two.
    await expect(sorts).toHaveCount(1);
    await sorts.selectOption("title-asc");
    await expect(page).toHaveURL(/[?&]sort=title-asc(&|$)/);
    await expect(page).not.toHaveURL(/[?&]page=/);
    await expect(sorts).toHaveValue("title-asc");
    await page.reload();
    await expect(mainRegion(page).getByRole("combobox", { name: /^Sort/ }).filter({ visible: true })).toHaveValue("title-asc");
  });

  test("MW-06 the filter sheet stages: Cancel restores, Apply applies once, chips remove, Clear all resets", async ({ page }) => {
    await signIn(page, "FINANCE_A", { to: "/finance/invoices?sort=due-asc" });
    const trigger = mainRegion(page).getByRole("button", { name: /^Filters/ });
    await expectTouchTargets(page, mainRegion(page).locator("[data-pending]").first());

    // Cancel: nothing is sent and the applied values stand.
    await trigger.click();
    let sheet = page.getByTestId("filter-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Settlement").selectOption("PAID");
    const cancelled = await listRequests(page, "/finance/invoices", async () => {
      await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(sheet).toBeHidden();
    });
    expect(cancelled).toEqual([]);
    await expect(page).not.toHaveURL(/settlement=/);
    await expect(trigger).toBeFocused();
    await trigger.click();
    sheet = page.getByTestId("filter-sheet");
    await expect(sheet.getByLabel("Settlement")).toHaveValue("");

    // Apply: one navigation, page 1, sort kept; badge and chip say what is applied.
    await sheet.getByLabel("Settlement").selectOption("PAID");
    await sheet.getByRole("button", { name: "Apply" }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/[?&]settlement=PAID(&|$)/);
    await expect(page).toHaveURL(/[?&]sort=due-asc(&|$)/);
    await expect(trigger).toHaveAccessibleName(/1 applied/);
    const chip = mainRegion(page).getByRole("button", { name: /^Remove filter Settlement: / });
    await expect(chip).toBeVisible();
    await expectTouchTargets(page, mainRegion(page).locator("[data-filter-chips]"));

    // Clear inside the sheet is staged too: the URL keeps the filter until Apply.
    await trigger.click();
    sheet = page.getByTestId("filter-sheet");
    await sheet.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(sheet.getByLabel("Settlement")).toHaveValue("");
    await expect(page).toHaveURL(/settlement=PAID/);
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();

    // A chip removes its one filter.
    await chip.click();
    await expect(page).not.toHaveURL(/settlement=/);
    await expect(page).toHaveURL(/[?&]sort=due-asc(&|$)/);

    // Clear all resets filters and search, keeping the sort.
    await page.goto("/finance/invoices?sort=due-asc&settlement=PAID&search=INV");
    await mainRegion(page).getByRole("button", { name: "Clear all" }).click();
    await expect(page).not.toHaveURL(/settlement=|search=/);
    await expect(page).toHaveURL(/[?&]sort=due-asc(&|$)/);
  });

  test("MW-06 no matching results is not an empty module, and pagination is touch-sized", async ({ page }) => {
    await signIn(page, "OWNER", { to: `/clients?search=${PREFIX}-no-such-client` });
    await expect(mainRegion(page).getByText("No clients match these filters.")).toBeVisible();
    await expect(mainRegion(page).getByText("No clients yet.")).toHaveCount(0);

    await page.goto(CLIENTS);
    const pagination = mainRegion(page).getByRole("navigation", { name: "Pagination" });
    await expect(pagination).toBeVisible();
    await expectTouchTargets(page, pagination);
    await expectNoPageOverflow(page, "pagination");
  });

  test("MW-16 turning the phone keeps the open sheet, its draft, the sort and the search, and sends nothing", async ({ page }) => {
    await atViewport(page, "phone390");
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/all?sort=title-asc" });
    const search = mainRegion(page).getByRole("searchbox").first();
    await search.fill("unsent text");
    await mainRegion(page).getByRole("button", { name: /^Filters/ }).click();
    const sheet = page.getByTestId("filter-sheet");
    await sheet.getByLabel("Priority").selectOption("HIGH");

    const requests = await listRequests(page, "/tasks/all", async () => {
      await atViewport(page, "phoneLandscape");
      await atViewport(page, "phone390");
    });
    expect(requests).toEqual([]);
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Priority")).toHaveValue("HIGH");
    await expect(page).toHaveURL(/[?&]sort=title-asc(&|$)/);

    await sheet.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/[?&]priority=HIGH(&|$)/);
    await expect(page).toHaveURL(/[?&]sort=title-asc(&|$)/);
  });
});

test.describe("tablets: comparison tables and recoverable columns (MW-05, MW-16)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(outsideProjects(testInfo, /tablet|landscape/), "tablet layout only");
  });

  test("MW-05 invoices keep every amount in a scrolling table; a date hidden by width comes back from Columns", async ({ page }) => {
    await signIn(page, "FINANCE_A", { to: "/finance/invoices" });
    const table = mainRegion(page).getByRole("table");
    await expect(table).toBeVisible();
    await expectNoPageOverflow(page, "invoices");
    // Amounts are never width-hidden; the table scrolls in its own labelled region.
    await expect(table.locator('th[data-col-id="total"]')).toBeVisible();
    await expect(table.locator('th[data-col-id="outstanding"]')).toBeVisible();
    await expect(mainRegion(page).getByRole("region", { name: "Invoices" })).toBeVisible();

    const width = page.viewportSize()!.width;
    const due = table.locator('th[data-col-id="due"]');
    if (width >= 1024) {
      test.info().annotations.push({ type: "note", description: "Due has hideBelow lg: shown from 1024" });
      await expect(due).toBeVisible();
      return;
    }
    await expect(due).toBeHidden();
    const scope = mainRegion(page).locator('[data-list-id="finance.invoices"]');
    await expect(scope).toHaveAttribute("data-preferences", "ready");
    await expect(scope).toHaveAttribute("data-width-hidden-columns", /(^| )due( |$)/);
    const columns = mainRegion(page).getByRole("button", { name: /^Columns/ });
    await expect(columns).toContainText(/hidden/);
    await columns.click();
    const checkbox = page.getByRole("checkbox", { name: "Due" });
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByText("Hidden at this width").first()).toBeVisible();
    await checkbox.click();
    await expect(due).toBeVisible();
    await page.keyboard.press("Escape");

    // The choice survives a reload and a rotation across lg and back (MW-16), with no refetch.
    await page.reload();
    await expect(scope).toHaveAttribute("data-preferences", "ready");
    await expect(due).toBeVisible();
    const requests = await listRequests(page, "/finance/invoices", async () => {
      await atViewport(page, "tabletLandscape");
      await atViewport(page, "tabletPortrait");
    });
    expect(requests).toEqual([]);
    await expect(due).toBeVisible();

    // Reset columns returns to the width default.
    await columns.click();
    await page.getByRole("button", { name: "Reset columns" }).click();
    await expect(due).toBeHidden();
  });

  test("MW-05 clients: code and type hidden by width are listed and recoverable; controls are touch-sized", async ({ page }) => {
    await signIn(page, "OWNER", { to: CLIENTS });
    const table = mainRegion(page).getByRole("table");
    await expect(table).toBeVisible();
    await expectNoPageOverflow(page, "clients");
    if (page.viewportSize()!.width < 1024) {
      await expect(table.locator('th[data-col-id="code"]')).toBeHidden();
      await mainRegion(page).getByRole("button", { name: /^Columns/ }).click();
      await expect(page.getByRole("checkbox", { name: "Code" })).not.toBeChecked();
      await page.keyboard.press("Escape");
    }
    await expectTouchTargets(page, mainRegion(page).getByRole("navigation", { name: "Pagination" }));
    await expectTouchTargets(page, table.locator("thead"));
  });

  for (const list of LISTS) {
    test(`MW-01 ${list.path} fits the tablet width`, async ({ page }) => {
      await signIn(page, list.role, { to: list.path });
      await expect(mainRegion(page).getByRole("table")).toBeVisible();
      await expectNoPageOverflow(page, list.path);
    });
  }
});

test.describe("desktop regression (MW-21)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(outsideProjects(testInfo, /desktop/), "desktop only");
  });

  test("inline filters and header sorts as before; no phone controls, no chips, nothing hidden by width", async ({ page }) => {
    await signIn(page, "FINANCE_A", { to: "/finance/invoices?settlement=PAID" });
    await expect(mainRegion(page).getByRole("combobox", { name: "Settlement" })).toBeVisible();
    await expect(mainRegion(page).getByRole("button", { name: /^Filters/ })).toBeHidden();
    await expect(mainRegion(page).locator("[data-filter-chips]")).toBeHidden();
    await expect(mainRegion(page).locator("[data-table-sort]")).toBeHidden();
    await expect(mainRegion(page).locator("[data-list-sort-control]")).toBeHidden();
    const scope = mainRegion(page).locator('[data-list-id="finance.invoices"]');
    await expect(scope).toHaveAttribute("data-preferences", "ready");
    await expect(scope).toHaveAttribute("data-width-hidden-columns", "");
    await expect(mainRegion(page).getByRole("table").locator("th[data-sort-key]").first()).toBeVisible();
  });
});
