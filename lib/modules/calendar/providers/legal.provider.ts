import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { buildAmendmentScopeWhere, buildContractScopeWhere, buildObligationScopeWhere } from "@/lib/modules/contracts/contract.scope";
import type { CalendarEventDTO, CalendarProvider } from "../calendar.types";
import { compact, dateWindow, isPastDue, moduleOpen, onBusinessDate, projectRef, PROJECT_SELECT, SOURCE_LIMIT } from "./provider.helpers";

/**
 * Contract dates (PRD #39 §57): start, expiry and termination, obligation due
 * dates and amendment effective dates — each through Legal's own scope.
 */
const LIVE = ["APPROVED", "SENT", "SIGNED", "ACTIVE"] as const;

export const legalProvider: CalendarProvider = {
  key: "legal",
  moduleKey: "contracts",
  categories: ["LEGAL"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => moduleOpen(context, "contracts", "legal.contract.view"),
  async getEvents(input) {
    const { context, filters } = input;
    const window = dateWindow(input);
    const projects = filters.projectIds?.length ? { projectId: { in: filters.projectIds } } : {};
    const events: Array<CalendarEventDTO | null> = [];

    const contracts = await prisma.contract.findMany({
      where: {
        AND: [
          buildContractScopeWhere(context),
          { archivedAt: null, status: { in: [...LIVE] } },
          { OR: [{ effectiveDate: window }, { expiryDate: window }, { terminationDate: window }] },
          projects,
          filters.myOnly ? { ownerMemberId: context.membershipId } : {},
        ],
      },
      take: SOURCE_LIMIT,
      select: { id: true, contractNumber: true, title: true, status: true, effectiveDate: true, expiryDate: true, terminationDate: true, project: PROJECT_SELECT },
    });
    for (const row of contracts) {
      const base = { sourceType: "contract", sourceId: row.id, providerKey: "legal", category: "LEGAL" as const, project: projectRef(row.project), href: `/contracts/${row.id}`, metadata: { sourceLabel: "Contract", moduleKey: "contracts" } };
      if (row.effectiveDate) events.push(onBusinessDate(input, row.effectiveDate, { ...base, id: `legal:start:${row.id}`, title: `${row.contractNumber} starts`, subtitle: row.title, status: row.status }));
      if (row.expiryDate) events.push(onBusinessDate(input, row.expiryDate, { ...base, id: `legal:expiry:${row.id}`, title: `${row.contractNumber} expires`, subtitle: row.title, status: "EXPIRING", severity: isPastDue(row.expiryDate, input) ? "warning" : undefined }));
      if (row.terminationDate) events.push(onBusinessDate(input, row.terminationDate, { ...base, id: `legal:termination:${row.id}`, title: `${row.contractNumber} terminates`, subtitle: row.title, status: row.status }));
    }

    if (can(context, "legal.obligation.view")) {
      const obligations = await prisma.contractObligation.findMany({
        where: {
          AND: [
            buildObligationScopeWhere(context),
            { status: "OPEN", dueDate: window, contract: { archivedAt: null } },
            filters.projectIds?.length ? { contract: { projectId: { in: filters.projectIds } } } : {},
            filters.myOnly ? { responsibleMemberId: context.membershipId } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, title: true, dueDate: true, contract: { select: { id: true, contractNumber: true, project: PROJECT_SELECT } } },
      });
      for (const row of obligations) {
        const overdue = isPastDue(row.dueDate!, input);
        events.push(
          onBusinessDate(input, row.dueDate!, {
            id: `legal:obligation:${row.id}`,
            sourceType: "obligation",
            sourceId: row.id,
            providerKey: "legal",
            title: `Obligation due: ${row.title}`,
            subtitle: row.contract.contractNumber,
            category: "LEGAL",
            status: overdue ? "OVERDUE" : "OPEN",
            severity: overdue ? "warning" : undefined,
            project: projectRef(row.contract.project),
            href: `/contracts/${row.contract.id}/obligations`,
            metadata: { sourceLabel: "Obligation", moduleKey: "contracts" },
          }),
        );
      }
    }

    if (can(context, "legal.amendment.view") && !filters.myOnly) {
      const amendments = await prisma.contractAmendment.findMany({
        where: {
          AND: [
            buildAmendmentScopeWhere(context),
            { effectiveDate: window, contract: { archivedAt: null } },
            filters.projectIds?.length ? { contract: { projectId: { in: filters.projectIds } } } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, amendmentNumber: true, title: true, status: true, effectiveDate: true, contract: { select: { id: true, contractNumber: true, project: PROJECT_SELECT } } },
      });
      for (const row of amendments) {
        events.push(
          onBusinessDate(input, row.effectiveDate!, {
            id: `legal:amendment:${row.id}`,
            sourceType: "amendment",
            sourceId: row.id,
            providerKey: "legal",
            title: `${row.amendmentNumber} takes effect`,
            subtitle: `${row.contract.contractNumber} · ${row.title}`,
            category: "LEGAL",
            status: row.status,
            project: projectRef(row.contract.project),
            href: `/contracts/${row.contract.id}/amendments/${row.id}`,
            metadata: { sourceLabel: "Amendment", moduleKey: "contracts" },
          }),
        );
      }
    }

    return compact(events);
  },
};
