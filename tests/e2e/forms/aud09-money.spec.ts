import { expect, test } from "../pw";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * Money, quantity and line items in a real browser (AUD-09 §4, §7; FV-06,
 * FV-16). Exercised on the new-invoice form, whose priced line editor is the
 * one proposals share:
 *
 * - a locale-ambiguous amount is refused beside its field, on blur, with both
 *   spellings offered, and nothing is sent;
 * - a server error on a line stays on that line (its stable row id) after the
 *   row above it is removed;
 * - the totals preview is exact and labelled a preview.
 *
 * Written for the final run; not run by the agent that wrote it.
 */

const NOTE = "E2E aud09 money";

test.afterAll(async () => {
  const rows = await db.invoice.findMany({ where: { notes: NOTE }, select: { id: true } });
  const ids = rows.map((row) => row.id);
  await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  await db.invoice.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

async function openNewInvoice(page: import("@playwright/test").Page) {
  await signIn(page, "FINANCE", { to: "/finance/invoices/new" });
  const main = mainRegion(page);
  await expect(main.getByRole("heading", { name: "Line items" })).toBeVisible();
  return main;
}

test("an ambiguous amount is refused on blur with both spellings, and nothing is sent", async ({ page }) => {
  const main = await openNewInvoice(page);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) posts.push(request.url());
  });

  const unitPrice = main.getByLabel(/^Unit price/).first();
  await unitPrice.fill("1,234");
  await unitPrice.blur();
  const error = main.getByText(/"1,234" is ambiguous/);
  await expect(error).toBeVisible();
  await expect(error).toContainText("1234");
  await expect(error).toContainText("1.234");
  await expect(unitPrice).toHaveAttribute("aria-invalid", "true");
  await expect(unitPrice).toHaveAttribute("aria-describedby", /-error$/);

  await main.getByRole("button", { name: /create invoice/i }).click();
  // The browser's own validation carries the same sentence: no request.
  await expect.poll(() => posts.length).toBe(0);

  // A decimal comma is accepted and the exact preview follows.
  await unitPrice.fill("12,5");
  await unitPrice.blur();
  await expect(error).toBeHidden();
  await expect(unitPrice).not.toHaveAttribute("aria-invalid", "true");
});

test("a server error stays on its row when the row above is removed", async ({ page }) => {
  const main = await openNewInvoice(page);
  await main.getByLabel("Client").selectOption({ index: 1 });
  await main.getByLabel("Notes").fill(NOTE);

  await main.getByRole("button", { name: "Add line" }).click();
  const descriptions = main.getByLabel("Description");
  await descriptions.nth(0).fill("First line");
  await descriptions.nth(1).fill("Second line");
  // A quantity the browser accepts (a valid decimal) but whose total the
  // server refuses as too large to store: the error comes from the server.
  await main.getByLabel(/^Quantity/).nth(1).fill("99999999999999");
  await main.getByLabel(/^Unit price/).nth(1).fill("99999999999999");
  await main.getByRole("button", { name: /create invoice/i }).click();

  const rows = main.locator("[data-line-row]");
  const secondRow = rows.nth(1);
  await expect(secondRow.getByText(/line's total is too large/)).toBeVisible();
  await expect(rows.nth(0).getByText(/line's total is too large/)).toHaveCount(0);
  const secondRowId = await secondRow.getAttribute("data-line-row");

  // Remove the first row: the error moves with its row, now first on screen.
  await main.getByRole("button", { name: /Remove line 1/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toHaveAttribute("data-line-row", secondRowId!);
  await expect(rows.nth(0).getByText(/line's total is too large/)).toBeVisible();
  expect(await db.invoice.count({ where: { notes: NOTE } })).toBe(0);
});

test("the totals preview is exact and labelled as a preview", async ({ page }) => {
  const main = await openNewInvoice(page);
  await main.getByLabel(/^Quantity/).first().fill("3");
  await main.getByLabel(/^Unit price/).first().fill("33,3333");
  await main.getByLabel(/^Tax/).first().fill("20");
  // 3 × 33.3333 = 99.9999 → 100.00, tax 20.00: a float preview showed 99.99/119.99 or similar.
  const totals = main.getByLabel("Totals preview");
  await expect(totals).toContainText("Total (preview)");
  await expect(totals).toContainText("120.00");
});
