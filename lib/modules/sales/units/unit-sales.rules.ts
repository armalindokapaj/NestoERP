import type { UnitPublicationStatusKey } from "@/lib/modules/project-structure/structure.types";
import { PRICE_BASIS_AREA, type SoldCheck, type UnitCommercialStatus, type UnitPriceBasis, type UnitSoldRule } from "./unit-sales.types";

/**
 * The selling rules the unit page previews and the server enforces (E-05E §6,
 * §10, §22, §29, §42). Pure and client-safe.
 */

/**
 * A price per square metre, derived and never stored (§10): the asking price
 * over the area its basis names. A fixed price, a missing price or a missing or
 * zero area has none. Exact to the cent, computed on integers.
 */
export function pricePerSqm(askingPrice: string | null, basis: UnitPriceBasis, areas: Partial<Record<string, string | null>>): string | null {
  const field = PRICE_BASIS_AREA[basis];
  if (askingPrice === null || field === null) return null;
  const area = areas[field];
  if (area === null || area === undefined) return null;
  const cents = Math.round(Number(askingPrice) * 100);
  const centiMetres = Math.round(Number(area) * 100);
  if (!Number.isFinite(cents) || !Number.isFinite(centiMetres) || centiMetres <= 0) return null;
  // (cents / 100) / (cm / 100) = cents / cm, in currency units; round half up to cents.
  return (Math.round((cents * 100) / centiMetres) / 100).toFixed(2);
}

/** Whether a unit may be put on sale or reserved (§6): active and technically Published. */
export function sellability(unit: { isActive: boolean; publicationStatus: UnitPublicationStatusKey }): { sellable: boolean; reason: string | null } {
  if (!unit.isActive) return { sellable: false, reason: "This unit is inactive." };
  if (unit.publicationStatus !== "PUBLISHED") return { sellable: false, reason: "This Unit is not published for Sales use." };
  return { sellable: true, reason: null };
}

/**
 * The one place that decides whether a unit may be marked Sold (E-05E §29, §42;
 * E-05F §42-§44, §122). Always: a reserved unit with an active reservation for a
 * client, a deal and an agreed price. Then the company's Sold rule:
 *
 *   RESERVATION                   nothing more
 *   SIGNED_CONTRACT               the unit's live contract is signed
 *   DEPOSIT_RECEIVED              the active schedule's deposit is paid in full
 *   SIGNED_CONTRACT_AND_DEPOSIT   both
 *   MANUAL_APPROVAL               the sale approved for this reservation
 *
 * Meeting it only unlocks Mark Sold: a person still makes the sale, and the
 * commercial status stays Sales' one status (§44). A reservation past its expiry
 * is over even before the expiry job closes it (E-05E §24) — unless a contract
 * holds the unit, which the clock does not release (E-05F §8).
 */
export function canMarkUnitSold(input: {
  status: UnitCommercialStatus;
  reservation: { status: string; clientId: string | null; opportunityId: string | null; agreedPrice: string | null; expiresAt?: Date | string } | null;
  now?: Date;
  rule?: UnitSoldRule;
  contract?: { signed: boolean } | null;
  deposit?: { exists: boolean; paid: boolean };
  approval?: { status: string } | null;
}): SoldCheck {
  const rule = input.rule ?? "RESERVATION";
  const missing: string[] = [];
  if (input.status !== "RESERVED") missing.push("A reserved unit");
  const reservation = input.reservation?.status === "ACTIVE" ? input.reservation : null;
  if (!reservation) missing.push("An active reservation");
  if (!input.contract && reservation?.expiresAt !== undefined && new Date(reservation.expiresAt).getTime() <= (input.now ?? new Date()).getTime()) missing.push("A reservation that has not expired");
  if (reservation && !reservation.clientId) missing.push("A client");
  if (reservation && !reservation.opportunityId) missing.push("A deal");
  if (reservation && reservation.agreedPrice === null) missing.push("An agreed price");
  if ((rule === "SIGNED_CONTRACT" || rule === "SIGNED_CONTRACT_AND_DEPOSIT") && !input.contract?.signed) missing.push("A signed contract");
  if (rule === "DEPOSIT_RECEIVED" || rule === "SIGNED_CONTRACT_AND_DEPOSIT") {
    if (!input.deposit?.exists) missing.push("A deposit in the active payment schedule");
    else if (!input.deposit.paid) missing.push("The deposit paid in full");
  }
  if (rule === "MANUAL_APPROVAL" && input.approval?.status !== "APPROVED") missing.push(input.approval?.status === "PENDING" ? "An approved sale (waiting for a decision)" : "An approved sale");
  return { allowed: missing.length === 0, missing, rule };
}

/** A reservation's default end: this many days from now (§24). */
export function defaultExpiry(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/** Money for display and audit: two decimals, never a float in storage. */
export function moneyText(value: { toFixed(digits: number): string } | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed(2);
}
