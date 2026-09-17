import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { readableUnitWhere } from "@/lib/modules/project-structure/structure.permissions";
import { approveUnitSale, rejectUnitSale } from "@/lib/modules/sales/units/unit-sale-approval.service";
import { createCycleProvider, type CycleTable, type RecordFacts } from "../approvals.cycle-provider";
import { amountWhere, formatAmount, formatDate, MATCH_LIMIT, moneyOf, projectRef, projectWhere, term, valueSignals } from "./shared";

/**
 * Unit sales in the Center (E-05F §42): where the company's Sold rule is Manual
 * approval, Sales asks for a reservation's sale to be approved before it is
 * marked Sold, and whoever holds `project.unit.sale.approve` decides. Approving
 * only unlocks Mark Sold; rejecting needs a reason. The agreed price is shown as
 * the amount, and the client only to readers who may open clients.
 */
export const unitSalesApprovalProvider = createCycleProvider({
  key: "unit_sales",
  moduleKey: "projects",
  label: "Unit sales",
  table: () => prisma.unitSaleApproval as unknown as CycleTable,
  records: {
    UNIT: {
      recordType: "project_unit",
      noun: "Unit sale",
      canView: (context) => can(context, "project.structure.view") && can(context, "project.unit.sales.view"),
      canApprove: (context) => can(context, "project.unit.sale.approve"),
      canReject: (context) => can(context, "project.unit.sale.approve"),
      selfPermission: null,
      reason: "This company approves a sale before the unit is marked Sold.",
      async match(context, filters) {
        const rows = await prisma.projectUnit.findMany({
          where: {
            AND: [
              readableUnitWhere(context),
              projectWhere(filters),
              filters.amountMin !== undefined || filters.amountMax !== undefined ? { reservations: { some: { status: "ACTIVE", ...amountWhere("agreedPrice", filters) } } } : {},
              filters.q ? { OR: [{ unitCode: term(filters.q) }, { name: term(filters.q) }, { project: { name: term(filters.q) } }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const seesClients = can(context, "client.view");
        const rows = await prisma.projectUnit.findMany({
          where: { AND: [readableUnitWhere(context), { id: { in: ids } }] },
          select: {
            id: true,
            unitCode: true,
            projectId: true,
            project: { select: { id: true, name: true, code: true } },
            unitType: { select: { name: true } },
            floor: { select: { name: true, building: { select: { name: true } } } },
            commercialProfile: { select: { askingPrice: true, currency: true } },
            reservations: { where: { status: "ACTIVE" }, take: 1, select: { agreedPrice: true, currency: true, expiresAt: true, client: { select: { name: true } }, opportunity: { select: { name: true } } } },
          },
        });
        return new Map(
          rows.map((row): [string, RecordFacts] => {
            const reservation = row.reservations[0] ?? null;
            return [
              row.id,
              {
                id: row.id,
                reference: row.unitCode,
                title: `${row.unitCode} — ${row.unitType.name}`,
                subtitle: `${row.floor.building.name} · ${row.floor.name}`,
                amount: reservation ? moneyOf(reservation.agreedPrice, reservation.currency) : null,
                ...(reservation ? valueSignals(reservation.agreedPrice) : {}),
                project: projectRef(row.project),
                href: `/projects/${row.projectId}/units/${row.id}/sales`,
                dueAt: reservation?.expiresAt ?? null,
                summary: [
                  { label: "Agreed price", value: reservation ? formatAmount(reservation.agreedPrice, reservation.currency) : "—", emphasis: "strong" as const },
                  { label: "Asking price", value: formatAmount(row.commercialProfile?.askingPrice, row.commercialProfile?.currency) },
                  ...(seesClients && reservation ? [{ label: "Client", value: reservation.client.name }] : []),
                  { label: "Reserved until", value: formatDate(reservation?.expiresAt) },
                ],
                description: null,
                warnings: reservation ? [] : [{ code: "RESERVATION_ENDED", message: "The reservation has ended; this request can no longer be approved.", severity: "WARNING" }],
              },
            ];
          }),
        );
      },
      approve: (context, id, note, guard) => approveUnitSale(context, id, note, guard),
      reject: (context, id, note, guard) => rejectUnitSale(context, id, note, guard),
    },
  },
});
