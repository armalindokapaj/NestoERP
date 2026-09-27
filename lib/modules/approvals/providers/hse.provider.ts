import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import * as hseApprovals from "@/lib/modules/hse/approvals/approval.service";
import { buildIncidentScopeWhere, buildInspectionScopeWhere, buildPermitScopeWhere, buildRiskAssessmentScopeWhere } from "@/lib/modules/hse/hse.scope";
import { closeIncident } from "@/lib/modules/hse/incidents/incident.service";
import { approveInspection, rejectInspection } from "@/lib/modules/hse/inspections/inspection.service";
import { approvePermit, rejectPermit } from "@/lib/modules/hse/permits/permit.service";
import { approveRiskAssessment, rejectRiskAssessment } from "@/lib/modules/hse/risk-assessments/risk.service";
import type { ApprovalPriority } from "../approvals.types";
import { createCycleProvider, type CycleTable, type RecordFacts } from "../approvals.cycle-provider";
import { excludesAmountFilter, formatDate, labelOf, MATCH_LIMIT, projectRef, projectWhere, startOfToday, term } from "./shared";

/**
 * HSE approvals in the Center (PRD #41 §73, §149, §299).
 *
 * Only HSE's explicit approval records: a submitted inspection, a risk
 * assessment, a work permit, and closing an incident. A work permit's start is
 * a real deadline — work cannot begin on an unapproved permit — so it is the
 * permit's due date here. Closing an incident has no rejection in HSE: an
 * incident that should not close is reopened on its own page.
 */

const LEVEL_PRIORITY: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", ApprovalPriority> = { LOW: "LOW", MEDIUM: "NORMAL", HIGH: "HIGH", CRITICAL: "CRITICAL" };
const LEVEL_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const PROJECT = { select: { id: true, name: true, code: true } } as const;

