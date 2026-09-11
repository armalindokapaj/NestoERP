import { expect, test } from "@playwright/test";

import { db, removeTestFinanceRecords, resetFinanceFixtures } from "../db";
import { expectAccessDenied, mainRegion, recordTable, signIn } from "../fixtures";

/**
 * The Finance journey (PRD #15 §369–§380).
 */
const PREFIX = "E2E-FIN";

test.afterAll(async () => {
  await removeTestFinanceRecords(PREFIX);
  await resetFinanceFixtures();
  await db.$disconnect();
});

test.describe("Finance role (PRD #15 §372)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "FINANCE");
  });

  test("raises an invoice, and the server calculates the totals", async ({ page }) => {
    await page.goto("/finance/invoices/new");

    const number = `${PREFIX}-001`;
    await page.locator("#invoiceNumber").fill(number);
    await page.locator("#clientId").selectOption({ label: "ACME Developments" });
    await page.locator("#dueDate").fill("2027-01-31");

    await page.locator("#line-0-description").fill("Stage 4 valuation");
    await page.locator("#line-0-quantity").fill("2");
    await page.locator("#line-0-unitPrice").fill("1500");
    await page.locator("#line-0-taxRate").fill("20");

    await page.getByRole("button", { name: "Create invoice" }).click();

    await page.waitForURL(/\/finance\/invoices\/[^/]+$/);
    await expect(page.getByRole("heading", { name: number })).toBeVisible();

    // 2 × 1500 = 3000, +20 % tax = 3600. Calculated server-side (PRD #15 §52).
    const row = await db.invoice.findFirstOrThrow({ where: { invoiceNumber: number } });
    expect(row.subtotal.toFixed(2)).toBe("3000.00");
    expect(row.taxAmount.toFixed(2)).toBe("600.00");
    expect(row.totalAmount.toFixed(2)).toBe("3600.00");
    expect(row.status).toBe("DRAFT");
  });

  test("cannot approve its own submission — approval is somebody else's job", async ({
    page,
  }) => {
    await page.goto("/finance/invoices/invoice_008");

    // invoice_008 is pending approval in the seed. The Finance role manages
    // Finance but holds no approval grant (PRD #15 §18).
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  });

  test("sees the approval queue but can decide nothing in it", async ({ page }) => {
    await resetFinanceFixtures();
    await page.goto("/finance/approvals");

    // Visibility and authority are different grants (PRD #15 §18): the role
    // that raises every record can watch the queue without signing anything off.
    await expect(mainRegion(page).getByText("INV-2026-008")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  });

  test("sees two statuses on an invoice: workflow and settlement", async ({ page }) => {
    // invoice_015 is sent, not yet due, and 30 % settled.
    await page.goto("/finance/invoices/invoice_015");

    // Partially paid, and still SENT: issuance and settlement are two facts
    // (PRD #15 §42, §45).
    await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Partially paid").first()).toBeVisible();
  });

  test("shows an overdue invoice as overdue rather than partially paid", async ({ page }) => {
    // invoice_002 is past its due date with money still owing, so overdue is
    // the answer that matters (PRD #15 §44).
    await page.goto("/finance/invoices/invoice_002");
    await expect(page.getByText("Overdue").first()).toBeVisible();
  });
});

test.describe("CEO (PRD #15 §373)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "CEO");
  });

  test("approves a pending invoice from the queue", async ({ page }) => {
    await resetFinanceFixtures();
    await page.goto("/finance/approvals");

    const main = mainRegion(page);
    await expect(main.getByText("INV-2026-008")).toBeVisible();

    await page
      .getByRole("listitem")
      .filter({ hasText: "INV-2026-008" })
      .getByRole("button", { name: "Approve" })
      .click();

    await expect(page.getByText("Invoice approved.").first()).toBeVisible();

    const row = await db.invoice.findUniqueOrThrow({ where: { id: "invoice_008" } });
    expect(row.status).toBe("APPROVED");
  });

  test("rejects with a reason, which is required", async ({ page }) => {
    await resetFinanceFixtures();
    await page.goto("/finance/approvals");

    await page
      .getByRole("listitem")
      .filter({ hasText: "EXP-011" })
      .getByRole("button", { name: "Reject" })
      .click();

    // Pressing reject with nothing typed is refused: "rejected" with no reason
    // tells the submitter nothing they can act on (PRD #15 §146).
    await page.getByRole("button", { name: "Reject", exact: true }).last().click();
    await expect(page.getByText(/say why it was rejected/i)).toBeVisible();

    await page.getByLabel("Reason").fill("The deposit is not agreed with the supplier yet.");
    await page.getByRole("button", { name: "Reject", exact: true }).last().click();

    await expect(page.getByText("Expense rejected.").first()).toBeVisible();

    const row = await db.expense.findUniqueOrThrow({ where: { id: "expense_011" } });
    expect(row.status).toBe("REJECTED");
  });

  test("is offered no operational create controls (PRD #15 §285)", async ({ page }) => {
    await page.goto("/finance/invoices");
    await expect(page.getByRole("link", { name: "New invoice" })).toHaveCount(0);
  });
});

