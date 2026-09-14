import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import * as qualityApprovals from "@/lib/modules/qaqc/approvals/approval.service";
import { approveInspection, rejectInspection } from "@/lib/modules/qaqc/inspections/inspection.service";
import { approveNcr, rejectNcr } from "@/lib/modules/qaqc/ncrs/ncr.service";
import { buildInspectionScopeWhere, buildNcrScopeWhere } from "@/lib/modules/qaqc/qaqc.scope";
import type { ApprovalPriority } from "../approvals.types";
import { createCycleProvider, type CycleTable, type RecordFacts } from "../approvals.cycle-provider";
import { excludesAmountFilter, formatDate, labelOf, MATCH_LIMIT, projectRef, projectWhere, term } from "./shared";

/**
 * QA/QC approvals in the Center (PRD #41 §72, §148, §298).
 *
 * Only what QA/QC itself puts up for approval — a submitted inspection and a
 * non-conformance report — each with its own approval row. Verifying a
 * corrective action stays QA/QC's own work and never enters the Center.
 */

const SEVERITY_PRIORITY: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", ApprovalPriority> = { LOW: "LOW", MEDIUM: "NORMAL", HIGH: "HIGH", CRITICAL: "CRITICAL" };

export const qaqcApprovalProvider = createCycleProvider({
  key: "qaqc",
  moduleKey: "qaqc",
  label: "QA/QC",
  table: () => prisma.qualityApproval as unknown as CycleTable,
  records: {
    INSPECTION: {
      recordType: "quality_inspection",
      noun: "Quality inspection",
      canView: (context) => can(context, "qaqc.approval.view") && can(context, "qaqc.inspection.view"),
      canApprove: (context) => qualityApprovals.canApproveType(context, "INSPECTION"),
      canReject: (context) => qualityApprovals.canRejectType(context, "INSPECTION"),
      selfPermission: "qaqc.approval.self",
      reason: "A submitted inspection is approved before its result counts.",
      async match(context, filters) {
        if (excludesAmountFilter(filters)) return [];
        const rows = await prisma.qualityInspection.findMany({
          where: {
            AND: [
              buildInspectionScopeWhere(context),
              projectWhere(filters),
              filters.q ? { OR: [{ inspectionNumber: term(filters.q) }, { workReference: term(filters.q) }, { locationText: term(filters.q) }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.qualityInspection.findMany({
          where: { AND: [buildInspectionScopeWhere(context), { id: { in: ids } }] },
          select: {
            id: true,
            inspectionNumber: true,
            inspectionType: true,
            result: true,
            inspectionDate: true,
            locationText: true,
            workReference: true,
            summary: true,
            project: { select: { id: true, name: true, code: true } },
            assignedInspector: { select: { user: { select: { firstName: true, lastName: true } } } },
          },
        });
        return new Map(
          rows.map((row): [string, RecordFacts] => [
            row.id,
            {
              id: row.id,
              reference: row.inspectionNumber,
              title: `${row.inspectionNumber} — ${labelOf(row.inspectionType)}`,
              subtitle: row.workReference ?? row.locationText,
              amount: null,
              project: projectRef(row.project),
              href: `/qaqc/inspections/${row.id}`,
              priority: row.result === "FAIL" ? "HIGH" : "NORMAL",
              summary: [
                { label: "Type", value: labelOf(row.inspectionType) },
                { label: "Result", value: labelOf(row.result), emphasis: row.result === "FAIL" ? "warning" : "strong" },
                { label: "Project", value: row.project?.name ?? "—" },
                { label: "Location", value: row.locationText ?? "—" },
                { label: "Inspected", value: formatDate(row.inspectionDate) },
                { label: "Inspector", value: `${row.assignedInspector.user.firstName} ${row.assignedInspector.user.lastName}` },
              ],
              description: row.summary,
            },
          ]),
        );
      },
      approve: (context, id, note, guard) => approveInspection(context, id, note, guard),
      reject: (context, id, note, guard) => rejectInspection(context, id, note, guard),
    },

    NCR: {
      recordType: "non_conformance_report",
      noun: "NCR",
      canView: (context) => can(context, "qaqc.approval.view") && can(context, "qaqc.ncr.view"),
      canApprove: (context) => qualityApprovals.canApproveType(context, "NCR"),
      canReject: (context) => qualityApprovals.canRejectType(context, "NCR"),
      selfPermission: "qaqc.approval.self",
      reason: "A non-conformance report's disposition is approved before corrective work proceeds on it.",
      async match(context, filters) {
        if (excludesAmountFilter(filters)) return [];
        const rows = await prisma.nonConformanceReport.findMany({
          where: {
            AND: [
              buildNcrScopeWhere(context),
              projectWhere(filters),
              filters.q ? { OR: [{ ncrNumber: term(filters.q) }, { title: term(filters.q) }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.nonConformanceReport.findMany({
          where: { AND: [buildNcrScopeWhere(context), { id: { in: ids } }] },
          select: {
            id: true,
            ncrNumber: true,
            title: true,
            description: true,
            category: true,
            severity: true,
            rootCause: true,
            correctiveActionSummary: true,
            dueDate: true,
            project: { select: { id: true, name: true, code: true } },
          },
        });
        return new Map(
          rows.map((row): [string, RecordFacts] => [
            row.id,
            {
              id: row.id,
              reference: row.ncrNumber,
              title: `${row.ncrNumber} — ${row.title}`,
              subtitle: labelOf(row.category),
              amount: null,
              project: projectRef(row.project),
              href: `/qaqc/ncrs/${row.id}`,
              priority: SEVERITY_PRIORITY[row.severity],
              summary: [
                { label: "Severity", value: labelOf(row.severity), emphasis: row.severity === "CRITICAL" || row.severity === "HIGH" ? "warning" : "normal" },
                { label: "Category", value: labelOf(row.category) },
                { label: "Project", value: row.project?.name ?? "—" },
                { label: "Root cause", value: row.rootCause ?? "—" },
                { label: "Corrective action", value: row.correctiveActionSummary ?? "—" },
                { label: "Action due", value: formatDate(row.dueDate) },
              ],
              description: row.description,
            },
          ]),
        );
      },
      approve: (context, id, note, guard) => approveNcr(context, id, note, guard),
      reject: (context, id, note, guard) => rejectNcr(context, id, note, guard),
    },
  },
});
