import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { GET as exportExpensesRoute } from "@/app/api/finance/expenses/export/route";
import { GET as listExpensesRoute } from "@/app/api/finance/expenses/route";
import { GET as exportInvoicesRoute } from "@/app/api/finance/invoices/export/route";
import { GET as listInvoicesRoute } from "@/app/api/finance/invoices/route";
import type { UserContext } from "@/lib/context/types";
import { EXPENSE_EXPORT_COLUMNS, INVOICE_EXPORT_COLUMNS } from "@/lib/modules/finance/finance.export";
import { parseInvoiceQuery } from "@/lib/modules/finance/finance.query";
import { EXPORT_ROW_LIMIT } from "@/lib/modules/finance/finance.register";
import { financeExportEligibility } from "@/lib/modules/finance/finance.workspace";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import { parseCsv } from "@/lib/utils/csv";
import { cleanupSessions, COMPANY, loginAs, PROJECT, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

/**
 * The registers' CSV exports and JSON lists, through their routes (AUD-01 §6-§8;
 * FA-13..FA-17, FA-21).
 *
 * The route handlers are called as Next calls them, with a real session behind
 * the context resolver, so the permission checks, the Group read policy, the
 * headers and the file itself are all the product's own.
 */

const PREFIX = "aud01x";
/** `AUD01_SAMPLE_DIR=<dir>` keeps the files two tests download, as handoff samples. */
const SAMPLES = process.env.AUD01_SAMPLE_DIR;
const restore: Array<() => Promise<unknown>> = [];
let serial = 0;

async function removeFixtures() {
  const allocations = await prisma.paymentAllocation.findMany({ where: { OR: [{ invoiceId: { startsWith: PREFIX } }, { expenseId: { startsWith: PREFIX } }] }, select: { paymentId: true } });
  const paymentIds = [...new Set(allocations.map((row) => row.paymentId))];
  await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.invoice.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.expense.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.client.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.auditEvent.deleteMany({ where: { entityType: "export", entityId: { in: ["finance-invoices", "finance-expenses"] } } });
}

afterEach(async () => {
  for (const undo of restore.splice(0).reverse()) await undo();
  await removeFixtures();
  await cleanupSessions();
  actAs(null);
});
afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

const finance = () => loginAs("FINANCE");
const groupFinance = () => loginAs("FINANCE", { workspace: "GROUP" });

type Called = { status: number; headers: Headers; text: string; bytes: Uint8Array; json: () => unknown };

async function call(route: (request: Request) => Promise<Response>, path: string, as: UserContext | null): Promise<Called> {
  actAs(as);
  const response = await route(new Request(`http://nesto.test${path}`));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  return { status: response.status, headers: response.headers, text, bytes, json: () => JSON.parse(text) };
}

async function seedInvoices(tag: string, count: number, overrides: (index: number) => Record<string, unknown> = () => ({})) {
  const rows = Array.from({ length: count }, (_, index) => {
    serial += 1;
    return {
      id: `${PREFIX}_inv_${tag.toLowerCase()}_${serial}`,
      companyId: COMPANY.a,
      invoiceNumber: `AUD01X-${tag}-${String(index + 1).padStart(3, "0")}`,
      clientId: "client_acme",
      projectId: PROJECT.a,
      issueDate: new Date(Date.UTC(2026, 4, 28 - (index % 20))),
      dueDate: new Date(Date.UTC(2030, 0, 1)),
      currency: "EUR",
      subtotal: "100.00",
      taxAmount: "0.00",
      totalAmount: "100.00",
      status: "SENT" as const,
      createdByMemberId: "member_finance",
      ...overrides(index),
    };
  });
  await prisma.invoice.createMany({ data: rows });
  return rows.map((row) => row.id);
}

async function seedExpenses(tag: string, count: number, overrides: (index: number) => Record<string, unknown> = () => ({}), company: string = COMPANY.a) {
  const member = company === COMPANY.a ? "member_finance" : `member_finance__${company.slice(-1)}`;
  const project = company === COMPANY.a ? PROJECT.a : `project_${company.slice(-1)}`;
  const rows = Array.from({ length: count }, (_, index) => {
    serial += 1;
    return {
      id: `${PREFIX}_exp_${tag.toLowerCase()}_${serial}`,
      companyId: company,
      expenseNumber: `AUD01X-${tag}-${String(index + 1).padStart(5, "0")}`,
      projectId: project,
      expenseDate: new Date(Date.UTC(2026, 4, 28)),
      category: "MATERIALS" as const,
      description: `Export fixture ${tag}`,
      payeeName: "Fixture Supplies",
      currency: "EUR",
      netAmount: "100.00",
      taxAmount: "0.00",
      totalAmount: "100.00",
      status: "APPROVED" as const,
      createdByMemberId: member,
      ...overrides(index),
    };
  });
  await prisma.expense.createMany({ data: rows });
  return rows.map((row) => row.id);
}

async function payInvoice(invoiceId: string, amount: string) {
  serial += 1;
  const paymentId = `${PREFIX}_pay_${serial}`;
  await prisma.payment.create({
    data: { id: paymentId, companyId: COMPANY.a, direction: "RECEIPT", clientId: "client_acme", amount, currency: "EUR", paymentDate: new Date(Date.UTC(2026, 4, 30)), method: "BANK_TRANSFER", createdByMemberId: "member_finance" },
  });
  await prisma.paymentAllocation.create({ data: { companyId: COMPANY.a, paymentId, invoiceId, amount, createdByMemberId: "member_finance" } });
}

/** A Group reader who may read Finance in every company but export in all but one. */
async function withoutExportIn(companyId: string) {
  const member = await prisma.companyMember.findFirstOrThrow({ where: { companyId, user: { email: "finance@nesto.test" } }, select: { id: true, roleId: true } });
  const ceo = await prisma.role.findUniqueOrThrow({ where: { key: "CEO" }, select: { id: true } });
  await prisma.companyMember.update({ where: { id: member.id }, data: { roleId: ceo.id } });
  restore.push(() => prisma.companyMember.update({ where: { id: member.id }, data: { roleId: member.roleId } }));
}

/* -------------------------------------------------------------------------- */
/* The file                                                                    */
/* -------------------------------------------------------------------------- */

describe("the CSV file (AUD-01 §8)", () => {
  it("FA-16 answers no match with a header-only file, and says so in its headers", async () => {
    const response = await call(exportInvoicesRoute, "/api/finance/invoices/export?search=AUD01X-NOTHING-", await finance());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-export-row-count")).toBe("0");
    expect(response.headers.get("x-export-evaluated-at")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="nesto-invoices-\d{8}-\d{6}Z\.csv"$/);
    // UTF-8 with a byte-order mark, one CRLF-terminated header row.
    expect([...response.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(response.text).toBe(`﻿${INVOICE_EXPORT_COLUMNS.join(",")}\r\n`);

    const costs = await call(exportExpensesRoute, "/api/finance/expenses/export?search=AUD01X-NOTHING-", await finance());
    expect(costs.text).toBe(`﻿${EXPENSE_EXPORT_COLUMNS.join(",")}\r\n`);
    expect(costs.headers.get("content-disposition")).toMatch(/filename="nesto-expenses-\d{8}-\d{6}Z\.csv"/);
  });

  it("FA-15 holds every match once, in the list's order and with the list's values, whichever page it was asked from", async () => {
    const ids = await seedInvoices("FA15", 40, (index) => ({ totalAmount: String(100 + (index % 3) * 50) + ".00", subtotal: String(100 + (index % 3) * 50) + ".00" }));
    for (const [index, id] of ids.entries()) if (index % 4 === 0) await payInvoice(id, "100.00");
    else if (index % 4 === 1) await payInvoice(id, "40.00");
    const session = await finance();
    const filters = "search=AUD01X-FA15-&settlement=PAID,PARTIALLY_PAID&sort=amount-desc&currency=EUR";

    const list: Array<{ id: string; paidAmount: string; outstandingAmount: string; totalAmount: string }> = [];
    for (let page = 1; ; page += 1) {
      const result = await invoices.listInvoicesForWorkspace(session, parseInvoiceQuery(new URLSearchParams(`${filters}&limit=7&page=${page}`)));
      list.push(...result.data);
      if (page >= result.pagination.totalPages) break;
    }
    expect(list.length).toBe(20);

    const response = await call(exportInvoicesRoute, `/api/finance/invoices/export?${filters}&page=2&limit=7`, session);
    expect(response.status).toBe(200);
    if (SAMPLES) writeFileSync(join(SAMPLES, "sample-invoices-paid-or-partial.csv"), response.bytes);
    const [header, ...rows] = parseCsv(response.text);
    expect(header).toEqual([...INVOICE_EXPORT_COLUMNS]);
    expect(response.headers.get("x-export-row-count")).toBe("20");
    expect(rows.map((row) => row[2])).toEqual(list.map((row) => row.id));
    expect(rows.map((row) => [row[12], row[13], row[14]])).toEqual(list.map((row) => [row.totalAmount, row.paidAmount, row.outstandingAmount]));
    expect(new Set(rows.map((row) => row[11]))).toEqual(new Set(["Paid", "Partially paid"]));
    expect(rows.every((row) => row[0] === COMPANY.a && row[10] === "Sent" && row[9] === "EUR")).toBe(true);
  });

  it("FA-17 keeps formula-looking names text, quotes what needs quoting and keeps Albanian letters", async () => {
    const payees = ["=HYPERLINK(\"http://evil.test\",\"Open\")", " =1+1", "\t@SUM(A1)", "\n-2+3", "+cmd", "Rruga \"Kavajës\", Tiranë", "Line one\nline two", "Çelësi & Ëmbëlsira — Shkodër"];
    const ids = await seedExpenses("FA17", payees.length, (index) => ({ payeeName: payees[index] }));
    serial += 1;
    const formulaClient = `${PREFIX}_client_${serial}`;
    const creator = await prisma.companyMember.findUniqueOrThrow({ where: { id: "member_finance" }, select: { userId: true } });
    await prisma.client.create({ data: { id: formulaClient, companyId: COMPANY.a, name: "@Klient Ç", createdBy: creator.userId } });
    await seedInvoices("FA17", 1, () => ({ clientId: formulaClient, projectId: null }));

    const response = await call(exportExpensesRoute, "/api/finance/expenses/export?search=AUD01X-FA17-&sort=date-desc", await finance());
    expect(response.status).toBe(200);
    if (SAMPLES) writeFileSync(join(SAMPLES, "sample-expenses-cell-safety.csv"), response.bytes);
    const rows = parseCsv(response.text).slice(1);
    const byId = new Map(rows.map((row) => [row[2], row[4]]));
    expect(ids.map((id) => byId.get(id))).toEqual([
      "'=HYPERLINK(\"http://evil.test\",\"Open\")",
      "' =1+1",
      "'\t@SUM(A1)",
      "'\n-2+3",
      "'+cmd",
      "Rruga \"Kavajës\", Tiranë",
      "Line one\nline two",
      "Çelësi & Ëmbëlsira — Shkodër",
    ]);
    // Amounts stay numbers; a blank optional stays blank.
    expect(rows.every((row) => row[12] === "100.00" && row[13] === "0.00" && row[14] === "100.00")).toBe(true);

    const invoiceFile = await call(exportInvoicesRoute, "/api/finance/invoices/export?search=AUD01X-FA17-", await finance());
    const [invoiceRow] = parseCsv(invoiceFile.text).slice(1);
    expect(invoiceRow![4]).toBe("'@Klient Ç");
    expect([invoiceRow![5], invoiceRow![6]]).toEqual(["", ""]);
  });

  it("FA-16 exports exactly the cap, and refuses one more with EXPORT_LIMIT_EXCEEDED and no file", async () => {
    const ids = await seedExpenses("FA16", EXPORT_ROW_LIMIT + 1);
    const session = await finance();

    const refused = await call(exportExpensesRoute, "/api/finance/expenses/export?search=AUD01X-FA16-", session);
    expect(refused.status).toBe(422);
    expect(refused.headers.get("content-type")).toMatch(/application\/json/);
    expect(refused.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", message: "Too many records to export. Narrow your filters to 10,000 records or fewer.", details: { code: "EXPORT_LIMIT_EXCEEDED" } },
    });

    await prisma.expense.delete({ where: { id: ids[0]! } });
    const full = await call(exportExpensesRoute, "/api/finance/expenses/export?search=AUD01X-FA16-", session);
    expect(full.status).toBe(200);
    expect(full.headers.get("x-export-row-count")).toBe(String(EXPORT_ROW_LIMIT));
    const rows = parseCsv(full.text).slice(1);
    expect(rows).toHaveLength(EXPORT_ROW_LIMIT);
    expect(new Set(rows.map((row) => row[2])).size).toBe(EXPORT_ROW_LIMIT);
    expect(full.text.split("\r\n")).toHaveLength(EXPORT_ROW_LIMIT + 2);
  }, 120_000);

  it("records who exported which register, not the rows or the filters", async () => {
    const session = await finance();
    await call(exportInvoicesRoute, "/api/finance/invoices/export?search=AUD01X-NOTHING-", session);
    const event = await prisma.auditEvent.findFirst({ where: { entityType: "export", entityId: "finance-invoices", actorUserId: session.userId }, orderBy: { occurredAt: "desc" } });
    expect(event?.actionKey).toBe("REPORT_EXPORTED_CSV");
  });
});

/* -------------------------------------------------------------------------- */
/* Who may export                                                              */
/* -------------------------------------------------------------------------- */

describe("who may export (AUD-01 §7; FA-13, FA-14, FA-21)", () => {
  it("FA-21 refuses a signed-out caller, a role without the permission and a reader without finance.export", async () => {
    expect((await call(exportInvoicesRoute, "/api/finance/invoices/export", null)).status).toBe(401);
    expect((await call(listInvoicesRoute, "/api/finance/invoices", null)).status).toBe(401);

    for (const role of ["HR", "GROUP_IT", "VIEWER"] as const) {
      const context = await loginAs(role);
      expect((await call(listInvoicesRoute, "/api/finance/invoices", context)).status, `${role} list`).toBe(403);
      expect((await call(exportInvoicesRoute, "/api/finance/invoices/export", context)).status, `${role} export`).toBe(403);
      expect((await call(exportExpensesRoute, "/api/finance/expenses/export", context)).status, `${role} expense export`).toBe(403);
    }

    // The CEO reads both registers and may not take a copy of either.
    const ceo = await loginAs("CEO");
    expect((await call(listInvoicesRoute, "/api/finance/invoices", ceo)).status).toBe(200);
    const refused = await call(exportInvoicesRoute, "/api/finance/invoices/export", ceo);
    expect(refused.status).toBe(403);
    expect(refused.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(await financeExportEligibility(ceo, "finance.invoice.view")).toEqual({ state: "unavailable" });

    // A group person with no Finance anywhere reads an empty list, and exports nothing.
    const hr = await loginAs("HR", { workspace: "GROUP" });
    expect((await call(listInvoicesRoute, "/api/finance/invoices", hr)).json()).toMatchObject({ data: [], pagination: { total: 0 }, summary: { matchingCount: 0 } });
    expect((await call(exportInvoicesRoute, "/api/finance/invoices/export", hr)).status).toBe(403);
  });

  it("FA-13 refuses when Finance is switched off, and a foreign company filter exports nothing rather than everything", async () => {
    await seedExpenses("FA13", 2);
    const group = await groupFinance();
    const foreign = await call(exportExpensesRoute, `/api/finance/expenses/export?search=AUD01X-FA13-&company=${COMPANY.tenant}`, group);
    expect(foreign.status).toBe(200);
    expect(foreign.headers.get("x-export-row-count")).toBe("0");
    const all = await call(exportExpensesRoute, "/api/finance/expenses/export?search=AUD01X-FA13-", group);
    expect(all.headers.get("x-export-row-count")).toBe("2");

    const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId: COMPANY.a, module: { key: "finance" } } });
    await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
    restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));
    const off = await call(exportExpensesRoute, "/api/finance/expenses/export", await finance());
    expect(off.status).toBe(403);
    expect(off.json()).toMatchObject({ error: { code: "MODULE_UNAVAILABLE" } });
    // In the group, the switched-off company is simply not there.
    const without = await call(exportExpensesRoute, "/api/finance/expenses/export?search=AUD01X-FA13-", await groupFinance());
    expect(without.headers.get("x-export-row-count")).toBe("0");
  });

  it("FA-14 refuses a Group export whole while one company in it does not allow export, and allows it once narrowed", async () => {
    await seedExpenses("FA14", 1);
    await seedExpenses("FA14", 1, () => ({}), COMPANY.b);
    await seedExpenses("FA14", 1, () => ({}), COMPANY.c);
    await withoutExportIn(COMPANY.c);
    const group = await groupFinance();

    // The list still reads all three companies.
    const list = (await call(listExpensesRoute, "/api/finance/expenses?search=AUD01X-FA14-", group)).json() as { pagination: { total: number } };
    expect(list.pagination.total).toBe(3);

    const whole = await call(exportExpensesRoute, "/api/finance/expenses/export?search=AUD01X-FA14-", group);
    expect(whole.status).toBe(403);
    expect(whole.json()).toMatchObject({ error: { code: "FORBIDDEN", details: { code: "EXPORT_COMPANY_REQUIRED" } } });
    expect(whole.text).not.toContain("AUD01X");

    const inC = await call(exportExpensesRoute, `/api/finance/expenses/export?search=AUD01X-FA14-&company=${COMPANY.c}`, group);
    expect(inC.status).toBe(403);

    const inB = await call(exportExpensesRoute, `/api/finance/expenses/export?search=AUD01X-FA14-&company=${COMPANY.b}`, group);
    expect(inB.status).toBe(200);
    expect(parseCsv(inB.text).slice(1).map((row) => row[0])).toEqual([COMPANY.b]);

    // The page offers the export only once narrowed, and names where it can go.
    const eligibility = await financeExportEligibility(group, "finance.expense.view");
    expect(eligibility.state).toBe("choose-company");
    expect(eligibility.state === "choose-company" && eligibility.companies.map((company) => company.id).sort()).toEqual([COMPANY.a, COMPANY.b, COMPANY.d, COMPANY.e]);
    expect(await financeExportEligibility(group, "finance.expense.view", COMPANY.b)).toEqual({ state: "allowed" });
  });
});

