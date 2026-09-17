import type { UnitPublicationStatusKey } from "@/lib/modules/project-structure/structure.types";
import { PRICE_BASIS_AREA, type SoldCheck, type UnitCommercialStatus, type UnitPriceBasis } from "./unit-sales.types";

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
 * The one place that decides whether a unit may be marked Sold (§29, §42). E-05E
 * asks for an active reservation with a client, a deal and an agreed price;
 * E-05F adds the company's Sold rule here — a signed contract, a deposit — without
 * any screen changing.
 */
export function canMarkUnitSold(input: {
  status: UnitCommercialStatus;
  reservation: { status: string; clientId: string | null; opportunityId: string | null; agreedPrice: string | null; expiresAt?: Date | string } | null;
  now?: Date;
}): SoldCheck {
  const missing: string[] = [];
  if (input.status !== "RESERVED") missing.push("A reserved unit");
  const reservation = input.reservation?.status === "ACTIVE" ? input.reservation : null;
  if (!reservation) missing.push("An active reservation");
  // Past its expiry, a reservation is over even before the expiry job has closed it (§24, §25): extend it first.
  if (reservation?.expiresAt !== undefined && new Date(reservation.expiresAt).getTime() <= (input.now ?? new Date()).getTime()) missing.push("A reservation that has not expired");
  if (reservation && !reservation.clientId) missing.push("A client");
  if (reservation && !reservation.opportunityId) missing.push("A deal");
  if (reservation && reservation.agreedPrice === null) missing.push("An agreed price");
  return { allowed: missing.length === 0, missing };
}

/** A reservation's default end: this many days from now (§24). */
export function defaultExpiry(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/** Money for display and audit: two decimals, never a float in storage. */
export function moneyText(value: { toFixed(digits: number): string } | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed(2);
}
