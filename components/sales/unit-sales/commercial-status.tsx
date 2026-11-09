import { Badge } from "@/components/ui/badge";
import { SalesLabel } from "@/components/sales/sales-text";
import type { Locale } from "@/lib/i18n/config";
import { numberText } from "@/lib/i18n/format";
import { UNIT_COMMERCIAL_STATUS_LABELS, type UnitCommercialStatus } from "@/lib/modules/sales/units/unit-sales.types";

/**
 * Where a unit stands commercially, in words beside every colour (E-05E §7).
 * Never the publication badge: a published unit can be Not For Sale, and a unit
 * waiting for review can still be Reserved (§6, §35).
 */

const TONES: Record<UnitCommercialStatus, "default" | "info" | "success" | "warning" | "neutral"> = {
  NOT_FOR_SALE: "default",
  FOR_SALE: "success",
  ON_HOLD: "warning",
  RESERVED: "info",
  SOLD: "neutral",
};

export function CommercialStatusBadge({ status, className }: { status: UnitCommercialStatus; className?: string }) {
  return (
    <Badge tone={TONES[status]} className={className} data-testid="commercial-status" data-status={status}>
      <SalesLabel group="commercialStatus" value={status} fallback={UNIT_COMMERCIAL_STATUS_LABELS[status]} />
    </Badge>
  );
}

/** An amount with its currency: whole when it is whole, cents when it has them (§10, §11). */
export function moneyLabel(amount: string | null, currency: string | null, locale: Locale): string {
  if (amount === null) return "—";
  const value = Number(amount);
  const digits = Number.isInteger(value) ? 0 : 2;
  if (!currency) return numberText(value, { minimumFractionDigits: digits, maximumFractionDigits: 2 }, locale);
  return numberText(value, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: 2 }, locale);
}

/** Price per square metre, rounded to the whole currency unit for reading (§10). */
export function perSqmLabel(amount: string | null, currency: string | null, locale: Locale): string {
  if (amount === null) return "—";
  const value = Math.round(Number(amount));
  const text = currency ? numberText(value, { style: "currency", currency, maximumFractionDigits: 0 }, locale) : numberText(value, undefined, locale);
  return `${text}/m²`;
}

/**
 * The row tint for a unit's commercial status, shared by the Units and Sales
 * tables; Not for sale and On hold have none. The status colours at a low
 * strength, so red and orange stay apart (the `-soft` tokens are too close to
 * tell Sold from Reserved) and dark mode follows.
 */
export const COMMERCIAL_ROW_TINT: Partial<Record<UnitCommercialStatus, string>> = {
  FOR_SALE: "bg-success/15 hover:bg-success/25",
  RESERVED: "bg-warning/20 hover:bg-warning/30",
  SOLD: "bg-danger/20 hover:bg-danger/30",
};

/** The same tints for a phone card: `.nesto-card` paints its own surface, so these must win over it. */
export const COMMERCIAL_CARD_TINT: Partial<Record<UnitCommercialStatus, string>> = {
  FOR_SALE: "bg-success/15! hover:bg-success/25!",
  RESERVED: "bg-warning/20! hover:bg-warning/30!",
  SOLD: "bg-danger/20! hover:bg-danger/30!",
};
