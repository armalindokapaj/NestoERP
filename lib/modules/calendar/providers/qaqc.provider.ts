import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { buildCorrectiveActionScopeWhere, buildInspectionScopeWhere, buildNcrScopeWhere } from "@/lib/modules/qaqc/qaqc.scope";
import type { CalendarEventDTO, CalendarProvider } from "../calendar.types";
import { compact, dateWindow, isPastDue, moduleOpen, onBusinessDate, projectFilter, projectRef, PROJECT_SELECT, SOURCE_LIMIT, sourceRows } from "./provider.helpers";

/** Quality dates (PRD #39 §59): planned inspections and reinspections, corrective-action and NCR due dates. */
export const qaqcProvider: CalendarProvider = {
  key: "qaqc",
  moduleKey: "qaqc",
  categories: ["QA_QC"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) =>
    moduleOpen(context, "qaqc", "qaqc.inspection.view") ||
    moduleOpen(context, "qaqc", "qaqc.corrective_action.view") ||
    moduleOpen(context, "qaqc", "qaqc.ncr.view"),
  async getEvents(input) {
    const { context, filters } = input;
    const window = dateWindow(input);
    const events: Array<CalendarEventDTO | null> = [];

    if (can(context, "qaqc.inspection.view")) {
      const rows = await sourceRows(input, prisma.qualityInspection.findMany({
        where: {
          AND: [
            buildInspectionScopeWhere(context),
            { inspectionDate: window, status: { in: ["DRAFT", "IN_PROGRESS", "PENDING_APPROVAL"] } },
            projectFilter(input),
            filters.myOnly ? { assignedInspectorMemberId: context.membershipId } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, inspectionNumber: true, inspectionType: true, status: true, inspectionDate: true, parentInspectionId: true, project: PROJECT_SELECT },
      }));
      for (const row of rows) {
        events.push(
          onBusinessDate(input, row.inspectionDate!, {
            id: `qaqc:inspection:${row.id}`,
            sourceType: "quality_inspection",
            sourceId: row.id,
            providerKey: "qaqc",
            title: `${row.parentInspectionId ? "Reinspection" : "Inspection"} ${row.inspectionNumber}`,
            subtitle: String(row.inspectionType).replaceAll("_", " ").toLowerCase(),
            category: "QA_QC",
            status: row.status,
            project: projectRef(row.project),
            href: `/qaqc/inspections/${row.id}`,
            metadata: { sourceLabel: "Inspection", moduleKey: "qaqc" },
          }),
        );
      }
    }

    if (can(context, "qaqc.corrective_action.view")) {
      const rows = await sourceRows(input, prisma.correctiveAction.findMany({
        where: {
          AND: [
            buildCorrectiveActionScopeWhere(context),
            { dueDate: window, status: { in: ["OPEN", "IN_PROGRESS", "REJECTED", "REOPENED", "PENDING_VERIFICATION"] } },
            projectFilter(input),
            filters.myOnly ? { assignedToMemberId: context.membershipId } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, actionNumber: true, title: true, status: true, dueDate: true, project: PROJECT_SELECT },
      }));
      for (const row of rows) {
        const overdue = row.status !== "PENDING_VERIFICATION" && isPastDue(row.dueDate!, input);
        events.push(
          onBusinessDate(input, row.dueDate!, {
            id: `qaqc:action:${row.id}`,
            sourceType: "corrective_action",
            sourceId: row.id,
            providerKey: "qaqc",
            title: `${row.actionNumber} due`,
            subtitle: row.title,
            category: "QA_QC",
            status: overdue ? "OVERDUE" : row.status,
            severity: overdue ? "warning" : undefined,
            project: projectRef(row.project),
            href: `/qaqc/corrective-actions/${row.id}`,
            metadata: { sourceLabel: "Corrective action", moduleKey: "qaqc" },
          }),
        );
      }
    }

    if (can(context, "qaqc.ncr.view")) {
      const rows = await sourceRows(input, prisma.nonConformanceReport.findMany({
        where: {
          AND: [
            buildNcrScopeWhere(context),
            { dueDate: window, status: { in: ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "PENDING_APPROVAL", "APPROVED_FOR_CLOSE", "REOPENED"] } },
            projectFilter(input),
            filters.myOnly ? { OR: [{ assignedToMemberId: context.membershipId }, { ownerMemberId: context.membershipId }] } : {},
          ],
        },
        take: SOURCE_LIMIT,
        select: { id: true, ncrNumber: true, title: true, status: true, severity: true, dueDate: true, project: PROJECT_SELECT },
      }));
      for (const row of rows) {
        const overdue = isPastDue(row.dueDate!, input);
        events.push(
          onBusinessDate(input, row.dueDate!, {
            id: `qaqc:ncr:${row.id}`,
            sourceType: "non_conformance_report",
            sourceId: row.id,
            providerKey: "qaqc",
            title: `${row.ncrNumber} due`,
            subtitle: row.title,
            category: "QA_QC",
            status: overdue ? "OVERDUE" : row.status,
            priority: row.severity === "CRITICAL" ? "CRITICAL" : row.severity === "HIGH" ? "HIGH" : "NORMAL",
            severity: row.severity === "CRITICAL" ? "critical" : overdue ? "warning" : undefined,
            project: projectRef(row.project),
            href: `/qaqc/ncrs/${row.id}`,
            metadata: { sourceLabel: "NCR", moduleKey: "qaqc" },
          }),
        );
      }
    }

    return compact(events);
  },
};
