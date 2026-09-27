import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { db, removeTestFinanceRecords } from "../db";
import { expectAccessDenied, mainRegion, recordTable, signIn } from "../fixtures";

/**
 * The invoice register's filtered results and export in the browser (AUD-01
 * §5-§9; FA-01, FA-06, FA-11, FA-15, FA-16, FA-19, FA-20).
 *
 * Thirty sent invoices in Aurelia numbered AUD01E-A001… (newest first) and three
 * in Meridian; A028 is paid in full, A029 in part. Unfiltered, A028 is on page
 * 2; a Paid search must find it on page 1 and say one invoice matched.
 * `AUD01_SHOTS=<dir>` saves the register at 360, 390, 768 and 1440 px.
 */

const PREFIX = "AUD01E";
const AURELIA = "company_demo_a";
const MERIDIAN = "company_demo_b";
const DAY = 86_400_000;
const ids = new Map<string, string>();

async function seed() {
  await removeTestFinanceRecords(PREFIX);
  const rows = [
    ...Array.from({ length: 30 }, (_, index) => ({ number: `A${String(index + 1).padStart(3, "0")}`, company: AURELIA, client: "client_acme", project: "project_a", member: "member_finance", index })),
    ...Array.from({ length: 3 }, (_, index) => ({ number: `B${String(index + 1).padStart(3, "0")}`, company: MERIDIAN, client: "client_delta", project: "project_b", member: "member_finance__b", index })),
  ];
  const now = Date.now();
  await db.invoice.createMany({
    data: rows.map((row) => {
      const id = `aud01e_${row.number.toLowerCase()}`;
      ids.set(row.number, id);
      return {
        id,
        companyId: row.company,
        invoiceNumber: `${PREFIX}-${row.number}`,
        clientId: row.client,
        projectId: row.project,
        // Issued a day apart, A001 newest: the default order is the number order.
        issueDate: new Date(Date.UTC(2026, 4, 1) + (40 - row.index) * DAY),
        dueDate: new Date(now + 60 * DAY),
        currency: "EUR",
        subtotal: "1000.00",
        taxAmount: "0.00",
        totalAmount: "1000.00",
        status: "SENT" as const,
        createdByMemberId: row.member,
      };
    }),
  });
  // Four approved expenses in Aurelia, E002 paid out in full and E003 in part.
  await db.expense.createMany({
    data: Array.from({ length: 4 }, (_, index) => {
      const number = `E${String(index + 1).padStart(3, "0")}`;
      const id = `aud01e_${number.toLowerCase()}`;
      ids.set(number, id);
      return {
        id,
        companyId: AURELIA,
        expenseNumber: `${PREFIX}-${number}`,
        projectId: "project_a",
        expenseDate: new Date(Date.UTC(2026, 4, 20 - index)),
        category: "MATERIALS" as const,
        description: `${PREFIX} register expense ${index + 1}`,
        payeeName: "Çimento Tirana",
        currency: "EUR",
        netAmount: "500.00",
        taxAmount: "0.00",
        totalAmount: "500.00",
        status: "APPROVED" as const,
        createdByMemberId: "member_finance",
      };
    }),
  });
  await payExpense("E002", "500.00");
  await payExpense("E003", "200.00");
  await pay("A028", "1000.00", AURELIA, "client_acme", "member_finance");
  await pay("A029", "400.00", AURELIA, "client_acme", "member_finance");
  await pay("B002", "1000.00", MERIDIAN, "client_delta", "member_finance__b");
}

async function pay(number: string, amount: string, companyId: string, clientId: string, member: string, currency = "EUR") {
  const payment = await db.payment.create({
    data: { companyId, direction: "RECEIPT", clientId, amount, currency, paymentDate: new Date(), method: "BANK_TRANSFER", createdByMemberId: member },
  });
  await db.paymentAllocation.create({ data: { companyId, paymentId: payment.id, invoiceId: ids.get(number)!, amount, createdByMemberId: member } });
  return payment.id;
}

async function payExpense(number: string, amount: string) {
  const payment = await db.payment.create({
    data: { companyId: AURELIA, direction: "DISBURSEMENT", amount, currency: "EUR", paymentDate: new Date(), method: "BANK_TRANSFER", createdByMemberId: "member_finance" },
  });
  await db.paymentAllocation.create({ data: { companyId: AURELIA, paymentId: payment.id, expenseId: ids.get(number)!, amount, createdByMemberId: "member_finance" } });
}

