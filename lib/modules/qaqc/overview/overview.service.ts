import type {
  CorrectiveActionStatus,
  NCRStatus,
  QualityDefectStatus,
  QualityInspectionStatus,
} from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import {
  buildCorrectiveActionScopeWhere,
  buildDefectScopeWhere,
  buildInspectionScopeWhere,
  buildNcrScopeWhere,
  buildRequestScopeWhere,
} from "../qaqc.scope";
import {
  defectListQuerySchema,
  inspectionListQuerySchema,
  ncrListQuerySchema,
  requestListQuerySchema,
} from "../qaqc.schema";
import type { QaqcAttentionDTO, QaqcOverviewDTO } from "../qaqc.types";

/**
 * The QA/QC overview (PRD #21 §31–§33).
 *
 * Every figure is counted through the reader's own scope, so a site engineer
 * and the quality manager see different numbers and both are right.
 *
 * The pass rate counts *decided* inspections only (PRD #21 §193). Including
 * ones still being written would make the rate drift every time somebody opened
 * a checklist, and a quality metric that moves when nobody has decided anything
 * is worse than no metric.
 */

const OPEN_INSPECTIONS: QualityInspectionStatus[] = [
  "DRAFT",
  "IN_PROGRESS",
  "PENDING_APPROVAL",
  "REJECTED",
];
const OPEN_DEFECTS: QualityDefectStatus[] = ["OPEN", "IN_PROGRESS", "REOPENED", "RESOLVED"];
const OPEN_NCRS: NCRStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "PENDING_APPROVAL",
  "APPROVED_FOR_CLOSE",
  "REOPENED",
];
const OPEN_ACTIONS: CorrectiveActionStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "REOPENED",
];

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function qaqcOverview(context: UserContext): Promise<QaqcOverviewDTO> {
  assertModule(context, "qaqc");
  assertPermission(context, "qaqc.view");

  const seeRequests = can(context, "qaqc.request.view");
  const seeInspections = can(context, "qaqc.inspection.view");
  const seeMaterials = can(context, "qaqc.material.view");
  const seeDefects = can(context, "qaqc.defect.view");
  const seeNcrs = can(context, "qaqc.ncr.view");
  const seeActions = can(context, "qaqc.corrective_action.view");
  const seeApprovals = can(context, "qaqc.approval.view");

  const today = startOfToday();

  const [
    openRequests,
    unassignedRequests,
    inspectionsInProgress,
    awaitingApproval,
    openDefects,
    criticalDefects,
    openNcrs,
    overdueNcrs,
    openActions,
    overdueActions,
    decided,
  ] = await Promise.all([
    seeRequests
      ? prisma.inspectionRequest.count({
          where: {
            AND: [
              buildRequestScopeWhere(context),
              { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] } },
            ],
          },
        })
      : Promise.resolve(0),
    seeRequests
      ? prisma.inspectionRequest.count({
          where: {
            AND: [
              buildRequestScopeWhere(context),
              { status: "OPEN", assignedInspectorMemberId: null },
            ],
          },
        })
      : Promise.resolve(0),
    seeInspections
      ? prisma.qualityInspection.count({
          where: {
            AND: [buildInspectionScopeWhere(context), { status: { in: OPEN_INSPECTIONS } }],
          },
        })
      : Promise.resolve(0),
    seeInspections
      ? prisma.qualityInspection.count({
          where: {
            AND: [buildInspectionScopeWhere(context), { status: "PENDING_APPROVAL" }],
          },
        })
      : Promise.resolve(0),
    seeDefects
      ? prisma.qualityDefect.count({
          where: { AND: [buildDefectScopeWhere(context), { status: { in: OPEN_DEFECTS } }] },
        })
      : Promise.resolve(0),
    seeDefects
      ? prisma.qualityDefect.count({
          where: {
            AND: [
              buildDefectScopeWhere(context),
              { status: { in: OPEN_DEFECTS }, severity: { in: ["HIGH", "CRITICAL"] } },
            ],
          },
        })
      : Promise.resolve(0),
    seeNcrs
      ? prisma.nonConformanceReport.count({
          where: { AND: [buildNcrScopeWhere(context), { status: { in: OPEN_NCRS } }] },
        })
      : Promise.resolve(0),
    seeNcrs
      ? prisma.nonConformanceReport.count({
          where: {
            AND: [
              buildNcrScopeWhere(context),
              { status: { in: OPEN_NCRS }, dueDate: { lt: today } },
            ],
          },
        })
      : Promise.resolve(0),
    seeActions
      ? prisma.correctiveAction.count({
          where: {
            AND: [buildCorrectiveActionScopeWhere(context), { status: { in: OPEN_ACTIONS } }],
          },
        })
      : Promise.resolve(0),
    seeActions
      ? prisma.correctiveAction.count({
          where: {
            AND: [
              buildCorrectiveActionScopeWhere(context),
              { status: { in: OPEN_ACTIONS }, dueDate: { lt: today } },
            ],
          },
        })
      : Promise.resolve(0),
    seeInspections
      ? prisma.qualityInspection.groupBy({
          by: ["result"],
          where: {
            AND: [
              buildInspectionScopeWhere(context),
              { status: { in: ["APPROVED", "CLOSED"] }, result: { not: "NOT_SET" } },
            ],
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const passed = decided.find((row) => row.result === "PASS")?._count._all ?? 0;
  const total = decided.reduce((running, row) => running + row._count._all, 0);

  return {
    visible: {
      requests: seeRequests,
      inspections: seeInspections,
      materials: seeMaterials,
      defects: seeDefects,
      ncrs: seeNcrs,
      actions: seeActions,
      approvals: seeApprovals,
    },
    openRequests,
    unassignedRequests,
    inspectionsInProgress,
    awaitingApproval,
    openDefects,
    criticalDefects,
    openNcrs,
    overdueNcrs,
    openActions,
    overdueActions,
    // Null rather than 0%: nothing decided yet is not a 0% pass rate (§193).
    passRate:
      total === 0
        ? null
        : { passed, total, percent: Math.round((passed / total) * 100) },
  };
}

/** What needs somebody's attention today (PRD #21 §31). */
export async function qaqcAttention(context: UserContext): Promise<QaqcAttentionDTO> {
  assertModule(context, "qaqc");
  assertPermission(context, "qaqc.view");

  const { listInspections } = await import("../inspections/inspection.service");
  const { listDefects } = await import("../defects/defect.service");
  const { listNcrs } = await import("../ncrs/ncr.service");
  const { listRequests } = await import("../requests/request.service");

  const [awaitingApproval, overdueDefects, overdueNcrs, unassignedRequests] = await Promise.all([
    can(context, "qaqc.inspection.view")
      ? listInspections(
          context,
          inspectionListQuerySchema.parse({ view: "awaiting-approval", limit: 5 }),
        ).then((r) => r.data)
      : Promise.resolve([]),
    can(context, "qaqc.defect.view")
      ? listDefects(
          context,
          defectListQuerySchema.parse({ view: "overdue", sort: "severity-desc", limit: 5 }),
        ).then((r) => r.data)
      : Promise.resolve([]),
    can(context, "qaqc.ncr.view")
      ? listNcrs(
          context,
          ncrListQuerySchema.parse({ view: "overdue", sort: "severity-desc", limit: 5 }),
        ).then((r) => r.data)
      : Promise.resolve([]),
    can(context, "qaqc.request.view")
      ? listRequests(
          context,
          requestListQuerySchema.parse({ view: "unassigned", sort: "priority-desc", limit: 5 }),
        ).then((r) => r.data)
      : Promise.resolve([]),
  ]);

  return { awaitingApproval, overdueDefects, overdueNcrs, unassignedRequests };
}