export const hseApprovalProvider = createCycleProvider({
  key: "hse",
  moduleKey: "hse",
  label: "HSE",
  table: () => prisma.hseApproval as unknown as CycleTable,
  records: {
    INSPECTION: {
      recordType: "hse_inspection",
      noun: "HSE inspection",
      canView: (context) => can(context, "hse.approval.view") && can(context, "hse.inspection.view"),
      canApprove: (context) => hseApprovals.canApproveType(context, "INSPECTION"),
      canReject: (context) => hseApprovals.canRejectType(context, "INSPECTION"),
      selfPermission: "hse.approval.self",
      // HSE bars whoever carried the inspection out, as well as its submitter (inspection.service approve/reject; AUD-10 A8).
      async excludedDeciders(companyId, ids) {
        const rows = await prisma.hseInspection.findMany({ where: { companyId, id: { in: ids }, executedByMemberId: { not: null } }, select: { id: true, executedByMemberId: true } });
        return new Map(rows.map((row) => [row.id, [row.executedByMemberId!]]));
      },
      excludedReason: "You carried out this inspection, so somebody else decides it.",
      reason: "A submitted safety inspection is approved before its findings are final.",
      async match(context, filters) {
        if (excludesAmountFilter(filters)) return [];
        const rows = await prisma.hseInspection.findMany({
          where: { AND: [buildInspectionScopeWhere(context), projectWhere(filters), filters.q ? { OR: [{ inspectionNumber: term(filters.q) }, { locationText: term(filters.q) }] } : {}] },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.hseInspection.findMany({
          where: { AND: [buildInspectionScopeWhere(context), { id: { in: ids } }] },
          select: { id: true, inspectionNumber: true, inspectionType: true, result: true, inspectionDate: true, locationText: true, summary: true, project: PROJECT },
        });
        return new Map(
          rows.map((row): [string, RecordFacts] => [
            row.id,
            {
              id: row.id,
              reference: row.inspectionNumber,
              title: `${row.inspectionNumber} — ${labelOf(row.inspectionType)}`,
              subtitle: row.locationText,
              amount: null,
              project: projectRef(row.project),
              href: `/hse/inspections/${row.id}`,
              priority: row.result === "FAIL" ? "HIGH" : "NORMAL",
              summary: [
                { label: "Type", value: labelOf(row.inspectionType) },
                { label: "Result", value: labelOf(row.result), emphasis: row.result === "FAIL" ? "warning" : "strong" },
                { label: "Project", value: row.project?.name ?? "—" },
                { label: "Location", value: row.locationText ?? "—" },
                { label: "Inspected", value: formatDate(row.inspectionDate) },
              ],
              description: row.summary,
            },
          ]),
        );
      },
      approve: (context, id, note, guard) => approveInspection(context, id, note, guard),
      reject: (context, id, note, guard) => rejectInspection(context, id, note, guard),
    },

    RISK_ASSESSMENT: {
      recordType: "risk_assessment",
      noun: "Risk assessment",
      canView: (context) => can(context, "hse.approval.view") && can(context, "hse.risk.view"),
      canApprove: (context) => hseApprovals.canApproveType(context, "RISK_ASSESSMENT"),
      canReject: (context) => hseApprovals.canRejectType(context, "RISK_ASSESSMENT"),
      selfPermission: "hse.approval.self",
      reason: "Work planned against a risk assessment waits for the assessment's approval.",
      async match(context, filters) {
        if (excludesAmountFilter(filters)) return [];
        const rows = await prisma.hseRiskAssessment.findMany({
          where: { AND: [buildRiskAssessmentScopeWhere(context), projectWhere(filters), filters.q ? { OR: [{ assessmentNumber: term(filters.q) }, { title: term(filters.q) }] } : {}] },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.hseRiskAssessment.findMany({
          where: { AND: [buildRiskAssessmentScopeWhere(context), { id: { in: ids } }] },
          select: {
            id: true,
            assessmentNumber: true,
            title: true,
            description: true,
            version: true,
            activityType: true,
            locationText: true,
            assessmentDate: true,
            project: PROJECT,
            items: { select: { riskLevel: true, residualRiskLevel: true } },
          },
        });
        return new Map(
          rows.map((row): [string, RecordFacts] => {
            const worst = row.items.reduce<(typeof LEVEL_ORDER)[number] | null>((top, item) => {
              const level = item.residualRiskLevel ?? item.riskLevel;
              return !top || LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(top) ? level : top;
            }, null);
            return [
              row.id,
              {
                id: row.id,
                reference: row.assessmentNumber,
                title: `${row.assessmentNumber} — ${row.title}`,
                subtitle: row.activityType ?? row.locationText,
                amount: null,
                project: projectRef(row.project),
                href: `/hse/risk-assessments/${row.id}`,
                priority: worst ? LEVEL_PRIORITY[worst] : "NORMAL",
                requiresStrongConfirmation: worst === "CRITICAL",
                summary: [
                  { label: "Version", value: String(row.version) },
                  { label: "Project", value: row.project?.name ?? "—" },
                  { label: "Activity", value: row.activityType ?? "—" },
                  { label: "Hazards", value: String(row.items.length) },
                  { label: "Highest remaining risk", value: worst ? labelOf(worst) : "—", emphasis: worst === "HIGH" || worst === "CRITICAL" ? "warning" : "normal" },
                  { label: "Assessed", value: formatDate(row.assessmentDate) },
                ],
                description: row.description,
                warnings: worst === "CRITICAL" ? [{ code: "CRITICAL_RESIDUAL_RISK", message: "At least one hazard remains critical after controls.", severity: "CRITICAL" }] : [],
              },
            ];
          }),
        );
      },
      approve: (context, id, note, guard) => approveRiskAssessment(context, id, note, guard),
      reject: (context, id, note, guard) => rejectRiskAssessment(context, id, note, guard),
    },

    WORK_PERMIT: {
      recordType: "work_permit",
      noun: "Work permit",
      canView: (context) => can(context, "hse.approval.view") && can(context, "hse.permit.view"),
      canApprove: (context) => hseApprovals.canApproveType(context, "WORK_PERMIT"),
      canReject: (context) => hseApprovals.canRejectType(context, "WORK_PERMIT"),
      selfPermission: "hse.approval.self",
      // HSE bars whoever requested the permit, as well as its submitter (permit.service approve/reject; AUD-10 A8).
      async excludedDeciders(companyId, ids) {
        const rows = await prisma.hseWorkPermit.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, requestedByMemberId: true } });
        return new Map(rows.flatMap((row): Array<[string, string[]]> => (row.requestedByMemberId ? [[row.id, [row.requestedByMemberId]]] : [])));
      },
      excludedReason: "You requested this permit, so somebody else decides it.",
      reason: "Hazardous work starts only under an approved permit.",
      async match(context, filters) {
        if (excludesAmountFilter(filters)) return [];
        const rows = await prisma.hseWorkPermit.findMany({
          where: { AND: [buildPermitScopeWhere(context), projectWhere(filters), filters.q ? { OR: [{ permitNumber: term(filters.q) }, { title: term(filters.q) }, { locationText: term(filters.q) }] } : {}] },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.hseWorkPermit.findMany({
          where: { AND: [buildPermitScopeWhere(context), { id: { in: ids } }] },
          select: {
            id: true,
            permitNumber: true,
            permitType: true,
            title: true,
            locationText: true,
            validFrom: true,
            validUntil: true,
            hazardsSummary: true,
            controlsSummary: true,
            ppeRequirements: true,
            project: PROJECT,
            riskAssessment: { select: { assessmentNumber: true, status: true } },
          },
        });
        const today = startOfToday();
        return new Map(
          rows.map((row): [string, RecordFacts] => {
            const warnings: NonNullable<RecordFacts["warnings"]> = [];
            if (row.validFrom < today) warnings.push({ code: "PERMIT_START_PASSED", message: `The permit was due to start ${formatDate(row.validFrom)}.`, severity: "WARNING" });
            if (row.riskAssessment && row.riskAssessment.status !== "APPROVED") {
              warnings.push({ code: "RISK_ASSESSMENT_NOT_APPROVED", message: `Its risk assessment ${row.riskAssessment.assessmentNumber} is not approved yet.`, severity: "CRITICAL" });
            }
            return [
              row.id,
              {
                id: row.id,
                reference: row.permitNumber,
                title: `${row.permitNumber} — ${row.title}`,
                subtitle: `${labelOf(row.permitType)} · ${row.locationText}`,
                amount: null,
                project: projectRef(row.project),
                href: `/hse/permits/${row.id}`,
                dueAt: row.validFrom,
                priority: "HIGH",
                summary: [
                  { label: "Type", value: labelOf(row.permitType) },
                  { label: "Project", value: row.project.name },
                  { label: "Location", value: row.locationText },
                  { label: "Valid", value: `${formatDate(row.validFrom)} – ${formatDate(row.validUntil)}`, emphasis: "strong" },
                  { label: "Risk assessment", value: row.riskAssessment?.assessmentNumber ?? "—" },
                  { label: "PPE", value: row.ppeRequirements ?? "—" },
                ],
                description: [row.hazardsSummary && `Hazards: ${row.hazardsSummary}`, row.controlsSummary && `Controls: ${row.controlsSummary}`].filter(Boolean).join("\n\n") || null,
                warnings,
              },
            ];
          }),
        );
      },
      approve: (context, id, note, guard) => approvePermit(context, id, note, guard),
      reject: (context, id, note, guard) => rejectPermit(context, id, note, guard),
    },

    INCIDENT_CLOSE: {
      recordType: "incident",
      noun: "Incident closure",
      canView: (context) => can(context, "hse.approval.view") && can(context, "hse.incident.view"),
      canApprove: (context) => hseApprovals.canApproveType(context, "INCIDENT_CLOSE"),
      canReject: () => false,
      selfPermission: "hse.approval.self",
      reason: "An incident is closed only once its investigation and actions are signed off.",
      async match(context, filters) {
        if (excludesAmountFilter(filters)) return [];
        const rows = await prisma.hseIncident.findMany({
          where: { AND: [buildIncidentScopeWhere(context), projectWhere(filters), filters.q ? { OR: [{ incidentNumber: term(filters.q) }, { title: term(filters.q) }] } : {}] },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.hseIncident.findMany({
          where: { AND: [buildIncidentScopeWhere(context), { id: { in: ids } }] },
          select: { id: true, incidentNumber: true, title: true, incidentType: true, severity: true, occurredAt: true, rootCause: true, closureNote: true, project: PROJECT },
        });
        return new Map(
          rows.map((row): [string, RecordFacts] => [
            row.id,
            {
              id: row.id,
              reference: row.incidentNumber,
              title: `${row.incidentNumber} — ${row.title}`,
              subtitle: labelOf(row.incidentType),
              amount: null,
              project: projectRef(row.project),
              href: `/hse/incidents/${row.id}`,
              priority: LEVEL_PRIORITY[row.severity],
              requiresStrongConfirmation: row.severity === "CRITICAL",
              summary: [
                { label: "Severity", value: labelOf(row.severity), emphasis: row.severity === "HIGH" || row.severity === "CRITICAL" ? "warning" : "normal" },
                { label: "Type", value: labelOf(row.incidentType) },
                { label: "Project", value: row.project?.name ?? "—" },
                { label: "Occurred", value: formatDate(row.occurredAt) },
                { label: "Root cause", value: row.rootCause ?? "—" },
              ],
              description: row.closureNote,
            },
          ]),
        );
      },
      approve: (context, id, note, guard) => closeIncident(context, id, note, guard),
    },
  },
});
