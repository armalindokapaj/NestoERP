import type { Prisma } from "@prisma/client";

import type { ApprovalMoney, ApprovalPriority } from "../approvals.types";
import type { MatchFilters } from "../approvals.cycle-provider";

/**
 * Small pieces every provider uses to describe its records the same way.
 */

/** At or above this, an approval is high priority and Approve asks twice (PRD #41 §84, §85). */
export const HIGH_VALUE_AMOUNT = 50_000;

/** A bound on how many record ids a filter may resolve to (PRD #41 §252). */
export const MATCH_LIMIT = 500;

type DecimalLike = Prisma.Decimal | { toString(): string } | number | null | undefined;

export function moneyOf(amount: DecimalLike, currency: string | null | undefined): ApprovalMoney | null {
  if (amount === null || amount === undefined || !currency) return null;
  return { value: Number(amount.toString()).toFixed(2), currency };
}

/** Value-driven presentation: a large sum is worth a second look, never a different outcome. */
export function valueSignals(amount: DecimalLike): { priority: ApprovalPriority; requiresStrongConfirmation: boolean } {
  const value = amount === null || amount === undefined ? 0 : Number(amount.toString());
  const high = value >= HIGH_VALUE_AMOUNT;
  return { priority: high ? "HIGH" : "NORMAL", requiresStrongConfirmation: high };
}

export function projectRef(project: { id: string; name: string; code?: string | null } | null | undefined) {
  return project ? { id: project.id, name: project.name, code: project.code ?? null } : null;
}

export function term(q: string) {
  return { contains: q, mode: "insensitive" as const };
}

/** A where fragment for an amount range on one column, or nothing. */
export function amountWhere(field: string, filters: MatchFilters): Record<string, unknown> {
  if (filters.amountMin === undefined && filters.amountMax === undefined) return {};
  return {
    [field]: {
      ...(filters.amountMin !== undefined ? { gte: filters.amountMin } : {}),
      ...(filters.amountMax !== undefined ? { lte: filters.amountMax } : {}),
    },
  };
}

export function projectWhere(filters: MatchFilters): Record<string, unknown> {
  return filters.projectId ? { projectId: filters.projectId } : {};
}

/** A record type without amounts matches no amount filter. */
export function excludesAmountFilter(filters: MatchFilters): boolean {
  return filters.amountMin !== undefined || filters.amountMax !== undefined;
}

export function formatAmount(amount: DecimalLike, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !currency) return "—";
  const value = Number(amount.toString());
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatDate(value: Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
}

export function labelOf(value: string | null | undefined): string {
  if (!value) return "—";
  const words = value.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Start of today in UTC, for comparing business dates stored at midday UTC. */
export function startOfToday(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