test.beforeAll(seed);
test.afterAll(async () => {
  await removeTestFinanceRecords(PREFIX);
  await db.$disconnect();
});

const summary = (page: Page) => mainRegion(page).getByTestId("register-summary");
const matching = (page: Page) => mainRegion(page).getByTestId("register-matching");
const exportButton = (page: Page) => mainRegion(page).getByTestId("register-export");
const currencyField = (page: Page, currency: string, field: "total" | "paid" | "outstanding") =>
  summary(page).locator(`[data-testid="register-currency"][data-currency="${currency}"] [data-field="${field}"] span`);

test.describe("the invoice register (AUD-01)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "FINANCE", { company: AURELIA });
  });

  test("FA-01 finds the paid invoice from page 2 on page 1 of a Paid search, and counts the whole result", async ({ page }) => {
    await page.goto(`/finance/invoices?search=${PREFIX}-A`);
    await expect(matching(page)).toHaveAttribute("data-count", "30");
    await expect(recordTable(page).getByText(`${PREFIX}-A028`)).toHaveCount(0);

    await mainRegion(page).getByRole("combobox", { name: "Settlement" }).selectOption("PAID");
    await expect(page).toHaveURL(/settlement=PAID/);
    await expect(recordTable(page).getByText(`${PREFIX}-A028`)).toBeVisible();
    await expect(matching(page)).toHaveAttribute("data-count", "1");
    await expect(matching(page)).toHaveText("1 matching invoice");
    await expect(currencyField(page, "EUR", "paid")).toHaveAttribute("title", "1000.00 EUR");
    await expect(currencyField(page, "EUR", "outstanding")).toHaveAttribute("title", "0.00 EUR");
    await expect(mainRegion(page).getByRole("navigation", { name: "Pagination" })).toHaveCount(0);
  });

  test("FA-11 answers a page past the end with the last page, in the address too, and resets the page on a new filter", async ({ page }) => {
    await page.goto(`/finance/invoices?search=${PREFIX}-A&page=999`);
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(mainRegion(page).getByText("Page 2 of 2")).toBeVisible();
    await expect(recordTable(page).locator("tbody tr")).toHaveCount(5);

    await mainRegion(page).getByRole("combobox", { name: "Settlement" }).selectOption("UNPAID");
    await expect(page).not.toHaveURL(/page=/);
    await expect(matching(page)).toHaveAttribute("data-count", "28");
  });

  test("shows several settlement values as the filter in force", async ({ page }) => {
    await page.goto(`/finance/invoices?search=${PREFIX}-&settlement=paid,partially_paid`);
    await expect(page).toHaveURL(/settlement=PAID%2CPARTIALLY_PAID|settlement=PAID,PARTIALLY_PAID/);
    await expect(mainRegion(page).getByRole("combobox", { name: "Settlement" })).toHaveValue("PAID,PARTIALLY_PAID");
    await expect(matching(page)).toHaveAttribute("data-count", "2");
  });

  test("keeps the archive when filters are cleared", async ({ page }) => {
    await page.goto("/finance/invoices?archived=1&search=AUD01E-NO-SUCH-INVOICE");
    await expect(mainRegion(page).getByText("No invoices match these filters.")).toBeVisible();
    await expect(matching(page)).toHaveAttribute("data-count", "0");
    await expect(summary(page).getByTestId("register-currency")).toHaveCount(0);
    await mainRegion(page).getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/finance\/invoices\?archived=1$/);
  });

  test("FA-15 exports every match of the filters, not the page, as a UTF-8 CSV", async ({ page }) => {
    await page.goto(`/finance/invoices?search=${PREFIX}-A&settlement=PAID,PARTIALLY_PAID&limit=1`);
    await expect(matching(page)).toHaveAttribute("data-count", "2");

    const download = page.waitForEvent("download");
    await exportButton(page).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^nesto-invoices-\d{8}-\d{6}Z\.csv$/);
    const bytes = readFileSync((await file.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = bytes.toString("utf8").slice(1).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines.slice(1).map((line) => line.split(",")[3]).sort()).toEqual([`${PREFIX}-A028`, `${PREFIX}-A029`]);
    await expect(mainRegion(page).getByTestId("register-export-status")).toHaveText("CSV downloaded with 2 records.");
  });

  test("FA-16 explains that there is nothing to export instead of downloading an empty file", async ({ page }) => {
    await page.goto(`/finance/invoices?search=${PREFIX}-NOTHING`);
    await expect(exportButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(mainRegion(page).getByText("There is nothing to export: no records match these filters.")).toBeVisible();
    let requested = false;
    page.on("request", (request) => {
      if (request.url().includes("/api/finance/invoices/export")) requested = true;
    });
    // Focusable and announced, but pressing it asks for nothing.
    await exportButton(page).click({ force: true });
    await page.waitForTimeout(300);
    expect(requested).toBe(false);
  });

  test("FA-19 shows a failed export as an error with Retry, and keeps the list", async ({ page }) => {
    await page.goto(`/finance/invoices?search=${PREFIX}-A&settlement=PAID`);
    await page.route("**/api/finance/invoices/export**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } }) }),
    );
    await exportButton(page).click();
    const alert = mainRegion(page).getByTestId("register-export-error");
    await expect(alert).toContainText("The CSV could not be prepared.");
    await expect(recordTable(page).getByText(`${PREFIX}-A028`)).toBeVisible();

    await page.unroute("**/api/finance/invoices/export**");
    const download = page.waitForEvent("download");
    await alert.getByRole("button", { name: "Try again" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    await expect(alert).toHaveCount(0);
  });

  test("FA-06 shows a payment recorded from the record in the register on the way back", async ({ page }) => {
    const paidList = `/finance/invoices?search=${PREFIX}-A&settlement=PAID`;
    await page.goto(paidList);
    await expect(matching(page)).toHaveAttribute("data-count", "1");

    try {
      await page.goto(`/finance/payments/new?invoiceId=${ids.get("A030")}`);
      await mainRegion(page).getByRole("button", { name: "Record receipt" }).click();
      await expect(page).toHaveURL(new RegExp(`/finance/invoices/${ids.get("A030")}$`));

      await page.goto(paidList);
      await expect(matching(page)).toHaveAttribute("data-count", "2");
      await expect(currencyField(page, "EUR", "paid")).toHaveAttribute("title", "2000.00 EUR");
      await page.reload();
      await expect(matching(page)).toHaveAttribute("data-count", "2");
    } finally {
      // The later tests count one paid invoice in Aurelia.
      const allocations = await db.paymentAllocation.findMany({ where: { invoiceId: ids.get("A030") }, select: { paymentId: true } });
      const payments = allocations.map((row) => row.paymentId);
      await db.paymentAllocation.deleteMany({ where: { paymentId: { in: payments } } });
      await db.activity.deleteMany({ where: { entityId: { in: payments } } });
      await db.auditEvent.deleteMany({ where: { entityId: { in: payments } } });
      await db.payment.deleteMany({ where: { id: { in: payments } } });
    }
  });

  test("FA-19 fails the list, not its totals, when a payment breaks the ledger, and Retry reads it again with the filters kept", async ({ page }) => {
    const bad = await pay("A027", "10.00", AURELIA, "client_acme", "member_finance", "USD");
    try {
      const url = `/finance/invoices?search=${PREFIX}-A02&settlement=PARTIALLY_PAID`;
      await page.goto(url);
      await expect(page.getByTestId("content-error")).toBeVisible();
      await expect(summary(page)).toHaveCount(0);
      await db.paymentAllocation.deleteMany({ where: { paymentId: bad } });
      await db.payment.delete({ where: { id: bad } });
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(matching(page)).toHaveAttribute("data-count", "1");
      expect(new URL(page.url()).search).toBe(`?search=${PREFIX}-A02&settlement=PARTIALLY_PAID`);
    } finally {
      await db.paymentAllocation.deleteMany({ where: { paymentId: bad } });
      await db.payment.deleteMany({ where: { id: bad } });
    }
  });

  test("FA-20 keeps filters, totals, export and pages usable at 360, 390, 768 and 1440 px, and by keyboard", async ({ page }) => {
    const shots = process.env.AUD01_SHOTS;
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/finance/invoices?search=${PREFIX}-A`);
      await expect(matching(page)).toHaveAttribute("data-count", "30");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${width}px scrolls sideways`).toBeLessThanOrEqual(0);
      await expect(exportButton(page)).toBeVisible();
      await expect(mainRegion(page).getByRole("navigation", { name: "Pagination" })).toBeVisible();
      if (shots) await page.screenshot({ path: `${shots}/invoices-${width}.png`, fullPage: true });

      if (width < 768) {
        await mainRegion(page).getByRole("button", { name: /Filters/ }).click();
        const sheet = page.getByRole("dialog");
        await sheet.getByLabel("Settlement").selectOption("PAID");
        await sheet.getByRole("button", { name: "Apply" }).click();
      } else {
        await mainRegion(page).getByRole("combobox", { name: "Settlement" }).selectOption("PAID");
      }
      await expect(matching(page)).toHaveAttribute("data-count", "1");
      if (shots) await page.screenshot({ path: `${shots}/invoices-${width}-paid.png`, fullPage: true });
    }

    // The export is a button a keyboard reaches and presses.
    const download = page.waitForEvent("download");
    await exportButton(page).focus();
    await page.keyboard.press("Enter");
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);

    // Back returns to the unfiltered list with its own count.
    await page.goBack();
    await expect(page).not.toHaveURL(/settlement=/);
    await expect(matching(page)).toHaveAttribute("data-count", "30");
  });
});

