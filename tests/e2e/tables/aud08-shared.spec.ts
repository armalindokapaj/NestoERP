import { expect, test, type Page } from "@playwright/test";

import { db, removeTestClients } from "../db";
import { mainRegion, recordTable, signIn, signOut } from "../fixtures";

/**
 * AUD-08 shared table controls in the browser (§4, §5; DT-05, DT-08, DT-09,
 * DT-19).
 *
 * Thirty clients in Aurelia named `AUD08S client 01…30`, found by searching
 * the prefix on /clients: 30 matching, so page 1 reads "1–25 of 30" and page 2
 * "26–30 of 30". The client list is whichever `listId` its module gives it —
 * the spec reads it from the page (`data-list-id`) rather than hard-coding a
 * name another agent owns. The header-sort case runs only where the list's
 * columns declare a `sortKey`, and says so when they do not.
 */

const PREFIX = "AUD08S";
const AURELIA = "company_demo_a";
const LIST = `/clients?search=${PREFIX}`;

test.beforeAll(async () => {
  await removeTestClients(PREFIX);
  const owner = await db.user.findFirstOrThrow({ where: { email: "owner@nesto.test" }, select: { id: true } });
  await db.client.createMany({
    data: Array.from({ length: 30 }, (_, index) => ({
      id: `aud08s_c${String(index + 1).padStart(2, "0")}`,
      companyId: AURELIA,
      name: `${PREFIX} client ${String(index + 1).padStart(2, "0")}`,
      code: index % 3 === 0 ? null : `${PREFIX}-${String(index + 1).padStart(3, "0")}`,
      createdBy: owner.id,
    })),
  });
});

test.afterAll(async () => {
  await removeTestClients(PREFIX);
  await db.$disconnect();
});

function scope(page: Page) {
  return mainRegion(page).locator("[data-list-id]").first();
}

async function listId(page: Page): Promise<string> {
  await expect(scope(page)).toHaveAttribute("data-preferences", "ready");
  return (await scope(page).getAttribute("data-list-id")) ?? "";
}

/** Every stored table-preference key in this browser, with its raw value. */
async function storedPreferences(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)!;
      if (key.startsWith("nesto.table.v1:")) out[key] = localStorage.getItem(key) ?? "";
    }
    return out;
  });
}

/** The first optional column the Columns control offers, by its label. */
async function firstOptionalColumn(page: Page): Promise<{ label: string; id: string }> {
  const checkbox = page.getByRole("checkbox").and(page.locator(":not([disabled])")).first();
  const id = (await checkbox.getAttribute("id")) ?? "";
  const label = (await page.locator(`label[for="${id}"]`).innerText()).trim();
  const scopeId = (await scope(page).getAttribute("data-table-scope")) ?? "";
  return { label, id: id.slice(scopeId.length + 1) };
}

