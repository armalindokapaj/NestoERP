import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import * as actions from "@/lib/actions/finance";
import { parseDecimalInput } from "@/lib/modules/finance/finance.decimal";
import { businessDate } from "@/lib/modules/finance/finance.fields";
import { createInvoiceSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import { updateExpenseSchema } from "@/lib/modules/finance/expenses/expense.schema";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import { cleanupSessions, COMPANY, loginAs, prisma, PROJECT } from "../../helpers";
import { actAs } from "../../security/harness/actor";
import { routeHandlers } from "../../security/harness/mutations";
import { callRoute } from "../../security/harness/routes";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * AUD-09 — Finance forms (FV-04, FV-05, FV-06, FV-07, FV-09, FV-13, FV-16,
 * FV-22). Real database, real services, the real server actions and routes as
 * the seeded Finance and Owner accounts. Every expectation is written out by
 * hand; none is read back from the code under test.
 */

const PREFIX = "aud09c_";
const made = { invoices: new Set<string>(), expenses: new Set<string>() };

afterEach(async () => {
  const ids = [...made.invoices, ...made.expenses];
  if (ids.length === 0) return;
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.invoice.deleteMany({ where: { id: { in: [...made.invoices] } } });
  await prisma.expense.deleteMany({ where: { id: { in: [...made.expenses] } } });
  made.invoices.clear();
  made.expenses.clear();
});

afterAll(async () => {
  actAs(null);
  await cleanupSessions();
  await prisma.$disconnect();
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function as<T>(role: "FINANCE" | "OWNER", run: () => Promise<T>): Promise<T> {
  actAs(await loginAs(role));
  try {
    return await run();
  } finally {
    actAs(null);
  }
}

function invoiceForm(lines: Record<string, string>, extra: Record<string, string> = {}): FormData {
  return form({
    invoiceNumber: `${PREFIX}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
    clientId: "client_acme",
    projectId: PROJECT.a,
    issueDate: "2026-03-01",
    dueDate: "2026-03-31",
    currency: "EUR",
    notes: `${PREFIX}note`,
    ...lines,
    ...extra,
  });
}

function idFrom(result: { ok: boolean; redirectTo?: string }): string {
  expect(result.ok).toBe(true);
  const id = result.redirectTo!.split("/").pop()!;
  return id;
}

describe("FV-06 — one decimal rule, stated with an example", () => {
  const rule = { label: "Amount", scale: 2, maxIntegerDigits: 15 };

  it.each([
    ["1,234", "DECIMAL_AMBIGUOUS_SEPARATOR"],
    ["1.234,50", "DECIMAL_MIXED_SEPARATORS"],
    ["1,234.50", "DECIMAL_MIXED_SEPARATORS"],
    ["1.234.567", "DECIMAL_MIXED_SEPARATORS"],
    ["1e5", "DECIMAL_MALFORMED"],
    ["Infinity", "DECIMAL_MALFORMED"],
    ["NaN", "DECIMAL_MALFORMED"],
    ["+5", "DECIMAL_MALFORMED"],
    ["-5", "DECIMAL_NEGATIVE"],
    ["12.345", "DECIMAL_TOO_PRECISE"],
    ["1234567890123456", "DECIMAL_TOO_LARGE"],
    ["", "DECIMAL_REQUIRED"],
  ])("refuses %j with %s", (input, code) => {
    const parsed = parseDecimalInput(input, rule);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe(code);
  });

  it("names both spellings of an ambiguous comma", () => {
    const parsed = parseDecimalInput("1,234", rule);
    expect(parsed.ok ? null : parsed.message).toContain("1234");
    expect(parsed.ok ? null : parsed.message).toContain("1.234");
  });

  it.each([
    ["12,5", "12.5"],
    ["1 234,50", "1234.50"],
    ["0,125", null],
    ["007.50", "7.50"],
    ["-0", "0"],
  ])("reads %j as %j (positive control)", (input, expected) => {
    const parsed = parseDecimalInput(input, rule);
    expect(parsed.ok ? parsed.value : null).toBe(expected);
  });
});

describe("FV-07 — calendar dates stay calendar dates", () => {
  it("refuses an impossible day instead of rolling it into March", () => {
    expect(businessDate.safeParse("2026-02-31").success).toBe(false);
    expect(businessDate.safeParse("1").success).toBe(false);
  });

  it("keeps the day that was written, at midday UTC (positive control)", () => {
    expect(businessDate.parse("2026-02-28").toISOString()).toBe("2026-02-28T12:00:00.000Z");
    // A timestamp's own calendar day, not its UTC day.
    expect(businessDate.parse("2026-09-27T23:30:00+05:00").toISOString()).toBe("2026-09-27T12:00:00.000Z");
  });
});

describe("FV-16 — line errors keep their row; totals equal AUD-01's", () => {
  it("answers each line's error under the index it was submitted as, after a blank row", async () => {
    const result = await as("FINANCE", () =>
      actions.createInvoiceAction(
        invoiceForm({
          "lineItems.0.description": "Concrete",
          "lineItems.0.quantity": "3",
          "lineItems.0.unitPrice": "100",
          "lineItems.0.taxRate": "20",
          // Row 1 was added and left empty: dropped, but it keeps its place.
          "lineItems.1.description": "",
          "lineItems.1.quantity": "",
          "lineItems.1.unitPrice": "",
          "lineItems.1.taxRate": "",
          "lineItems.2.description": "Rebar",
          "lineItems.2.quantity": "1,000",
          "lineItems.2.unitPrice": "12.5",
          "lineItems.2.taxRate": "250",
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["lineItems.2.quantity", "lineItems.2.taxRate"]);
    expect(result.fieldErrors!["lineItems.2.quantity"][0]).toContain("ambiguous");
    expect(await prisma.invoice.count({ where: { notes: `${PREFIX}note` } })).toBe(0);
  });

  it("reads the older bracket names the same way", async () => {
    const result = await as("FINANCE", () =>
      actions.createInvoiceAction(
        invoiceForm({
          "lineItems[0].description": "Concrete",
          "lineItems[0].quantity": "0",
          "lineItems[0].unitPrice": "100",
          "lineItems[0].taxRate": "20",
        }),
      ),
    );
    expect(result.ok ? null : result.fieldErrors).toEqual({ "lineItems.0.quantity": ["Quantity must be greater than zero"] });
  });

  it("stores exact decimals and totals computed line by line, half away from zero", async () => {
    const result = await as("FINANCE", () =>
      actions.createInvoiceAction(
        invoiceForm({
          "lineItems.0.description": "Formwork",
          "lineItems.0.quantity": "3",
          "lineItems.0.unitPrice": "33,3333",
          "lineItems.0.taxRate": "20",
          "lineItems.1.description": "Fixings",
          "lineItems.1.quantity": "2.5",
          "lineItems.1.unitPrice": "0.005",
          "lineItems.1.taxRate": "20",
        }),
      ),
    );
    const id = idFrom(result);
    made.invoices.add(id);
    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id },
      select: { subtotal: true, taxAmount: true, totalAmount: true, lineItems: { orderBy: { sortOrder: "asc" }, select: { quantity: true, unitPrice: true, subtotal: true, taxAmount: true, totalAmount: true } } },
    });
    // 3 × 33.3333 = 99.9999 → 100.00; tax 20.00. 2.5 × 0.005 = 0.0125 → 0.01; tax 0.002 → 0.00.
    expect(row.lineItems.map((line) => [line.quantity.toFixed(4), line.unitPrice.toFixed(4), line.subtotal.toFixed(2), line.taxAmount.toFixed(2), line.totalAmount.toFixed(2)])).toEqual([
      ["3.0000", "33.3333", "100.00", "20.00", "120.00"],
      ["2.5000", "0.0050", "0.01", "0.00", "0.01"],
    ]);
    expect([row.subtotal.toFixed(2), row.taxAmount.toFixed(2), row.totalAmount.toFixed(2)]).toEqual(["100.01", "20.00", "120.01"]);
  });

  it("refuses more than 200 lines, and a line whose total cannot be stored", async () => {
    const lines: Record<string, string> = {};
    for (let index = 0; index < 201; index += 1) {
      lines[`lineItems.${index}.description`] = `Line ${index}`;
      lines[`lineItems.${index}.quantity`] = "1";
      lines[`lineItems.${index}.unitPrice`] = "1";
      lines[`lineItems.${index}.taxRate`] = "0";
    }
    const tooMany = await as("FINANCE", () => actions.createInvoiceAction(invoiceForm(lines)));
    expect(tooMany.ok ? null : Object.keys(tooMany.fieldErrors ?? {})).toEqual(["lineItems"]);

    const huge = await as("FINANCE", () =>
      actions.createInvoiceAction(
        invoiceForm({
          "lineItems.0.description": "Huge",
          "lineItems.0.quantity": "99999999999999",
          "lineItems.0.unitPrice": "99999999999999",
          "lineItems.0.taxRate": "0",
        }),
      ),
    );
    expect(huge.ok ? null : Object.keys(huge.fieldErrors ?? {})).toEqual(["lineItems.0.unitPrice"]);
    expect(await prisma.invoice.count({ where: { notes: `${PREFIX}note` } })).toBe(0);
  });

  it("puts the due-before-issue rule on the due date", async () => {
    const result = await as("FINANCE", () =>
      actions.createInvoiceAction(
        invoiceForm(
          { "lineItems.0.description": "A", "lineItems.0.quantity": "1", "lineItems.0.unitPrice": "1", "lineItems.0.taxRate": "0" },
          { issueDate: "2026-03-10", dueDate: "2026-03-09" },
        ),
      ),
    );
    expect(result.ok ? null : result.fieldErrors).toEqual({ dueDate: ["The due date cannot be before the issue date."] });
  });
});

describe("FV-05 / FV-09 — partial updates and forged links", () => {
  async function draftInvoice() {
    const context = await loginAs("FINANCE");
    const invoice = await invoices.createInvoice(
      context,
      createInvoiceSchema.parse({
        invoiceNumber: `${PREFIX}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
        clientId: "client_acme",
        projectId: PROJECT.a,
        issueDate: "2026-03-01",
        dueDate: "2026-03-31",
        currency: "EUR",
        notes: `${PREFIX}kept`,
        lineItems: [{ description: "Line", quantity: "1", unitPrice: "10", taxRate: "20" }],
      }),
    );
    made.invoices.add(invoice.id);
    return { context, invoice };
  }

  it("keeps notes and project a PATCH leaves out; clears notes sent empty", async () => {
    const { context, invoice } = await draftInvoice();
    const route = await routeHandlers("/api/finance/invoices/[invoiceId]");
    actAs(context);
    const base = {
      clientId: "client_acme",
      issueDate: "2026-03-01",
      dueDate: "2026-03-31",
      currency: "EUR",
      lineItems: [{ description: "Line", quantity: "2", unitPrice: "10", taxRate: "20" }],
      // Server-owned: none of these may land.
      totalAmount: "1.00",
      companyId: COMPANY.b,
      status: "APPROVED",
    };
    const omitted = await callRoute(route.PATCH!, "PATCH", `/api/finance/invoices/${invoice.id}`, { invoiceId: invoice.id }, base);
    expect(omitted.status).toBe(200);
    let row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { notes: true, projectId: true, totalAmount: true, companyId: true, status: true } });
    expect(row).toMatchObject({ notes: `${PREFIX}kept`, projectId: PROJECT.a, companyId: COMPANY.a, status: "DRAFT" });
    expect(row.totalAmount.toFixed(2)).toBe("24.00");

    const cleared = await callRoute(route.PATCH!, "PATCH", `/api/finance/invoices/${invoice.id}`, { invoiceId: invoice.id }, { ...base, notes: "", projectId: null });
    expect(cleared.status).toBe(200);
    row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { notes: true, projectId: true, totalAmount: true, companyId: true, status: true } });
    expect(row.notes).toBeNull();
    expect(row.projectId).toBeNull();
    actAs(null);
  });

  it("answers a route's line error under its canonical path", async () => {
    const { context, invoice } = await draftInvoice();
    const route = await routeHandlers("/api/finance/invoices/[invoiceId]");
    actAs(context);
    const outcome = await callRoute(route.PATCH!, "PATCH", `/api/finance/invoices/${invoice.id}`, { invoiceId: invoice.id }, {
      clientId: "client_acme",
      issueDate: "2026-03-01",
      dueDate: "2026-03-31",
      currency: "EUR",
      lineItems: [
        { description: "Fine", quantity: "1", unitPrice: "1", taxRate: "0" },
        { description: "Bad", quantity: "1e3", unitPrice: "1", taxRate: "0" },
      ],
    });
    actAs(null);
    expect(outcome.status).toBe(422);
    const error = (outcome.body as { error: { fieldErrors?: Record<string, string[]> } }).error;
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["lineItems.1.quantity"]);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { totalAmount: true } });
    expect(row.totalAmount.toFixed(2)).toBe("12.00");
  });

  it("refuses another company's project beside the picker; its own project passes", async () => {
    const forged = await as("FINANCE", () =>
      actions.createInvoiceAction(
        invoiceForm(
          { "lineItems.0.description": "A", "lineItems.0.quantity": "1", "lineItems.0.unitPrice": "1", "lineItems.0.taxRate": "0" },
          { projectId: PROJECT.f },
        ),
      ),
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(Object.keys(forged.fieldErrors ?? {})).toEqual(["projectId"]);

    const own = await as("FINANCE", () =>
      actions.createInvoiceAction(
        invoiceForm({ "lineItems.0.description": "A", "lineItems.0.quantity": "1", "lineItems.0.unitPrice": "1", "lineItems.0.taxRate": "0" }),
      ),
    );
    made.invoices.add(idFrom(own));
  });

  it("expense: empty net is refused, not zero; empty tax is the domain's zero; an omitted tax keeps the saved one", async () => {
    const base = {
      description: `${PREFIX}expense`,
      category: "MATERIALS",
      expenseDate: "2026-03-05",
      projectId: PROJECT.a,
      currency: "EUR",
    };
    const empty = await as("FINANCE", () => actions.createExpenseAction(form({ ...base, netAmount: "", taxAmount: "20" })));
    expect(empty.ok ? null : Object.keys(empty.fieldErrors ?? {})).toEqual(["netAmount"]);
    expect(await prisma.expense.count({ where: { description: `${PREFIX}expense` } })).toBe(0);

    const created = await as("FINANCE", () => actions.createExpenseAction(form({ ...base, netAmount: "100,50", taxAmount: "" })));
    const id = idFrom(created);
    made.expenses.add(id);
    let row = await prisma.expense.findUniqueOrThrow({ where: { id }, select: { netAmount: true, taxAmount: true, totalAmount: true, payeeName: true } });
    expect([row.netAmount.toFixed(2), row.taxAmount.toFixed(2), row.totalAmount.toFixed(2)]).toEqual(["100.50", "0.00", "100.50"]);

    const context = await loginAs("FINANCE");
    await expenses.updateExpense(context, id, updateExpenseSchema.parse({ ...base, netAmount: "10", taxAmount: "2", payeeName: `${PREFIX}payee` }));
    const route = await routeHandlers("/api/finance/expenses/[expenseId]");
    actAs(context);
    const patched = await callRoute(route.PATCH!, "PATCH", `/api/finance/expenses/${id}`, { expenseId: id }, { ...base, netAmount: "11" });
    actAs(null);
    expect(patched.status).toBe(200);
    row = await prisma.expense.findUniqueOrThrow({ where: { id }, select: { netAmount: true, taxAmount: true, totalAmount: true, payeeName: true } });
    expect([row.netAmount.toFixed(2), row.taxAmount.toFixed(2), row.totalAmount.toFixed(2)]).toEqual(["11.00", "2.00", "13.00"]);
    expect(row.payeeName).toBe(`${PREFIX}payee`);
  });

  it("finance settings: an emptied payment term is refused, not stored as 0", async () => {
    const before = await prisma.companySettings.findUniqueOrThrow({ where: { companyId: COMPANY.a }, select: { defaultPaymentTermsDays: true } });
    const result = await as("OWNER", () =>
      actions.updateFinanceSettingsAction(form({ baseCurrency: "EUR", defaultPaymentTermsDays: "", fiscalYearStartMonth: "1" })),
    );
    expect(result.ok ? null : Object.keys(result.fieldErrors ?? {})).toEqual(["defaultPaymentTermsDays"]);
    const after = await prisma.companySettings.findUniqueOrThrow({ where: { companyId: COMPANY.a }, select: { defaultPaymentTermsDays: true } });
    expect(after.defaultPaymentTermsDays).toBe(before.defaultPaymentTermsDays);
  });
});
