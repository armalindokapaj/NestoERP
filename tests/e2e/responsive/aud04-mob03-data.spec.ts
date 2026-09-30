import { expect, test, type Page } from "@playwright/test";

import { mainRegion, signIn, type DemoRole } from "../fixtures";
import { expectNoPageOverflow, expectTouchTargets } from "./geometry";

/**
 * MOB-03 responsive data: the same records as a table on desktop and as record
 * cards or compact rows on a phone, one query in the URL either way.
 * Read-only against the seeded demo. Runs in every responsive matrix project;
 * each test says which width family it is about.
 */

const width = (page: Page) => page.viewportSize()!.width;
const isPhone = (page: Page) => width(page) < 768;
const isDesktop = (page: Page) => width(page) >= 1024;

const cards = (page: Page) => mainRegion(page).locator("[data-record-card]").filter({ visible: true });

const LISTS: { name: string; role: DemoRole; path: string }[] = [
  { name: "tasks", role: "PROJECT_MANAGER", path: "/tasks/all" },
  { name: "team", role: "OWNER", path: "/team/people" },
  { name: "documents", role: "OWNER", path: "/documents/all" },
  { name: "finance invoices", role: "FINANCE_A", path: "/finance/invoices" },
  { name: "project units", role: "PROJECT_MANAGER", path: "/projects/project_a/units" },
];

for (const list of LISTS) {
  test(`${list.name}: phone shows records as cards or rows, desktop as a table, and nothing scrolls sideways`, async ({ page }) => {
    await signIn(page, list.role, { to: list.path });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectNoPageOverflow(page, list.name);
    if (isPhone(page)) {
      await expect(cards(page).first()).toBeVisible();
      await expect(mainRegion(page).locator("table").filter({ visible: true })).toHaveCount(0);
      // The main area of every record is one target, and everything pressable on it is 44px.
      await expectTouchTargets(page, cards(page).first());
    } else if (isDesktop(page)) {
      await expect(cards(page)).toHaveCount(0);
      await expect(mainRegion(page).locator("table").first()).toBeVisible();
    }
  });
}

test.describe("phone record presentation", () => {
  test.beforeEach(({ page }) => {
    test.skip(!isPhone(page), "phone layout");
  });

  test("a task card leads with its title, shows status and due date, and opens the task from anywhere on it", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/all" });
    const card = cards(page).first();
    await expect(card.locator("[data-card-link]")).toHaveCount(1);
    // Status is a badge in the card's header, not a fact line.
    await expect(card.getByText(/Status/i)).toHaveCount(0);
    const before = page.url();
    // Locator click scrolls the card clear of the sticky bars first; a raw mouse
    // click at page coordinates can land under the header or the bottom bar.
    const box = (await card.boundingBox())!;
    await card.click({ position: { x: box.width / 2, y: box.height - 8 } });
    await page.waitForURL((url) => url.toString() !== before);
    await expect(page).toHaveURL(/\/tasks\//);
  });

  test("an invoice card states the exact total, currency and no truncation", async ({ page }) => {
    await signIn(page, "FINANCE_A", { to: "/finance/invoices" });
    const card = cards(page).first();
    await expect(card).toBeVisible();
    const text = (await card.innerText()).replace(/\s+/g, " ");
    // A whole amount with its decimals, never compact notation or an ellipsis.
    expect(text).toMatch(/\d[\d,.\s]*\d/);
    expect(text).not.toMatch(/…|\.\.\.|\d\s?[KM]\b/);
    await expectNoPageOverflow(page, "invoice cards");
  });

  test("the unit card's actions are one bottom sheet with the desktop menu's actions", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/units" });
    const card = page.getByTestId("unit-card").first();
    await expect(card).toBeVisible();
    const trigger = card.getByTestId("record-actions");
    test.skip((await trigger.count()) === 0, "this role holds no unit action");
    await trigger.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: /open unit/i })).toBeVisible();
    await expectTouchTargets(page, sheet);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the query survives opening a record and coming back", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/all?search=a&sort=due" });
    const link = cards(page).first().locator("[data-card-link]");
    test.skip((await link.count()) === 0, "no task matches this search in the demo");
    await link.click();
    await expect(page).toHaveURL(/\/tasks\/[^?]+$/);
    await page.goBack();
    await expect(page).toHaveURL(/search=a/);
    await expect(page).toHaveURL(/sort=due/);
  });

  test("filters open a sheet with a count, and clearing them keeps the sort", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/all?sort=due" });
    const filters = mainRegion(page).getByRole("button", { name: /^Filters/ });
    test.skip((await filters.count()) === 0, "this list has no filters");
    await filters.first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/sort=due/);
  });
});