test.describe("Project Manager (PRD #15 §374)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("sees budget and forecast on its own project, and no invoices", async ({ page }) => {
    await page.goto("/projects/project_a/finance");

    await expect(page.getByText("Budget vs actual")).toBeVisible();
    await expect(page.getByText("Open commitments").first()).toBeVisible();
    // Company receivables are not a project manager's business (PRD #15 §286).
    await expect(mainRegion(page).getByText("Invoices")).toHaveCount(0);
  });

  test("is refused the invoice list", async ({ page }) => {
    await expectAccessDenied(page, "/finance/invoices");
  });

  test("is refused a project outside its own scope", async ({ page }) => {
    // Project C belongs to another manager: not found, never "forbidden".
    await page.goto("/projects/project_c/finance");
    await expect(page.getByText(/not found|couldn't find/i).first()).toBeVisible();
  });
});

test.describe("Architect (PRD #15 §375)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "ARCHITECT");
  });

  test("sees the project budget summary and nothing operational", async ({ page }) => {
    await page.goto("/projects/project_a/finance");

    await expect(page.getByText("Budget vs actual")).toBeVisible();

    // Budget, actual summary and commitment summary — never a payee, an
    // invoice or a payment reference (PRD #15 §184).
    await expect(page.getByRole("link", { name: "All expenses" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "All invoices" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "All commitments" })).toHaveCount(0);
  });

  test("is refused every operational finance section", async ({ page }) => {
    for (const path of [
      "/finance/invoices",
      "/finance/expenses",
      "/finance/budgets",
      "/finance/commitments",
      "/finance/approvals",
    ]) {
      await expectAccessDenied(page, path);
    }
  });
});

test.describe("Sales (PRD #15 §376)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "SALES");
  });

  test("sees customer invoices and receivables", async ({ page }) => {
    await page.goto("/finance/invoices");
    await expect(recordTable(page).getByText("INV-2026-001")).toBeVisible();
  });

  test("is refused expenses, budgets and cashflow", async ({ page }) => {
    for (const path of ["/finance/expenses", "/finance/budgets"]) {
      await expectAccessDenied(page, path);
    }
  });

  test("sees a client's outstanding balance on the client record", async ({ page }) => {
    await page.goto("/clients/client_acme/finance");
    await expect(page.getByRole("heading", { name: "Outstanding" })).toBeVisible();
    await expect(recordTable(page).getByText("INV-2026-001")).toBeVisible();
  });
});

test.describe("Admin (PRD #15 §378)", () => {
  test("cannot reach Finance at all", async ({ page }) => {
    await signIn(page, "ADMIN");

    // Administering NESTO is not financial authorisation (PRD #15 §20).
    await expectAccessDenied(page, "/finance");
    await expectAccessDenied(page, "/finance/invoices");
  });

  test("is refused a direct finance API call", async ({ page }) => {
    await signIn(page, "ADMIN");
    const response = await page.request.get("/api/finance/invoices");
    expect(response.status()).toBe(403);
  });
});

test.describe("Company B (PRD #15 §380)", () => {
  test("has Finance switched off entirely", async ({ page }) => {
    await signIn(page, "OWNER_B");

    await page.goto("/finance");
    await expect(page).toHaveURL(/module-unavailable/);

    const response = await page.request.get("/api/finance/invoices");
    expect(response.status()).toBe(403);
  });
});
