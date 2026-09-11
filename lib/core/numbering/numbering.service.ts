import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";

/**
 * Human-readable business numbers (PRD #24 §86-§111, PRD #37 §113-§115).
 *
 * A database id is a cuid nobody will ever read aloud. `PO-2026-0042` is what
 * people quote in an email, so it is generated separately, per company, per
 * record type, and it is never recycled — a cancelled draft leaves a gap and
 * that is correct (PRD #24 §110, §111).
 *
 * Allocation takes a row lock for the length of one transaction, so a hundred
 * concurrent creates produce a hundred distinct numbers (PRD #24 §95, §270).
 * The final uniqueness guarantee still belongs to the business table's own
 * unique constraint (PRD #24 §103).
 */

export type NumberingTarget = {
  companyId: string;
  moduleKey: string;
  entityType: string;
};

/** Renders a scheme without consuming a sequence — for previews (PRD #24 §116). */
export function formatNumber(scheme: {
  prefix: string | null;
  separator: string;
  yearMode: "NONE" | "YYYY" | "YY";
  padding: number;
  nextSequence: number;
}, year: number): string {
  const parts: string[] = [];
  if (scheme.prefix) parts.push(scheme.prefix);
  if (scheme.yearMode === "YYYY") parts.push(String(year));
  if (scheme.yearMode === "YY") parts.push(String(year % 100).padStart(2, "0"));
  parts.push(String(scheme.nextSequence).padStart(scheme.padding, "0"));
  return parts.join(scheme.separator);
}

/**
 * Allocates the next number for a record type, inside the caller's transaction
 * where one is supplied so the number and the record commit together.
 *
 * Returns null when the scheme is MANUAL or absent: the caller is expected to
 * have taken a number from the user instead (PRD #24 §107).
 */
export async function allocateNumber(
  target: NumberingTarget,
  options: { tx?: Prisma.TransactionClient; occurredAt?: Date } = {},
): Promise<string | null> {
  const run = async (tx: Prisma.TransactionClient) => {
    // FOR UPDATE: two concurrent allocations serialise here rather than both
    // reading the same nextSequence (PRD #24 §102, PRD #37 §153).
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        mode: string;
        prefix: string | null;
        separator: string;
        yearMode: string;
        padding: number;
        resetSequenceYearly: boolean;
        currentYear: number | null;
        nextSequence: number;
      }>
    >`
      SELECT id, mode, prefix, separator, "yearMode", padding,
             "resetSequenceYearly", "currentYear", "nextSequence"
      FROM company_numbering_schemes
      WHERE "companyId" = ${target.companyId}
        AND "moduleKey" = ${target.moduleKey}
        AND "entityType" = ${target.entityType}
      FOR UPDATE
    `;

    const scheme = rows[0];
    if (!scheme || scheme.mode !== "AUTO") return null;

    const year = (options.occurredAt ?? new Date()).getUTCFullYear();
    const reset = scheme.resetSequenceYearly && scheme.currentYear !== null && scheme.currentYear !== year;
    const sequence = reset ? 1 : scheme.nextSequence;

    const formatted = formatNumber(
      {
        prefix: scheme.prefix,
        separator: scheme.separator,
        yearMode: scheme.yearMode as "NONE" | "YYYY" | "YY",
        padding: scheme.padding,
        nextSequence: sequence,
      },
      year,
    );

    await tx.companyNumberingScheme.update({
      where: { id: scheme.id },
      data: { nextSequence: sequence + 1, currentYear: year },
    });

    return formatted;
  };

  return options.tx ? run(options.tx) : prisma.$transaction(run);
}

/** The record types that carry a number, seeded when a module is enabled. */
export const NUMBERING_DEFAULTS: Array<{
  moduleKey: string;
  entityType: string;
  prefix: string;
}> = [
  { moduleKey: "sales", entityType: "lead", prefix: "LEAD" },
  { moduleKey: "sales", entityType: "opportunity", prefix: "OPP" },
  { moduleKey: "sales", entityType: "proposal", prefix: "QT" },
  { moduleKey: "finance", entityType: "invoice", prefix: "INV" },
  { moduleKey: "finance", entityType: "expense", prefix: "EXP" },
  { moduleKey: "finance", entityType: "payment", prefix: "PAY" },
  { moduleKey: "finance", entityType: "commitment", prefix: "COM" },
  { moduleKey: "contracts", entityType: "contract", prefix: "CTR" },
  { moduleKey: "procurement", entityType: "purchase_request", prefix: "PR" },
  { moduleKey: "procurement", entityType: "rfq", prefix: "RFQ" },
  { moduleKey: "procurement", entityType: "purchase_order", prefix: "PO" },
  { moduleKey: "procurement", entityType: "goods_receipt", prefix: "GR" },
  { moduleKey: "inventory", entityType: "inventory_receipt", prefix: "IR" },
  { moduleKey: "inventory", entityType: "stock_issue", prefix: "ISS" },
  { moduleKey: "inventory", entityType: "stock_transfer", prefix: "TRF" },
  { moduleKey: "inventory", entityType: "stock_adjustment", prefix: "ADJ" },
  { moduleKey: "qaqc", entityType: "inspection", prefix: "QI" },
  { moduleKey: "qaqc", entityType: "ncr", prefix: "NCR" },
  { moduleKey: "qaqc", entityType: "corrective_action", prefix: "CA" },
  { moduleKey: "hse", entityType: "hazard", prefix: "HZ" },
  { moduleKey: "hse", entityType: "incident", prefix: "INC" },
  { moduleKey: "hse", entityType: "permit", prefix: "PTW" },
  { moduleKey: "hse", entityType: "action", prefix: "HSA" },
];