test.describe("DT-08 the Columns control", () => {
  test("hides, persists per person/workspace/list, and resets — by keyboard alone", async ({ page }) => {
    await signIn(page, "OWNER", { to: LIST });
    const list = await listId(page);
    expect(list).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);

    const trigger = mainRegion(page).getByRole("button", { name: /^Columns/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Show columns")).toBeVisible();

    // Mandatory columns are listed, checked and cannot be changed.
    const disabled = page.getByRole("checkbox", { disabled: true });
    await expect(disabled.first()).toBeChecked();

    const column = await firstOptionalColumn(page);
    const header = recordTable(page).locator(`th[data-col-id="${column.id}"]`);
    await expect(header).toBeVisible();

    // Tab to the checkbox and turn it off with Space.
    const checkbox = page.getByRole("checkbox", { name: column.label });
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).not.toBeChecked();
    await expect(header).toBeHidden();
    await expect(scope(page)).toHaveAttribute("data-hidden-columns", new RegExp(`(^| )${column.id}( |$)`));

    // Stored under this person, this workspace and this list — holding only ids and booleans.
    const stored = await storedPreferences(page);
    const keys = Object.keys(stored);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^nesto\\.table\\.v1:[A-Za-z0-9_-]+:COMPANY:${AURELIA}:${list.replace(/\./g, "\\.")}$`));
    const value = JSON.parse(stored[keys[0]!]!) as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(["columns", "v"]);
    expect(value.columns).toEqual({ [column.id]: false });
    expect(stored[keys[0]!]).not.toContain(PREFIX);

    // Escape closes the popover and returns focus to the trigger.
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();

    // Survives a reload.
    await page.reload();
    await expect(scope(page)).toHaveAttribute("data-preferences", "ready");
    await expect(recordTable(page).locator(`th[data-col-id="${column.id}"]`)).toBeHidden();

    // Another person in the same browser starts from the defaults.
    await signOut(page);
    await signIn(page, "CEO", { to: LIST });
    await expect(scope(page)).toHaveAttribute("data-preferences", "ready");
    await expect(recordTable(page).locator(`th[data-col-id="${column.id}"]`)).toBeVisible();
    await signOut(page);

    // Back as the Owner: the choice is still theirs; Reset columns restores the defaults and forgets it.
    await signIn(page, "OWNER", { to: LIST });
    await expect(scope(page)).toHaveAttribute("data-preferences", "ready");
    await expect(recordTable(page).locator(`th[data-col-id="${column.id}"]`)).toBeHidden();
    await mainRegion(page).getByRole("button", { name: /^Columns/ }).click();
    const reset = page.getByRole("button", { name: "Reset columns" });
    await reset.focus();
    await page.keyboard.press("Enter");
    await expect(recordTable(page).locator(`th[data-col-id="${column.id}"]`)).toBeVisible();
    const after = await storedPreferences(page);
    expect(Object.keys(after).filter((key) => key.includes(`:${AURELIA}:`) && key.endsWith(`:${list}`))).toEqual([]);
  });

  test("corrupt and blocked storage fall back to the defaults without stopping the list", async ({ page }) => {
    await signIn(page, "OWNER", { to: LIST });
    const list = await listId(page);
    await page.evaluate((id) => {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)!;
        if (key.startsWith("nesto.table.v1:") && key.endsWith(`:${id}`)) localStorage.setItem(key, "{not json");
      }
      // A key for this list under a made-up identity must never be read either.
      localStorage.setItem(`nesto.table.v1:someone-else:COMPANY:company_demo_a:${id}`, JSON.stringify({ v: 1, columns: { name: false } }));
    }, list);
    await page.reload();
    await expect(scope(page)).toHaveAttribute("data-preferences", "ready");
    await expect(recordTable(page).getByText(`${PREFIX} client 01`)).toBeVisible();

    // Storage that throws on every access.
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await page.reload();
    await expect(recordTable(page).getByText(`${PREFIX} client 01`)).toBeVisible();
    await expect(scope(page)).toHaveAttribute("data-preferences", "ready");
    await mainRegion(page).getByRole("button", { name: /^Columns/ }).click();
    const column = await firstOptionalColumn(page);
    await page.getByRole("checkbox", { name: column.label }).click();
    // The choice still applies for this page, it just is not saved.
    await expect(recordTable(page).locator(`th[data-col-id="${column.id}"]`)).toBeHidden();
  });
});

test.describe("DT-05 pagination counts", () => {
  test("counts matching records, keeps other keys on page links, and resets the page on a new search", async ({ page }) => {
    await signIn(page, "OWNER", { to: LIST });
    const count = mainRegion(page).getByTestId("pagination-count");
    await expect(count).toHaveText("1–25 of 30");

    const next = mainRegion(page).getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Next" });
    await expect(next).toHaveAttribute("href", new RegExp(`search=${PREFIX}.*page=2|page=2.*search=${PREFIX}`));
    await next.click();
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(count).toHaveText("26–30 of 30");

    // A new search returns to page 1.
    const search = mainRegion(page).getByRole("searchbox").first();
    await search.fill(`${PREFIX} client 0`);
    await search.press("Enter");
    await expect(page).not.toHaveURL(/[?&]page=/);
    await expect(count).toHaveText("1–9 of 9");
    // A single page keeps its count but has no Pagination landmark.
    await expect(mainRegion(page).getByRole("navigation", { name: "Pagination" })).toHaveCount(0);

    // Tabbing out of an unchanged search box sends nothing and keeps the page.
    await page.goto(`${LIST}&page=2`);
    await expect(count).toHaveText("26–30 of 30");
    await mainRegion(page).getByRole("searchbox").first().focus();
    await page.keyboard.press("Tab");
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  });
});

test.describe("DT-19 header sort", () => {
  test("a sortable header announces the applied order with aria-sort and toggles through the URL", async ({ page }) => {
    await signIn(page, "OWNER", { to: LIST });
    const sortable = recordTable(page).locator("th[data-sort-key]");
    test.skip((await sortable.count()) === 0, "the client list declares no sortKey columns yet");

    const header = sortable.first();
    const before = await header.getAttribute("aria-sort");
    expect(["ascending", "descending", "none", "other"]).toContain(before);
    const button = header.getByRole("button");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/[?&]sort=/);
    await expect(page).not.toHaveURL(/[?&]page=/);
    await expect(header).toHaveAttribute("aria-sort", /ascending|descending|other/);
    const first = await header.getAttribute("aria-sort");
    await button.click();
    if (first !== "other") await expect(header).not.toHaveAttribute("aria-sort", first!);
    // Back restores the previous order and its announcement.
    await page.goBack();
    await expect(header).toHaveAttribute("aria-sort", first!);
  });
});