/* -------------------------------------------------------------------------- */
/* The JSON lists                                                              */
/* -------------------------------------------------------------------------- */

describe("the JSON lists (AUD-01 §5, §6)", () => {
  it("keeps the envelope and adds the filtered summary beside data and pagination", async () => {
    const ids = await seedInvoices("API", 30);
    await payInvoice(ids[28]!, "100.00");
    const body = (await call(listInvoicesRoute, "/api/finance/invoices?search=AUD01X-API-&settlement=PAID&page=9", await finance())).json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["data", "pagination", "summary"]);
    expect(body.pagination).toEqual({ page: 1, limit: 25, total: 1, totalPages: 1 });
    expect(body.summary).toMatchObject({ matchingCount: 1, byCurrency: [{ currency: "EUR", count: 1, totalAmount: "100.00", paidAmount: "100.00", outstandingAmount: "0.00" }] });
    expect((body.data as Array<{ id: string }>).map((row) => row.id)).toEqual([ids[28]]);
  });

  it("refuses a date that is not a date and a range that ends before it starts, in the list and the export", async () => {
    const session = await finance();
    for (const query of ["issuedFrom=not-a-date", "issuedFrom=2026-05-10&issuedTo=2026-05-01"]) {
      const list = await call(listInvoicesRoute, `/api/finance/invoices?${query}`, session);
      expect(list.status, query).toBe(422);
      expect((await call(exportInvoicesRoute, `/api/finance/invoices/export?${query}`, session)).status, query).toBe(422);
    }
    expect((await call(listExpensesRoute, "/api/finance/expenses?incurredFrom=2026-05-10&incurredTo=2026-05-01", session)).status).toBe(422);
    // A single day is a range that starts and ends on it.
    expect((await call(listInvoicesRoute, "/api/finance/invoices?issuedFrom=2026-05-10&issuedTo=2026-05-10", session)).status).toBe(200);
  });
});
