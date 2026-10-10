import { expect, test } from "../pw";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * AUD-09 in the browser for the people, settings and engineering forms
 * (FV-03, FV-04, FV-05, FV-07, FV-10). What vitest cannot see: the default a
 * date input opens with, a disabled control posting nothing, a client check
 * stopping a request, and fields the dialog used to lack.
 *
 * Written for the final run; not run by the agent that wrote it.
 */

test.afterAll(async () => {
  // The Finance invoice scheme goes back to how the seed leaves it.
  await db.companyNumberingScheme.updateMany({ where: { companyId: "company_demo_a", moduleKey: "finance", entityType: "invoice" }, data: { mode: "AUTO", prefix: "INV", separator: "-", yearMode: "YYYY", padding: 4 } });
  await db.$disconnect();
});

test.describe("HR leave form", () => {
  test("opens on the browser's own calendar day, and the employee choice is not marked required (FV-07, FV-02)", async ({ page }) => {
    await signIn(page, "HR", { to: "/hr/leave/new" });
    const main = mainRegion(page);
    const localToday = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    });
    await expect(main.locator("#startDate")).toHaveValue(localToday);
    await expect(main.locator("#endDate")).toHaveValue(localToday);
    // "Myself" is a real answer: no required marker, no native required.
    await expect(main.locator("#employeeId")).not.toHaveAttribute("required", /.*/);
  });

  test("keeps the browser's day just after local midnight (fixed clock)", async ({ page }) => {
    // 00:30 in Tirana on 15 Jan 2026 is still 14 Jan in UTC.
    await page.clock.setFixedTime(new Date("2026-01-14T23:30:00.000Z"));
    await signIn(page, "HR", { to: "/hr/leave/new" });
    const expected = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    });
    await expect(mainRegion(page).locator("#startDate")).toHaveValue(expected);
  });
});

test.describe("numbering scheme", () => {
  test("switches to manual with its format fields disabled and keeps the format (FV-05, FV-10)", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/settings/numbering" });
    const main = mainRegion(page);
    await main.locator("#finance-invoice-mode").selectOption("MANUAL");
    await expect(main.locator("#finance-invoice-prefix")).toBeDisabled();
    await main.locator("form").filter({ has: page.locator("#finance-invoice-mode") }).getByRole("button", { name: /save/i }).click();
    // No "may have saved" message: the save is confirmed.
    await expect(page.getByText(/couldn.t confirm/i)).toHaveCount(0);
    await expect.poll(async () => (await db.companyNumberingScheme.findFirst({ where: { companyId: "company_demo_a", moduleKey: "finance", entityType: "invoice" }, select: { mode: true, prefix: true } }))).toEqual({ mode: "MANUAL", prefix: "INV" });
    await page.reload();
    await expect(mainRegion(page).locator("#finance-invoice-mode")).toHaveValue("MANUAL");
    await expect(mainRegion(page).locator("#finance-invoice-prefix")).toHaveValue("INV");
  });
});

test.describe("engineering settings", () => {
  test("checks the day ranges in the browser before any request (FV-04)", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/engineering/settings" });
    const form = mainRegion(page).getByTestId("engineering-settings");
    let puts = 0;
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/api/engineering/settings")) puts += 1;
    });
    const field = form.getByLabel("RFI response due after (days)");
    const original = await field.inputValue();
    await field.fill("0");
    await form.getByRole("button", { name: "Save settings" }).click();
    await expect(form.getByText("At least one day.")).toBeVisible();
    expect(puts).toBe(0);
    // Corrected, the message goes as the value becomes valid.
    await field.fill(original);
    await expect(form.getByText("At least one day.")).toHaveCount(0);
  });
});

test.describe("contractor edit dialog", () => {
  test("carries the address line 2 and region the record has, so a save no longer erases them (FV-05)", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/contractors/contractor_apex" });
    await mainRegion(page).getByTestId("edit-contractor").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Address line 2")).toBeVisible();
    await expect(dialog.getByLabel("Region")).toBeVisible();
  });
});
