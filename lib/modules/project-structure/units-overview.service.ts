import type { Prisma, UnitCommercialStatus } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { saleArea } from "@/lib/modules/sales/units/unit-pricing.rules";
import { salesCapabilities } from "@/lib/modules/sales/units/unit-sales.core";
import { moneyText, saleStatusOf } from "@/lib/modules/sales/units/unit-sales.rules";
import type { UnitSaleStatus } from "@/lib/modules/sales/units/unit-sales.types";
import { unitLabel } from "./structure.rules";
import { readableUnitWhere, structureOpen } from "./structure.permissions";

/**
 * Units, across the projects (docs/ui/UI-04-navigation-layouts.md): every unit
 * the reader may see, in every project they may open, one click from the top
 * bar for every role — the architect's and the engineer's as much as sales'.
 *
 * The door is the projects' own (`readableUnitWhere`): a unit is listed only
 * where its project's structure opens to this reader. What a unit sells for —
 * its status, price and buyer — is shown only to a reader who may see the
 * units' sales, and the status views (For sale, Reserved, Sold) are theirs
 * alone. The buyer is named only to a reader who may open clients. Archived
 * units are left out.
 */

/** The status views, by their path: /projects/units/for-sale and so on. */
export const UNIT_STATUS_VIEWS = { "for-sale": "FOR_SALE", reserved: "RESERVED", sold: "SOLD" } as const satisfies Record<string, UnitCommercialStatus>;
export type UnitStatusView = keyof typeof UNIT_STATUS_VIEWS;

export const UNITS_PAGE_SIZE = 50;

export type UnitsOverviewRow = {
  id: string;
  projectId: string;
  project: string;
  label: string;
  building: string;
  floor: string;
  unitType: string;
  area: string | null;
  bedrooms: number | null;
  /** Null for a reader who may not see the units' sales. */
  saleStatus: UnitSaleStatus | null;
  askingPrice: string | null;
  currency: string | null;
  client: string | null;
};

export type UnitsOverview = {
  rows: UnitsOverviewRow[];
  total: number;
  page: number;
  /** How many units each view holds, under the same search; null without the sales view. */
  counts: Record<"all" | UnitStatusView, number> | null;
  canSeeSales: boolean;
};

export async function listUnitsOverview(context: UserContext, input: { view: UnitStatusView | null; q?: string; page: number }): Promise<UnitsOverview> {
  if (!structureOpen(context)) throw new AccessError("FORBIDDEN", "You cannot open project structures.");
  const sales = salesCapabilities(context);
  if (input.view && !sales.canView) throw new AccessError("FORBIDDEN", "You cannot see the units' sales.");

  const q = input.q?.trim();
  const base: Prisma.ProjectUnitWhereInput = {
    AND: [
      readableUnitWhere(context),
      { publicationStatus: { not: "ARCHIVED" } },
      q
        ? {
            OR: [
              { unitCode: { contains: q, mode: "insensitive" } },
              { project: { is: { name: { contains: q, mode: "insensitive" } } } },
              { unitType: { is: { name: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {},
    ],
  };
  const inView = (view: UnitStatusView | null): Prisma.ProjectUnitWhereInput =>
    view ? { AND: [base, { commercialProfile: { is: { status: UNIT_STATUS_VIEWS[view] } } }] } : base;

  const where = inView(input.view);
  const views = Object.keys(UNIT_STATUS_VIEWS) as UnitStatusView[];
  const [total, rows, counts] = await Promise.all([
    prisma.projectUnit.count({ where }),
    prisma.projectUnit.findMany({
      where,
      orderBy: [{ project: { name: "asc" } }, { floor: { building: { sortOrder: "asc" } } }, { floor: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      skip: (input.page - 1) * UNITS_PAGE_SIZE,
      take: UNITS_PAGE_SIZE,
      select: {
        id: true,
        projectId: true,
        unitCode: true,
        saleableArea: true,
        grossArea: true,
        bedrooms: true,
        project: { select: { name: true } },
        unitType: { select: { name: true } },
        floor: { select: { name: true, building: { select: { name: true, code: true } } } },
        // Read for everyone, shown only to whom it may be (below).
        commercialProfile: { select: { status: true, askingPrice: true, currency: true } },
        reservations: { where: { status: "ACTIVE" }, take: 1, select: { client: { select: { name: true } } } },
      },
    }),
    sales.canView ? Promise.all([prisma.projectUnit.count({ where: base }), ...views.map((view) => prisma.projectUnit.count({ where: inView(view) }))]) : null,
  ]);

  return {
    rows: rows.map((row) => {
      const profile = sales.canView ? row.commercialProfile : null;
      const asking = moneyText(profile?.askingPrice);
      return {
        id: row.id,
        projectId: row.projectId,
        project: row.project.name,
        label: unitLabel(row.floor.building.code, row.unitCode),
        building: row.floor.building.name,
        floor: row.floor.name,
        unitType: row.unitType.name,
        area: saleArea({ saleableArea: moneyText(row.saleableArea), grossArea: moneyText(row.grossArea) }).area,
        bedrooms: row.bedrooms,
        saleStatus: sales.canView ? saleStatusOf(profile?.status, asking) : null,
        askingPrice: sales.canView ? asking : null,
        currency: sales.canView ? (profile?.currency ?? null) : null,
        client: sales.canView && sales.canSeeClients ? (row.reservations[0]?.client.name ?? null) : null,
      };
    }),
    total,
    page: input.page,
    counts: counts ? { all: counts[0]!, ...Object.fromEntries(views.map((view, index) => [view, counts[index + 1]!])) } as UnitsOverview["counts"] : null,
    canSeeSales: sales.canView,
  };
}
