import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { byHeader, readCsvBytes } from "../../unit/csv/rfc4180";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * AUD-08 export controls in the browser (§7, §8; DT-02, DT-14, DT-17).
 *
 * Every export control states its scope, exports every match of the page's
 * own address (the section in the path included), shows Preparing → Ready or
 * Failed, ignores a second click while preparing, and never hands the browser
 * a refusal as a file. Files are read back with the strict RFC 4180 reader.
 *
 * Thirty leads in Aurelia named `AUD08X-L-01…30`, owned by the Owner; the
 * list pages 25 at a time, so the file must hold 30 from page 2.
 */

const PREFIX = "AUD08X";
const AURELIA = "company_demo_a";

test.beforeAll(async () => {
  await db.lead.deleteMany({ where: { id: { startsWith: "aud08x_" } } });
  await db.lead.createMany({
    data: Array.from({ length: 30 }, (_, index) => ({
      id: `aud08x_lead_${String(index + 1).padStart(2, "0")}`,
      companyId: AURELIA,
      name: `${PREFIX}-L-${String(index + 1).padStart(2, "0")}`,
      companyName: index === 0 ? "=HYPERLINK(\"https://evil.test\")" : `Fixture ${index + 1}`,
      source: "REFERRAL" as const,
      ownerMemberId: "member_owner",
      createdByMemberId: "member_owner",
      estimatedValue: index % 2 === 0 ? "1500.00" : null,
      currency: index % 2 === 0 ? "EUR" : null,
    })),
  });
});

test.afterAll(async () => {
  await db.lead.deleteMany({ where: { id: { startsWith: "aud08x_" } } });
  await db.$disconnect();
});

const control = (page: Page, testId: string) => mainRegion(page).getByTestId(testId);

test.describe("export controls (AUD-08 §7)", () => {
  test("DT-14 exports every matching lead from page 2, states its scope and says the download started", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA });
    await page.goto(`/sales/leads?search=${PREFIX}-L-&sort=name-asc&page=2`);
    await expect(control(page, "sales-export-leads-scope")).toHaveText("All matching records · Standard columns");

    const download = page.waitForEvent("download");
    await control(page, "sales-export-leads").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("sales-leads.csv");
    const read = readCsvBytes(readFileSync((await file.path())!));
    expect(read.bom).toBe(true);
    const rows = byHeader(read);
    expect(rows.map((row) => row.Lead)).toEqual(Array.from({ length: 30 }, (_, index) => `${PREFIX}-L-${String(index + 1).padStart(2, "0")}`));
    expect(rows[0]!.Company).toBe("'=HYPERLINK(\"https://evil.test\")");
    await expect(control(page, "sales-export-leads-status")).toHaveText("Download started: 30 records.");
    await expect(control(page, "sales-export-leads")).toHaveAttribute("data-state", "ready");
  });

  test("DT-17 shows a refused export as an error with Try again and downloads nothing", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA });
    // The list drops an unknown status and shows every lead; the export refuses it instead of widening the file.
    await page.goto(`/sales/leads?search=${PREFIX}-L-&status=NEWW`);
    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await control(page, "sales-export-leads").click();
    const alert = control(page, "sales-export-leads-error");
    await expect(alert).toContainText('The status filter "NEWW" is not one this export supports.');
    await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
    await page.waitForTimeout(300);
    expect(downloaded).toBe(false);
  });

  test("ignores a second click while the file is being prepared", async ({ page }) => {
    await signIn(page, "OWNER", { company: AURELIA });
    await page.goto(`/sales/leads?search=${PREFIX}-L-`);
    let requests = 0;
    await page.route("**/api/sales/export**", async (route) => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    const button = control(page, "sales-export-leads");
    const download = page.waitForEvent("download");
    await button.click();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toHaveText(/Preparing CSV/);
    await button.click({ force: true });
    await download;
    expect(requests).toBe(1);
  });

  test("DT-02 the contracts export carries the section the page is on", async ({ page }) => {
    await signIn(page, "LEGAL", { company: AURELIA });
    await page.goto("/contracts/archived");
    const request = page.waitForRequest(/\/api\/contracts\/export/);
    const download = page.waitForEvent("download");
    await control(page, "contracts-export-contracts").click();
    const url = new URL((await request).url());
    expect(url.searchParams.get("view")).toBe("archived");
    expect(url.searchParams.get("type")).toBe("contracts");
    const rows = byHeader(readCsvBytes(readFileSync((await (await download).path())!)));
    const archived = await db.contract.findMany({ where: { companyId: AURELIA, archivedAt: { not: null } }, select: { id: true } });
    expect(rows.map((row) => row["Contract ID"]).sort()).toEqual(archived.map((row) => row.id).sort());
  });

  test("DT-02 the reservations export carries the page's filters although the page passes none", async ({ page }) => {
    await signIn(page, "INVENTORY", { company: AURELIA });
    await page.goto("/inventory/reservations?status=ACTIVE&page=2");
    const request = page.waitForRequest(/\/api\/inventory\/export/);
    await control(page, "inventory-export-reservations").click();
    const url = new URL((await request).url());
    expect(url.searchParams.get("type")).toBe("reservations");
    expect(url.searchParams.get("status")).toBe("ACTIVE");
    expect(url.searchParams.has("page")).toBe(false);
  });
});
