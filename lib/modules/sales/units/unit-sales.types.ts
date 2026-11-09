import type { AreaField } from "@/lib/modules/project-structure/structure.types";

/**
 * Selling a unit (E-05E). Client-safe: constants, labels and the shapes the API
 * answers with. Money is always a two-decimal string, never a float (§10).
 */

export const UNIT_COMMERCIAL_STATUSES = ["NOT_FOR_SALE", "FOR_SALE", "ON_HOLD", "RESERVED", "SOLD"] as const;
export type UnitCommercialStatus = (typeof UNIT_COMMERCIAL_STATUSES)[number];

export const UNIT_COMMERCIAL_STATUS_LABELS: Record<UnitCommercialStatus, string> = {
  NOT_FOR_SALE: "Not For Sale",
  FOR_SALE: "For Sale",
  ON_HOLD: "On Hold",
  RESERVED: "Reserved",
  SOLD: "Sold",
};

/**
 * How a unit's sale reads on screen (2026-11-09): its commercial status, except
 * that a unit nobody has priced and nobody put on sale — Not For Sale, or no
 * sales record yet — is Not Priced. Derived, never stored: "Not For Sale" is
 * kept for a unit someone priced but held back or took off sale.
 */
export const UNIT_SALE_STATUSES = ["FOR_SALE", "NOT_PRICED", "ON_HOLD", "RESERVED", "SOLD", "NOT_FOR_SALE"] as const;
export type UnitSaleStatus = (typeof UNIT_SALE_STATUSES)[number];

export const UNIT_SALE_STATUS_LABELS: Record<UnitSaleStatus, string> = { ...UNIT_COMMERCIAL_STATUS_LABELS, NOT_PRICED: "Not Priced" };

export const UNIT_PRICE_BASES = ["SALEABLE_AREA", "INTERNAL_AREA", "GROSS_AREA", "FIXED_UNIT_PRICE"] as const;
export type UnitPriceBasis = (typeof UNIT_PRICE_BASES)[number];

export const UNIT_PRICE_BASIS_LABELS: Record<UnitPriceBasis, string> = {
  SALEABLE_AREA: "Per saleable area",
  INTERNAL_AREA: "Per internal area",
  GROSS_AREA: "Per gross area",
  FIXED_UNIT_PRICE: "Fixed price",
};

/** The area a price per m² divides by (§10); a fixed price has none. */
export const PRICE_BASIS_AREA: Record<UnitPriceBasis, AreaField | null> = {
  SALEABLE_AREA: "saleableArea",
  INTERNAL_AREA: "internalArea",
  GROSS_AREA: "grossArea",
  FIXED_UNIT_PRICE: null,
};

export const UNIT_RESERVATION_STATUSES = ["ACTIVE", "EXPIRED", "RELEASED", "CANCELLED", "CONVERTED_TO_SALE"] as const;
export type UnitReservationStatus = (typeof UNIT_RESERVATION_STATUSES)[number];

export const UNIT_RESERVATION_STATUS_LABELS: Record<UnitReservationStatus, string> = {
  ACTIVE: "Active",
  EXPIRED: "Expired",
  RELEASED: "Released",
  CANCELLED: "Cancelled",
  CONVERTED_TO_SALE: "Converted to sale",
};

export const COMMERCIAL_SOURCE_LABELS = { USER: "By a person", SYSTEM_EXPIRY: "Expired automatically", LEGAL: "Legal", FINANCE: "Finance", IMPORT: "Import" } as const;

/** What a unit needs before Sales may mark it Sold, per company (E-05F §42, §43). */
export const UNIT_SOLD_RULES = ["RESERVATION", "SIGNED_CONTRACT", "DEPOSIT_RECEIVED", "SIGNED_CONTRACT_AND_DEPOSIT", "MANUAL_APPROVAL"] as const;
export type UnitSoldRule = (typeof UNIT_SOLD_RULES)[number];

export const UNIT_SOLD_RULE_LABELS: Record<UnitSoldRule, string> = {
  RESERVATION: "Reservation",
  SIGNED_CONTRACT: "Signed contract",
  DEPOSIT_RECEIVED: "Deposit received",
  SIGNED_CONTRACT_AND_DEPOSIT: "Signed contract and deposit",
  MANUAL_APPROVAL: "Manual approval",
};

export const SALES_REASON_MAX = 1_000;
export const SALES_NOTES_MAX = 2_000;
export const DEFAULT_RESERVATION_DAYS = 7;
export const MAX_RESERVATION_DAYS = 365;