test.describe("the Group invoice register (AUD-01 §7)", () => {
  test("names each company and filters settlement across all of them", async ({ page }) => {
    await signIn(page, "FINANCE", { workspace: "GROUP", to: `/finance/invoices?search=${PREFIX}-&settlement=PAID` });
    await expect(matching(page)).toHaveAttribute("data-count", "2");
    await expect(recordTable(page).getByText(`${PREFIX}-A028`)).toBeVisible();
    await expect(recordTable(page).getByText(`${PREFIX}-B002`)).toBeVisible();
    await expect(currencyField(page, "EUR", "total")).toHaveAttribute("title", "2000.00 EUR");

    await mainRegion(page).getByRole("combobox", { name: "Company" }).selectOption(MERIDIAN);
    await expect(page).toHaveURL(/company=company_demo_b/);
    await expect(page).toHaveURL(/settlement=PAID/);
    await expect(matching(page)).toHaveAttribute("data-count", "1");
  });
});

test.describe("the expense register (AUD-01 §6, §8)", () => {
  test("filters paid expenses before the page, totals them and exports them", async ({ page }) => {
    await signIn(page, "FINANCE", { company: AURELIA, to: `/finance/expenses?search=${PREFIX}-E&limit=1` });
    await expect(matching(page)).toHaveText("4 matching expenses");
    await expect(currencyField(page, "EUR", "paid")).toHaveAttribute("title", "700.00 EUR");
    await expect(currencyField(page, "EUR", "outstanding")).toHaveAttribute("title", "1300.00 EUR");

    await mainRegion(page).getByRole("combobox", { name: "Paid" }).selectOption("PAID");
    await expect(page).toHaveURL(/settlement=PAID/);
    await expect(recordTable(page).getByText(`${PREFIX}-E002`)).toBeVisible();
    await expect(matching(page)).toHaveText("1 matching expense");

    await mainRegion(page).getByRole("combobox", { name: "Paid" }).selectOption("PARTIALLY_PAID");
    await expect(recordTable(page).getByText(`${PREFIX}-E003`)).toBeVisible();
    const download = page.waitForEvent("download");
    await exportButton(page).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^nesto-expenses-\d{8}-\d{6}Z\.csv$/);
    const text = readFileSync((await file.path())!).toString("utf8");
    expect(text).toContain("Çimento Tirana");
    expect(text).toContain(`${PREFIX}-E003`);
    expect(text).not.toContain(`${PREFIX}-E002`);
  });
});

test.describe("direct links (AUD-01 FA-21)", () => {
  test("keep a role without the registers out of the pages and their exports", async ({ page }) => {
    await signIn(page, "ARCHITECT");
    await expectAccessDenied(page, "/finance/invoices?settlement=PAID");
    await expectAccessDenied(page, "/finance/expenses?settlement=PAID");
    expect((await page.request.get("/api/finance/invoices/export")).status()).toBe(403);
    expect((await page.request.get("/api/finance/expenses/export")).status()).toBe(403);
    expect((await page.request.get("/api/finance/invoices?settlement=PAID")).status()).toBe(403);
  });

  test("let a reader without finance.export read the register but offer no export", async ({ page }) => {
    await signIn(page, "CEO", { to: `/finance/invoices?search=${PREFIX}-A` });
    await expect(matching(page)).toHaveAttribute("data-count", "30");
    await expect(exportButton(page)).toHaveCount(0);
    expect((await page.request.get(`/api/finance/invoices/export?search=${PREFIX}-A`)).status()).toBe(403);
  });
});
