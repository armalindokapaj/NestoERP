import type { UnitTypeCategory } from "@/config/unit-types";

import { expectsCount } from "./structure.rules";
import type { UnitCommercialStatusKey } from "./structure.types";

/**
 * The unit side panel (2026-11-09): a row of the Units or the Sales list opens
 * the unit on the right, over the list, to change its details, its price and
 * its sale status without leaving the list. Client-safe and pure, so these
 * rules are tested without a browser.
 */

/** The query parameter that names the open unit: a link opens the panel, and Back closes it. */
export const PANEL_PARAM = "unit";

/** The address with the panel open on a unit, or closed (`null`); the list's own filters stay. */
export function withOpenUnit(href: string, unitId: string | null): string {
  const url = new URL(href);
  if (unitId) url.searchParams.set(PANEL_PARAM, unitId);
  else url.searchParams.delete(PANEL_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The unit an address opens, if any. */
export function openUnitOf(search: string): string | null {
  return new URLSearchParams(search).get(PANEL_PARAM) || null;
}

/**
 * Where the open unit stands in the list as it is shown — its filters, sort
 * and page — and the units before and after it. A unit not on the page (a
 * link to another one) has neither.
 */
export function neighbours(ids: readonly string[], id: string | null): { index: number; total: number; previous: string | null; next: string | null } {
  const index = id === null ? -1 : ids.indexOf(id);
  if (index < 0) return { index: -1, total: ids.length, previous: null, next: null };
  return { index, total: ids.length, previous: index > 0 ? ids[index - 1]! : null, next: index < ids.length - 1 ? ids[index + 1]! : null };
}

/**
 * The previous or next unit from a key press, or null for any other key:
 * Alt+↑ and Alt+↓, anywhere in the panel except a select or a text box,
 * where the arrows have their own work.
 */
export function stepFromKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, target: { tagName: string } | null): -1 | 1 | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const tag = target?.tagName.toUpperCase() ?? "";
  if (tag === "SELECT" || tag === "TEXTAREA") return null;
  if (event.key === "ArrowUp") return -1;
  if (event.key === "ArrowDown") return 1;
  return null;
}

/** The empty cells that offer a faint "Add": bedrooms, the gross area (Units), the sale area (Sales), the total price. */
export const PANEL_FIELDS = ["bedrooms", "gross", "area", "price"] as const;
export type PanelField = (typeof PANEL_FIELDS)[number];

export type PanelRowFacts = {
  category: UnitTypeCategory;
  bedrooms: number | null;
  grossArea: string | null;
  saleArea: string | null;
  askingPrice: string | null;
  status: UnitCommercialStatusKey;
  archived: boolean;
};

/**
 * Whether an empty cell offers "Add", which opens the panel on that field —
 * the same gaps as the "missing" line above the Units list (2026-11-09): an
 * area on anything but parking, which is priced per space; bedrooms on a type
 * that has them; a price on a unit not sold. An archived unit is out of use
 * and offers nothing, and only to somebody who may make the change.
 */
export function offersAdd(row: PanelRowFacts, field: PanelField, can: { details: boolean; price: boolean }): boolean {
  if (row.archived) return false;
  switch (field) {
    case "bedrooms":
      return can.details && row.bedrooms === null && expectsCount(row.category, "bedrooms");
    case "gross":
      return can.details && row.grossArea === null && row.category !== "PARKING";
    case "area":
      return can.details && row.saleArea === null && row.category !== "PARKING";
    case "price":
      return can.price && row.askingPrice === null && row.status !== "SOLD";
  }
}

/**
 * The field the panel puts the cursor in for an "Add": the bedrooms count;
 * the internal area, which the gross area is worked out from; the saleable
 * area, the one a unit is sold by when typed; the price.
 */
export function focusTarget(field: PanelField): "bedrooms" | "internalArea" | "saleableArea" | "price" {
  switch (field) {
    case "bedrooms":
      return "bedrooms";
    case "gross":
      return "internalArea";
    case "area":
      return "saleableArea";
    case "price":
      return "price";
  }
}

/** Whether a click is a plain left click: one that opens the panel, where a modified or middle click opens the full page. */
export function isPlainClick(event: { button: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; defaultPrevented?: boolean }): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}