export type UnitSalesCapabilities = {
  canView: boolean;
  canManageStatus: boolean;
  canManagePrice: boolean;
  canReserve: boolean;
  canExtend: boolean;
  canRelease: boolean;
  canMarkSold: boolean;
  canReopen: boolean;
  canCorrect: boolean;
  /** Client and deal names are shown only to people who may open clients and deals (§32). */
  canSeeClients: boolean;
  canSeeDeals: boolean;
  canCreateClient: boolean;
  canCreateDeal: boolean;
  /** Deciding a sale under the Manual approval rule (E-05F §42). */
  canApproveSale: boolean;
};

export type PartyRef = { id: string; name: string } | null;

export type ReservationDTO = {
  id: string;
  status: UnitReservationStatus;
  client: PartyRef;
  deal: PartyRef;
  reservedAt: string;
  expiresAt: string;
  closedAt: string | null;
  closeReason: string | null;
  agreedPrice: string | null;
  currency: string | null;
  notes: string | null;
  salesperson: string | null;
  salespersonMemberId: string | null;
  version: number;
  extensions: Array<{ oldExpiresAt: string; newExpiresAt: string; reason: string; extendedBy: string | null; extendedByMemberId: string | null; extendedAt: string }>;
};

export type SoldCheck = { allowed: boolean; missing: string[]; rule: UnitSoldRule };

/** A sale approval under the Manual approval rule (E-05F §42), for the active reservation. */
export type SaleApprovalDTO = {
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "RETURNED";
  submittedBy: string | null;
  submittedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
};

export type UnitSalesDTO = {
  unitId: string;
  projectId: string;
  unitCode: string;
  /** How the unit is named to people: its building's code and its own, "T-501". */
  unitLabel: string;
  status: UnitCommercialStatus;
  statusChangedAt: string | null;
  askingPrice: string | null;
  currency: string | null;
  /** The basis the price was saved on; a new price is saved on the sale area's. */
  priceBasis: UnitPriceBasis;
  /** The asking price over the sale area, whatever basis it was saved on. */
  pricePerSqm: string | null;
  /** The area the unit is sold by — saleable, else gross — and which one it is; null without either. */
  saleArea: string | null;
  saleAreaBasis: UnitPriceBasis;
  saleableArea: string | null;
  grossArea: string | null;
  holdReason: string | null;
  holdUntil: string | null;
  heldBy: string | null;
  heldByMemberId: string | null;
  salesNotes: string | null;
  version: number;
  /** The status as shown: Not Priced for a unit with no price that is not for sale. */
  saleStatus: UnitSaleStatus;
  /** Whether the unit may be put on sale or reserved now (§6): active and Published. */
  sellable: boolean;
  sellableReason: string | null;
  activeReservation: ReservationDTO | null;
  reservations: ReservationDTO[];
  priceHistory: Array<{ id: string; oldPrice: string | null; newPrice: string | null; oldCurrency: string | null; currency: string | null; priceBasis: UnitPriceBasis; reason: string | null; changedBy: string | null; changedByMemberId: string | null; changedAt: string }>;
  statusHistory: Array<{ id: string; fromStatus: UnitCommercialStatus | null; toStatus: UnitCommercialStatus; reason: string | null; source: keyof typeof COMMERCIAL_SOURCE_LABELS; actor: string | null; actorMemberId: string | null; changedAt: string }>;
  deals: Array<{ id: string; name: string | null; agreedPrice: string | null; currency: string | null }>;
  soldCheck: SoldCheck;
  /** The latest sale approval of the active reservation, when the rule asks for one. */
  saleApproval: SaleApprovalDTO | null;
  canRequestSaleApproval: boolean;
  /** The unit's live contract, for readers of its legal side (E-05F §44). */
  contract: { id: string; number: string; status: string } | null;
  defaults: { reservationDays: number; currency: string };
  capabilities: UnitSalesCapabilities;
};

export type InventoryRowDTO = {
  id: string;
  unitCode: string;
  /** How the unit is named to people: its building's code and its own, "T-501". */
  label: string;
  unitType: string;
  building: string;
  floor: string;
  /** The area the unit is sold by: saleable when typed, otherwise gross (2026-11-09). */
  saleArea: string | null;
  saleAreaBasis: UnitPriceBasis;
  bedrooms: number | null;
  bathrooms: number | null;
  orientation: string | null;
  status: UnitCommercialStatus;
  /** The status as shown, with Not Priced. */
  saleStatus: UnitSaleStatus;
  publicationStatus: string;
  askingPrice: string | null;
  currency: string | null;
  pricePerSqm: string | null;
  client: PartyRef;
  deal: PartyRef;
  reservationExpiresAt: string | null;
};

export type InventoryDTO = {
  items: InventoryRowDTO[];
  page: number;
  pageSize: number;
  total: number;
  /** Units per status as shown, for the quick filters, under every other filter (§14). */
  counts: Record<UnitSaleStatus, number> & { ALL: number };
  canSeeClients: boolean;
  canSeeDeals: boolean;
};
