import type { MembershipStatus, Prisma, SupplierStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { businessDateString } from "@/lib/modules/finance/finance.fields";
import { toAmountString } from "@/lib/modules/finance/finance.money";
import type { CurrencyTotal, MemberRef, ModuleLinkRef, SupplierRef } from "./procurement.types";

/**
 * The shapes every Procurement DTO shares, and the one curtain (PRD #19 §260).
 *
 * Redaction happens once, here, on the way out of the service. A reader without
 * `procurement.quote.view` never receives a supplier's price — not a hidden
 * one, an absent one. A blank where a figure clearly belongs tells the reader
 * there is a number being withheld, which is the leak the permission exists to
 * prevent.
 */

type MemberRow = {
  id: string;
  status: MembershipStatus;
  user: { firstName: string; lastName: string };
};

export function toMemberRef(row: MemberRow | null | undefined): MemberRef | null {
  if (!row) return null;
  return {
    memberId: row.id,
    fullName: `${row.user.firstName} ${row.user.lastName}`,
    active: row.status === "ACTIVE",
  };
}

export async function loadMemberRef(memberId: string | null): Promise<MemberRef | null> {
  if (!memberId) return null;
  const member = await prisma.companyMember.findUnique({
    where: { id: memberId },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });
  return toMemberRef(member);
}

export function toSupplierRef(
  row: { id: string; name: string; status: SupplierStatus } | null | undefined,
): SupplierRef | null {
  if (!row) return null;
  return { id: row.id, name: row.name, status: row.status };
}

/* -------------------------------------------------------------------------- */
/* Permission curtains                                                         */
/* -------------------------------------------------------------------------- */

export function canSeeQuotePricing(context: UserContext): boolean {
  return can(context, "procurement.quote.view");
}

export function canSeeCommitment(context: UserContext): boolean {
  return can(context, "procurement.commitment.view");
}

export function canSeeBudget(context: UserContext): boolean {
  return can(context, "procurement.budget.view");
}

/* -------------------------------------------------------------------------- */
/* Cross-module links                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A link the reader may follow, or a name they may only read (PRD #19 §263).
 *
 * `reachable` is answered by the target module's own access rules, so a
 * purchase order never becomes a way to discover that a contract exists.
 */
export function moduleLink(
  id: string,
  label: string,
  href: string,
  reachable: boolean,
): ModuleLinkRef {
  return { id, label, href: reachable ? href : null };
}

/* -------------------------------------------------------------------------- */
/* Currency grouping                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Totals grouped by currency and never summed across them (PRD #19 §190).
 *
 * V0.1 has no FX engine, so "€400,000 + $200,000" is not a number this product
 * is allowed to print.
 */
export function currencyTotals(
  rows: { currency: string | null; amount: Prisma.Decimal | null }[],
): CurrencyTotal[] {
  const totals = new Map<string, { count: number; value: Prisma.Decimal }>();

  for (const row of rows) {
    if (!row.currency || row.amount === null) continue;
    const current = totals.get(row.currency);
    if (current) {
      current.count += 1;
      current.value = current.value.plus(row.amount);
    } else {
      totals.set(row.currency, { count: 1, value: row.amount });
    }
  }

  return [...totals.entries()]
    .map(([currency, entry]) => ({
      currency,
      count: entry.count,
      value: toAmountString(entry.value),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** A calendar date as the API renders it: `"2026-09-30"` (PRD #19 §282). */
export function dateString(value: Date | null | undefined): string | null {
  return value ? businessDateString(value) : null;
}

export { toAmountString };
