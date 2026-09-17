import type { Prisma } from "@prisma/client";

import { can, getModuleScope } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";

/**
 * Inventory scope (PRD #20 §16, §243–§249, §300).
 *
 * Stock is scoped by **where it is**, not by who touched it. A site storeman
 * sees the warehouses on jobs they can open plus the central stores they draw
 * from; a company-scope reader sees everything.
 *
 * The central warehouse is deliberately visible to project-scope users: a site
 * cannot order a transfer from a store it cannot see, and hiding it would make
 * the module unusable for the people who actually move material (PRD #20 §246).
 */

export type InventoryScopeKind = "SELF" | "DEPARTMENT" | "PROJECT" | "COMPANY";

export function inventoryScopeKind(context: UserContext): InventoryScopeKind {
  const scope = getModuleScope(context, "inventory");
  if (scope === "COMPANY" || scope === "GROUP" || scope === "SYSTEM") return "COMPANY";
  if (scope === "DEPARTMENT") return "DEPARTMENT";
  if (scope === "PROJECT") return "PROJECT";
  return "SELF";
}

export function hasCompanyInventoryScope(context: UserContext): boolean {
  return inventoryScopeKind(context) === "COMPANY";
}

/**
 * Warehouses this reader may see (PRD #20 §246, §300).
 *
 * A project warehouse belongs to its project's scope. A warehouse with no
 * project — central stores, the office — is shared infrastructure and visible
 * to anybody with inventory access.
 */
export function buildWarehouseScopeWhere(context: UserContext): Prisma.WarehouseWhereInput {
  const kind = inventoryScopeKind(context);
  const base: Prisma.WarehouseWhereInput = { companyId: context.companyId };

  if (kind === "COMPANY" || kind === "DEPARTMENT") return base;

  return {
    ...base,
    OR: [
      { projectId: null },
      { projectId: { not: null }, project: buildProjectScopeWhere(context) },
    ],
  };
}

/** Items are a company-wide catalogue; what is scoped is the stock (PRD #20 §20). */
export function buildItemScopeWhere(context: UserContext): Prisma.InventoryItemWhereInput {
  return { companyId: context.companyId };
}

export function buildLocationScopeWhere(
  context: UserContext,
): Prisma.InventoryLocationWhereInput {
  return { warehouse: { is: buildWarehouseScopeWhere(context) } };
}

export function buildBalanceScopeWhere(context: UserContext): Prisma.InventoryBalanceWhereInput {
  return { warehouse: { is: buildWarehouseScopeWhere(context) } };
}

export function buildMovementScopeWhere(context: UserContext): Prisma.StockMovementWhereInput {
  return { warehouse: { is: buildWarehouseScopeWhere(context) } };
}

export function buildReceiptScopeWhere(context: UserContext): Prisma.InventoryReceiptWhereInput {
  return { warehouse: { is: buildWarehouseScopeWhere(context) } };
}

/**
 * An issue is reachable through the warehouse it came out of, or the project it
 * went to — a project manager cares about what landed on their site even when
 * it left a store they do not otherwise watch (PRD #20 §245).
 */
export function buildIssueScopeWhere(context: UserContext): Prisma.StockIssueWhereInput {
  const kind = inventoryScopeKind(context);
  if (kind === "COMPANY" || kind === "DEPARTMENT") return { companyId: context.companyId };

  return {
    companyId: context.companyId,
    OR: [
      { warehouse: { is: buildWarehouseScopeWhere(context) } },
      { projectId: { not: null }, project: buildProjectScopeWhere(context) },
    ],
  };
}

export function buildReturnScopeWhere(context: UserContext): Prisma.StockReturnWhereInput {
  const kind = inventoryScopeKind(context);
  if (kind === "COMPANY" || kind === "DEPARTMENT") return { companyId: context.companyId };

  return {
    companyId: context.companyId,
    OR: [
      { warehouse: { is: buildWarehouseScopeWhere(context) } },
      { project: buildProjectScopeWhere(context) },
    ],
  };
}

/** A transfer is reachable from either end (PRD #20 §134). */
export function buildTransferScopeWhere(context: UserContext): Prisma.StockTransferWhereInput {
  const kind = inventoryScopeKind(context);
  if (kind === "COMPANY" || kind === "DEPARTMENT") return { companyId: context.companyId };

  const warehouses = buildWarehouseScopeWhere(context);
  return {
    companyId: context.companyId,
    OR: [{ fromWarehouse: { is: warehouses } }, { toWarehouse: { is: warehouses } }],
  };
}

export function buildAdjustmentScopeWhere(
  context: UserContext,
): Prisma.StockAdjustmentWhereInput {
  return { warehouse: { is: buildWarehouseScopeWhere(context) } };
}

export function buildReservationScopeWhere(
  context: UserContext,
): Prisma.StockReservationWhereInput {
  return { warehouse: { is: buildWarehouseScopeWhere(context) } };
}

/**
 * Projects stock may be issued to, returned from or reserved for
 * (PRD #20 §109, §244, §245).
 *
 * A company-scope inventory user reaches every live project in the company,
 * because that is their job: a storeman issues cement to whichever site asked
 * for it, and they are not a member of any of those projects. Deferring to the
 * Projects module scope here would leave them unable to name a project at all,
 * which is most of what the module is for.
 *
 * Everybody else falls back to the projects they actually reach, so a project
 * user still cannot issue material to a job that is not theirs (§245).
 */
export function buildInventoryProjectWhere(context: UserContext): Prisma.ProjectWhereInput {
  const live: Prisma.ProjectWhereInput = { archivedAt: null, status: { not: "ARCHIVED" } };

  if (hasCompanyInventoryScope(context)) {
    return { AND: [{ companyId: context.companyId }, live] };
  }

  return { AND: [buildProjectScopeWhere(context), live] };
}

export function canSeeStockFigures(context: UserContext): boolean {
  return can(context, "inventory.balance.view");
}
