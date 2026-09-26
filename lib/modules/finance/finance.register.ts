import { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { logger } from "@/lib/core/observability/logger";
import { observeHistogram } from "@/lib/core/observability/metrics";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { toAmountString, ZERO } from "./finance.money";
import type { FinanceListSummary } from "./finance.types";

/**
 * The invoice and expense registers (AUD-01 §4-§8).
 *
 * One read answers a register's list, count, filtered totals and CSV export, in
 * this order and inside one database snapshot:
 *
 *   scope and filters (the repositories' existing `where`) → settlement, from the
 *   settlement views → one grouped total per currency, which is also the count →
 *   the page (or the export) in a fixed order ending in the record id.
 *
 * Nothing is filtered after the rows are read: a Paid record on what would have
 * been page 2 is on page 1 of a Paid search, and the count says so. Everything
 * here is shared by both record types; what differs is in each repository.
 */

export type RegisterName = "invoices" | "expenses";

/** Which rows the snapshot hands back once it knows how many match. */
export type RegisterWindow =
  | { kind: "page"; page: number; limit: number }
  | { kind: "export"; limit: number };

export type RegisterSlice = { skip: number; take: number; page: number };

/** The grouped totals the settlement views give per currency. */
export type CurrencyGroup = {
  currency: string;
  _count: { _all: number };
  _sum: {
    totalAmount: Prisma.Decimal | null;
    paidAmount: Prisma.Decimal | null;
    outstandingAmount: Prisma.Decimal | null;
    integrityIssues: number | null;
  };
};

/** A synchronous export stays a spreadsheet, not a database dump (AUD-01 §8). */
export const EXPORT_ROW_LIMIT = 10_000;

/**
 * One consistent read (AUD-01 §4): repeatable read, read only, so the totals,
 * the count and the rows all see the same payments. Only database work runs
 * inside; nothing waits on the browser. A timeout is an ordinary failure —
 * never a shorter list or a truncated file.
 */
export function readRegisterSnapshot<T>(
  register: RegisterName,
  read: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  return runInTransaction(
    `finance.${register}.register`,
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return read(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: options.timeoutMs ?? 15_000, maxWait: 5_000, attempts: 1 },
  );
}

/**
 * The rows to read, now that the count is known (AUD-01 §5.2). A page past the
 * end reads the last real page rather than an empty offset, and no match at
 * all is page 1 of nothing.
 */
export function registerSlice(window: RegisterWindow, total: number): RegisterSlice {
  // Past the cap an export is refused whole, so it reads no rows at all.
  if (window.kind === "export") return { skip: 0, take: total > window.limit ? 0 : total, page: 1 };
  const totalPages = Math.max(1, Math.ceil(total / window.limit));
  const page = Math.min(Math.max(1, window.page), totalPages);
  return { skip: (page - 1) * window.limit, take: window.limit, page };
}

/**
 * The filtered totals (AUD-01 §6), from one grouped aggregate over the
 * settlement view. Refuses a set that holds a record paid by an allocation from
 * another company or in another currency (AUD-01 §3): a figure built on one would
 * be wrong, and a wrong total is worse than none.
 */
export function registerSummary(register: RegisterName, groups: readonly CurrencyGroup[], evaluatedAt: Date): FinanceListSummary {
  assertSettlementIntegrity(register, groups.reduce((sum, group) => sum + (group._sum.integrityIssues ?? 0), 0));
  const byCurrency = [...groups]
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((group) => ({
      currency: group.currency,
      count: group._count._all,
      totalAmount: toAmountString(group._sum.totalAmount ?? ZERO),
      paidAmount: toAmountString(group._sum.paidAmount ?? ZERO),
      outstandingAmount: toAmountString(group._sum.outstandingAmount ?? ZERO),
    }));
  return {
    evaluatedAt: evaluatedAt.toISOString(),
    matchingCount: byCurrency.reduce((sum, group) => sum + group.count, 0),
    byCurrency,
  };
}

/**
 * Refuses a settlement figure built on allocations the writer would never have
 * accepted — another company's, or in another currency (AUD-01 §3). The log
 * carries the count, never an amount or a record, and the response fails with a
 * reference rather than showing a total that is not true.
 */
export function assertSettlementIntegrity(register: RegisterName, flaggedAllocations: number): void {
  if (flaggedAllocations <= 0) return;
  logger.error("finance.settlement_integrity", { register, allocations: flaggedAllocations });
  throw new AccessError(
    "INTERNAL_ERROR",
    "Some payments here do not match their record's company or currency, so the amounts cannot be shown. Ask a finance administrator to correct them.",
    { code: "SETTLEMENT_INTEGRITY" },
  );
}

/** Too many rows for one synchronous file: the whole request is refused, no partial file (AUD-01 §8). */
export function exportLimitExceeded(): AccessError {
  return new AccessError(
    "VALIDATION_ERROR",
    `Too many records to export. Narrow your filters to ${EXPORT_ROW_LIMIT.toLocaleString("en-US")} records or fewer.`,
    { code: "EXPORT_LIMIT_EXCEEDED", limit: EXPORT_ROW_LIMIT },
  );
}

/** `nesto-invoices-20260926-101530Z.csv`: the export's own instant, in UTC. */
export function exportFilename(register: RegisterName, evaluatedAt: Date): string {
  const stamp = evaluatedAt.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "").replace("T", "-");
  return `nesto-${register}-${stamp}.csv`;
}

/**
 * A register's duration, by what was asked and how it ended (AUD-01 §8, §10).
 * Labels only: never the filters, the search or a company.
 */
export function observeRegister(
  register: RegisterName,
  operation: "list" | "export",
  scope: "group" | "company",
  outcome: "success" | "failure" | "refused",
  startedAt: number,
): void {
  observeHistogram("finance_register_query_ms", { register, operation, scope, outcome }, Date.now() - startedAt);
}

/** Runs a register read with its duration and outcome recorded, whatever happens. */
export async function measuredRegister<T>(
  register: RegisterName,
  operation: "list" | "export",
  scope: "group" | "company",
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    observeRegister(register, operation, scope, "success", startedAt);
    return result;
  } catch (error) {
    const refused = error instanceof AccessError && error.status < 500;
    observeRegister(register, operation, scope, refused ? "refused" : "failure", startedAt);
    throw error;
  }
}
