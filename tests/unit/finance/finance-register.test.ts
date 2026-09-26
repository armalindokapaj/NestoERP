import { ZodError } from "zod";
import { describe, expect, it } from "vitest";

import {
  canonicalExpenseSearch,
  canonicalInvoiceSearch,
  parseExpenseQuery,
  parseInvoiceQuery,
  searchString,
} from "@/lib/modules/finance/finance.query";
import { exportFilename, registerSlice } from "@/lib/modules/finance/finance.register";
import { expenseSettlementWhere, invoiceSettlementWhere } from "@/lib/modules/finance/invoices/invoice.status";

/**
 * The register's pure parts (AUD-01 §3, §5, §8): which rows a page reads, the
 * address of the list that ran, the settlement arms and the file name.
 */

describe("the page a register reads (AUD-01 §5.2)", () => {
  it("reads the last real page for a page past the end, and page 1 of nothing for no match", () => {
    expect(registerSlice({ kind: "page", page: 999, limit: 25 }, 26)).toEqual({ skip: 25, take: 25, page: 2 });
    expect(registerSlice({ kind: "page", page: 2, limit: 25 }, 26)).toEqual({ skip: 25, take: 25, page: 2 });
    expect(registerSlice({ kind: "page", page: 1, limit: 25 }, 0)).toEqual({ skip: 0, take: 25, page: 1 });
    expect(registerSlice({ kind: "page", page: 3, limit: 25 }, 0)).toEqual({ skip: 0, take: 25, page: 1 });
    expect(registerSlice({ kind: "page", page: 4, limit: 10 }, 40)).toEqual({ skip: 30, take: 10, page: 4 });
  });

  it("reads every match for an export up to the cap, and nothing past it", () => {
    expect(registerSlice({ kind: "export", limit: 10_000 }, 0)).toEqual({ skip: 0, take: 0, page: 1 });
    expect(registerSlice({ kind: "export", limit: 10_000 }, 10_000)).toEqual({ skip: 0, take: 10_000, page: 1 });
    expect(registerSlice({ kind: "export", limit: 10_000 }, 10_001)).toEqual({ skip: 0, take: 0, page: 1 });
  });
});

describe("normalising the query (AUD-01 §5.1)", () => {
  it("counts a repeated value once and drops unknown ones", () => {
    expect(parseInvoiceQuery({ settlement: "paid,PAID, overdue ,nonsense" }).settlement).toEqual(["PAID", "OVERDUE"]);
    expect(parseExpenseQuery({ category: "labor,LABOR,materials" }).category).toEqual(["LABOR", "MATERIALS"]);
    expect(parseInvoiceQuery({ settlement: "nonsense" }).settlement).toBeUndefined();
  });

  it("keeps the page and limit rules: page from 1, limit 25 by default and 100 at most", () => {
    expect(parseInvoiceQuery({ page: "-4", limit: "0" })).toMatchObject({ page: 1, limit: 25 });
    expect(parseInvoiceQuery({ page: "x", limit: "500" })).toMatchObject({ page: 1, limit: 100 });
  });

  it("refuses a date that is not a date and a range that ends before it starts", () => {
    expect(() => parseInvoiceQuery({ issuedFrom: "31/31/2026" })).toThrow(ZodError);
    expect(() => parseInvoiceQuery({ issuedFrom: "2026-05-02", issuedTo: "2026-05-01" })).toThrow(ZodError);
    expect(() => parseExpenseQuery({ incurredFrom: "2026-05-02", incurredTo: "2026-05-01" })).toThrow(ZodError);
    expect(parseInvoiceQuery({ issuedFrom: "2026-05-01", issuedTo: "2026-05-01" }).issuedTo).toEqual(new Date("2026-05-01"));
  });
});

describe("the address of the list that ran (AUD-01 §5.1, §5.2)", () => {
  it("rewrites what the list understood and keeps everything else as it came", () => {
    const raw = { settlement: "paid,PAID,bogus", sort: "sideways", page: "999", limit: "500", company: "company_demo_b", search: "  tower  ", other: "kept" };
    const query = parseInvoiceQuery(raw);
    expect(canonicalInvoiceSearch(raw, query, 3)).toBe("settlement=PAID&page=3&limit=100&company=company_demo_b&search=tower&other=kept");
  });

  it("leaves an address that is already what ran exactly as it is", () => {
    for (const raw of [{}, { settlement: "PAID,PARTIALLY_PAID", page: "2" }, { archived: "1", search: "tower" }, { issuedFrom: "2026-05-01", sort: "due-asc" }]) {
      const query = parseInvoiceQuery(raw);
      expect(canonicalInvoiceSearch(raw, query, query.page)).toBe(searchString(raw));
    }
  });

  it("drops a first page, a default limit and a workflow filter the archive does not apply", () => {
    const raw = { page: "1", limit: "25", status: "SENT", archived: "1" };
    expect(canonicalInvoiceSearch(raw, parseInvoiceQuery(raw, { archived: true }), 1)).toBe("archived=1");
    const expenses = { page: "0", category: "travel" };
    expect(canonicalExpenseSearch(expenses, parseExpenseQuery(expenses), 1)).toBe("category=TRAVEL");
  });
});

describe("the settlement arms (AUD-01 §3)", () => {
  it("excludes the earlier branches from each later one, overdue before partly paid", () => {
    const at = new Date("2026-06-15T00:00:00.000Z");
    expect(invoiceSettlementWhere(["PARTIALLY_PAID"], at)).toEqual({
      OR: [{ outstandingAmount: { gt: 0 }, NOT: { status: "SENT", dueDate: { lt: at } }, paidAmount: { gt: 0 } }],
    });
    expect(invoiceSettlementWhere(["PAID", "PAID"], at)).toEqual({ OR: [{ outstandingAmount: { lte: 0 } }] });
    expect(expenseSettlementWhere(["UNPAID"])).toEqual({ OR: [{ outstandingAmount: { gt: 0 }, paidAmount: { lte: 0 } }] });
  });
});

describe("the file name (AUD-01 §8)", () => {
  it("is the register and the export's own instant in UTC", () => {
    expect(exportFilename("invoices", new Date("2026-09-26T10:15:30.123Z"))).toBe("nesto-invoices-20260926-101530Z.csv");
    expect(exportFilename("expenses", new Date("2026-01-02T03:04:05.000Z"))).toBe("nesto-expenses-20260102-030405Z.csv");
  });
});
