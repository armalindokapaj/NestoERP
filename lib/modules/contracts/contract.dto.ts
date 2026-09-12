import type { MembershipStatus, Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { toAmountString } from "@/lib/modules/finance/finance.money";
import { businessDateString } from "@/lib/modules/finance/finance.fields";
import type {
  ContractCommercialDTO,
  CurrencyTotal,
  MemberRef,
  ModuleLinkRef,
} from "./contract.types";

/**
 * The shapes every Legal DTO shares, and the two curtains (PRD #18 §255, §257).
 *
 * Redaction happens once, here, on the way out of the service. Nothing
 * downstream is trusted to hide a value it was handed: if the reader has no
 * commercial permission the number never leaves the server (PRD #18 §495).
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

/* -------------------------------------------------------------------------- */
/* Permission curtains                                                         */
/* -------------------------------------------------------------------------- */

export function canSeeCommercial(context: UserContext): boolean {
  return can(context, "legal.commercial.view");
}

export function canSeeConfidential(context: UserContext): boolean {
  return can(context, "legal.confidential_terms.view");
}

/**
 * The commercial block, or nothing at all (PRD #18 §22, §255).
 *
 * `null` rather than an object of nulls: a card that renders an empty money row
 * tells the reader there is a figure they are not being shown, which is the
 * leak `legal.commercial.view` exists to prevent (PRD #18 §495).
 */
export function commercialDTO(
  context: UserContext,
  row: { currency: string | null; contractValue: Prisma.Decimal | null },
): ContractCommercialDTO | null {
  if (!canSeeCommercial(context)) return null;
  return {
    currency: row.currency,
    contractValue: row.contractValue === null ? null : toAmountString(row.contractValue),
  };
}

/** A confidential string, or null (PRD #18 §23, §257). */
export function confidential(context: UserContext, value: string | null): string | null {
  return canSeeConfidential(context) ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Cross-module links                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A link the reader may follow, or a name they may only read (PRD #18 §496).
 *
 * `reachable` is answered by the target module's own access rules, so a
 * contract never becomes a way to discover that a project exists.
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
 * Totals grouped by currency (PRD #18 §65, §221, §447).
 *
 * A row with no currency or no value is counted and contributes nothing — a
 * contract worth an unrecorded amount is still a contract, and inventing zero
 * for it would understate every total it appears in.
 */
export function currencyTotals(
  rows: { currency: string | null; contractValue: Prisma.Decimal | null }[],
): CurrencyTotal[] {
  const totals = new Map<string, { count: number; value: Prisma.Decimal | null }>();

  for (const row of rows) {
    if (!row.currency || row.contractValue === null) continue;
    const current = totals.get(row.currency);
    if (current) {
      current.count += 1;
      current.value = current.value!.plus(row.contractValue);
    } else {
      totals.set(row.currency, { count: 1, value: row.contractValue });
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

/** A calendar date as the API renders it: `"2026-09-30"` (PRD #18 §352). */
export function dateString(value: Date | null | undefined): string | null {
  return value ? businessDateString(value) : null;
}
