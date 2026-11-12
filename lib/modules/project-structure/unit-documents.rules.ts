import type { UnitDocumentCategory } from "./unit-publishing.types";

import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";

/**
 * Who may attach a document to a unit, or take one off it, by its category.
 *
 * Whoever keeps the unit's documents (the architect's grant) files every
 * category. Whoever sells the unit files the buyer's signed contract — category
 * Contract — and only that (/sales/units, 2026-11-12): the plans and every
 * other document stay the architect's. Pure, so it is unit-tested on its own.
 */
export function mayManageUnitDocument(context: UserContext, category: UnitDocumentCategory): boolean {
  if (can(context, "project.unit.documents.manage")) return true;
  return category === "CONTRACT" && can(context, "project.unit.sale_contract.manage");
}
