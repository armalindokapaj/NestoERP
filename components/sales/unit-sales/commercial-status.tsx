import { Badge } from "@/components/ui/badge";
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
      {UNIT_COMMERCIAL_STATUS_LABELS[status]}
    </Badge>
  );
}

/** An amount with its currency: whole when it is whole, cents when it has them (§10, §11). */
export function moneyLabel(amount: string | null, currency: string | null): string {
  if (amount === null) return "—";
  const value = Number(amount);
  const digits = Number.isInteger(value) ? 0 : 2;
  if (!currency) return value.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: 2 });
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(value);
}

/** Price per square metre, rounded to the whole currency unit for reading (§10). */
export function perSqmLabel(amount: string | null, currency: string | null): string {
  if (amount === null) return "—";
  const value = Math.round(Number(amount));
  const text = currency ? new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(value) : value.toLocaleString("en-GB");
  return `${text}/m²`;
}
