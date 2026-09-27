import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { buildOrderScopeWhere, buildRequestScopeWhere, buildRfqScopeWhere } from "@/lib/modules/procurement/procurement.scope";
import type { CalendarEventDTO, CalendarProvider } from "../calendar.types";
import { compact, dateWindow, isPastDue, moduleOpen, onBusinessDate, projectFilter, projectRef, PROJECT_SELECT, SOURCE_LIMIT, sourceRows } from "./provider.helpers";

/**
 * Buying dates (PRD #39 §58): when a request's goods are needed, when an RFQ's
 * responses are due, and when an order's delivery is expected — each through
 * Procurement's own scope.
 */
export const procurementProvider: CalendarProvider = {
  key: "procurement",
  moduleKey: "procurement",
  categories: ["PROCUREMENT"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) =>
    moduleOpen(context, "procurement", "procurement.request.view") ||
    moduleOpen(context, "procurement", "procurement.order.view") ||
    moduleOpen(context, "procurement", "procurement.rfq.view"),
  async getEvents(input) {
    const { context, filters } = input;
    const window = dateWindow(input);
    const events: Array<CalendarEventDTO | null> = [];

    if (can(context, "procurement.request.view")) {
      const rows = await sourceRows(input, prisma.purchaseRequest.findMany({
        where: {
          AND: [
            buildRequestScopeWhere(context),
            { archivedAt: null, requiredDate: window, status: { in: ["PENDING_APPROVAL", "APPROVED", "IN_SOURCING", "PARTIALLY_ORDERED"] } },
            projectFilter(input),
            filters.myOnly ? { OR: [{ requestedByMemberId: context.membershipId }, { ownerMemberId: context.membershipId }] } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, requestNumber: true, title: true, status: true, requiredDate: true, project: PROJECT_SELECT },
      }));
      for (const row of rows) {
        events.push(
          onBusinessDate(input, row.requiredDate!, {
            id: `procurement:request:${row.id}`,
            sourceType: "purchase_request",
            sourceId: row.id,
            providerKey: "procurement",
            title: `${row.requestNumber} needed`,
            subtitle: row.title,
            category: "PROCUREMENT",
            status: row.status,
            severity: isPastDue(row.requiredDate!, input) ? "warning" : undefined,
            project: projectRef(row.project),
            href: `/procurement/requests/${row.id}`,
            metadata: { sourceLabel: "Purchase request", moduleKey: "procurement" },
          }),
        );
      }
    }

    if (can(context, "procurement.rfq.view") && !filters.myOnly) {
      const rows = await sourceRows(input, prisma.rFQ.findMany({
        where: { AND: [buildRfqScopeWhere(context), { status: "ISSUED", responseDueDate: window }, projectFilter(input)] },
        take: SOURCE_LIMIT,
        select: { id: true, rfqNumber: true, title: true, status: true, responseDueDate: true, project: PROJECT_SELECT },
      }));
      for (const row of rows) {
        events.push(
          onBusinessDate(input, row.responseDueDate!, {
            id: `procurement:rfq:${row.id}`,
            sourceType: "rfq",
            sourceId: row.id,
            providerKey: "procurement",
            title: `${row.rfqNumber} responses due`,
            subtitle: row.title,
            category: "PROCUREMENT",
            status: row.status,
            project: projectRef(row.project),
            href: `/procurement/rfqs/${row.id}`,
            metadata: { sourceLabel: "RFQ", moduleKey: "procurement" },
          }),
        );
      }
    }

    if (can(context, "procurement.order.view")) {
      const rows = await sourceRows(input, prisma.purchaseOrder.findMany({
        where: {
          AND: [
            buildOrderScopeWhere(context),
            { archivedAt: null, requiredDate: window, status: { in: ["APPROVED", "ISSUED", "PARTIALLY_RECEIVED"] } },
            projectFilter(input),
            filters.myOnly ? { createdByMemberId: context.membershipId } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, poNumber: true, status: true, requiredDate: true, supplier: { select: { name: true } }, project: PROJECT_SELECT },
      }));
      for (const row of rows) {
        events.push(
          onBusinessDate(input, row.requiredDate!, {
            id: `procurement:order:${row.id}`,
            sourceType: "purchase_order",
            sourceId: row.id,
            providerKey: "procurement",
            title: `Delivery expected: ${row.poNumber}`,
            subtitle: row.supplier?.name,
            category: "PROCUREMENT",
            status: row.status,
            severity: isPastDue(row.requiredDate!, input) ? "warning" : undefined,
            project: projectRef(row.project),
            href: `/procurement/orders/${row.id}`,
            metadata: { sourceLabel: "Purchase order", moduleKey: "procurement" },
          }),
        );
      }
    }

    return compact(events);
  },
};
