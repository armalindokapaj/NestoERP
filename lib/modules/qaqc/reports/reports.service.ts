import { Prisma, type QualitySeverity } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { quantityString, sum } from "../qaqc.quantity";
import {
  buildCorrectiveActionScopeWhere,
  buildDefectScopeWhere,
  buildInspectionScopeWhere,
  buildNcrScopeWhere,
} from "../qaqc.scope";
import type { AgingBucketRow, PassRateRow } from "../qaqc.types";

/**
 * QA/QC reports (PRD #21 §191–§200).
 *
 * Everything is scoped to the reader, so two people on this page see different
 * totals and both are right (PRD #21 §202).
 *
 * The pass rate is the one figure people will quote in meetings, so it is
 * computed the same way everywhere: decided inspections only, and `null` rather
 * than 0% when nothing has been decided (PRD #21 §193).
 */

const DECIDED = ["APPROVED", "CLOSED"] as const;

const OPEN_DEFECTS = ["OPEN", "IN_PROGRESS", "REOPENED", "RESOLVED"] as const;
const OPEN_NCRS = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "PENDING_APPROVAL",
  "APPROVED_FOR_CLOSE",
  "REOPENED",
] as const;

export type QaqcReports = {
  passRateOverall: PassRateRow;
  passRateByType: PassRateRow[];
  passRateByProject: PassRateRow[];
  defectAging: AgingBucketRow[];
  ncrAging: AgingBucketRow[];
  ncrsByCategory: { category: string; count: number }[];
  defectsBySeverity: { severity: QualitySeverity; count: number }[];
  correctiveActions: { status: string; count: number }[];
  reinspections: { total: number; passed: number };
  materialReleases: {
    released: string;
    rejected: string;
    conditional: string;
    inspections: number;
  } | null;
  /** Null when the reader cannot reach the buying behind the deliveries. */
  supplierQuality: SupplierQualityRow[] | null;
};

/**
 * Quality by supplier (PRD #21 §200).
 *
 * Deliberately not a scorecard: it counts what quality found on the deliveries
 * this reader can already see, and stops there. Naming the supplier needs
 * Procurement access on top of quality access — quality is not a way around
 * Procurement's scope (§183).
 */
export type SupplierQualityRow = {
  supplier: string;
  inspections: number;
  passed: number;
  failed: number;
  conditional: number;
  percent: number | null;
  rejectedQuantity: string;
  ncrs: number;
};

function toRate(
  label: string,
  counts: { passed: number; failed: number; conditional: number },
): PassRateRow {
  const total = counts.passed + counts.failed + counts.conditional;
  return {
    label,
    ...counts,
    total,
    percent: total === 0 ? null : Math.round((counts.passed / total) * 100),
  };
}

/** Buckets by how long something has been open (PRD #21 §195, §196). */
function ageBuckets(dates: Date[], today = new Date()): AgingBucketRow[] {
  const day = 24 * 60 * 60 * 1000;
  const buckets = [
    { label: "Under a week", max: 7 },
    { label: "1–4 weeks", max: 28 },
    { label: "1–3 months", max: 90 },
    { label: "Over 3 months", max: Number.POSITIVE_INFINITY },
  ];

  const counts = buckets.map((bucket) => ({ label: bucket.label, count: 0 }));

  for (const date of dates) {
    const age = Math.floor((today.getTime() - date.getTime()) / day);
    const index = buckets.findIndex((bucket) => age < bucket.max);
    counts[index === -1 ? buckets.length - 1 : index]!.count += 1;
  }

  return counts;
}

export async function qaqcReports(context: UserContext): Promise<QaqcReports> {
  assertModule(context, "qaqc");
  assertPermission(context, "qaqc.report.view");

  const seeInspections = can(context, "qaqc.inspection.view");
  const seeDefects = can(context, "qaqc.defect.view");
  const seeNcrs = can(context, "qaqc.ncr.view");
  const seeActions = can(context, "qaqc.corrective_action.view");
  const seeMaterials = can(context, "qaqc.material.view");

  const [decided, openDefects, openNcrs, ncrCategories, defectSeverities, actions, reinspections] =
    await Promise.all([
      seeInspections
        ? prisma.qualityInspection.findMany({
            where: {
              AND: [
                buildInspectionScopeWhere(context),
                { status: { in: [...DECIDED] }, result: { not: "NOT_SET" } },
              ],
            },
            select: {
              result: true,
              inspectionType: true,
              parentInspectionId: true,
              project: { select: { code: true, name: true } },
            },
          })
        : Promise.resolve([]),
      seeDefects
        ? prisma.qualityDefect.findMany({
            where: {
              AND: [buildDefectScopeWhere(context), { status: { in: [...OPEN_DEFECTS] } }],
            },
            select: { createdAt: true },
          })
        : Promise.resolve([]),
      seeNcrs
        ? prisma.nonConformanceReport.findMany({
            where: { AND: [buildNcrScopeWhere(context), { status: { in: [...OPEN_NCRS] } }] },
            select: { createdAt: true },
          })
        : Promise.resolve([]),
      seeNcrs
        ? prisma.nonConformanceReport.groupBy({
            by: ["category"],
            where: buildNcrScopeWhere(context),
            _count: { _all: true },
          })
        : Promise.resolve([]),
      seeDefects
        ? prisma.qualityDefect.groupBy({
            by: ["severity"],
            where: {
              AND: [buildDefectScopeWhere(context), { status: { in: [...OPEN_DEFECTS] } }],
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      seeActions
        ? prisma.correctiveAction.groupBy({
            by: ["status"],
            where: buildCorrectiveActionScopeWhere(context),
            _count: { _all: true },
          })
        : Promise.resolve([]),
      seeInspections
        ? prisma.qualityInspection.findMany({
            where: {
              AND: [
                buildInspectionScopeWhere(context),
                { parentInspectionId: { not: null }, status: { in: [...DECIDED] } },
              ],
            },
            select: { result: true },
          })
        : Promise.resolve([]),
    ]);

  const tally = () => ({ passed: 0, failed: 0, conditional: 0 });
  const overall = tally();
  const byType = new Map<string, ReturnType<typeof tally>>();
  const byProject = new Map<string, ReturnType<typeof tally>>();

  for (const row of decided) {
    const bump = (counts: ReturnType<typeof tally>) => {
      if (row.result === "PASS") counts.passed += 1;
      else if (row.result === "FAIL") counts.failed += 1;
      else counts.conditional += 1;
    };

    bump(overall);

    const type = byType.get(row.inspectionType) ?? tally();
    bump(type);
    byType.set(row.inspectionType, type);

    // Company-general inspections are grouped separately rather than folded
    // into a project that did not have them (PRD #21 §199).
    const label = row.project ? `${row.project.code} — ${row.project.name}` : "No project";
    const project = byProject.get(label) ?? tally();
    bump(project);
    byProject.set(label, project);
  }

  const materialReleases = seeMaterials
    ? await prisma.materialInspectionDecision
        .findMany({
          where: { inspection: { is: buildInspectionScopeWhere(context) } },
          select: {
            inspectionId: true,
            acceptedQuantity: true,
            rejectedQuantity: true,
            conditionalQuantity: true,
          },
        })
        .then((rows) => ({
          /*
           * Summed across every material decision the reader can see. These are
           * quantities of different things, so the figure answers "how much did
           * quality turn away" rather than "how much of what" — the per-line
           * detail lives on each inspection (PRD #21 §194).
           */
          released: quantityString(sum(rows.map((row) => row.acceptedQuantity))),
          rejected: quantityString(sum(rows.map((row) => row.rejectedQuantity))),
          conditional: quantityString(sum(rows.map((row) => row.conditionalQuantity))),
          inspections: new Set(rows.map((row) => row.inspectionId)).size,
        }))
    : null;

  /*
   * Supplier quality, only where the reader may actually name a supplier
   * (PRD #21 §183, §200). Without Procurement access they see the totals above
   * and no attribution, rather than a table of anonymous rows.
   */
  const supplierQuality =
    seeInspections && can(context, "procurement.supplier.view")
      ? await supplierRows(context)
      : null;

  return {
    passRateOverall: toRate("All inspections", overall),
    passRateByType: [...byType.entries()].map(([label, counts]) => toRate(label, counts)),
    passRateByProject: [...byProject.entries()]
      .map(([label, counts]) => toRate(label, counts))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
    defectAging: ageBuckets(openDefects.map((row) => row.createdAt)),
    ncrAging: ageBuckets(openNcrs.map((row) => row.createdAt)),
    ncrsByCategory: ncrCategories.map((row) => ({
      category: row.category,
      count: row._count._all,
    })),
    defectsBySeverity: defectSeverities.map((row) => ({
      severity: row.severity,
      count: row._count._all,
    })),
    correctiveActions: actions.map((row) => ({ status: row.status, count: row._count._all })),
    reinspections: {
      total: reinspections.length,
      passed: reinspections.filter((row) => row.result === "PASS").length,
    },
    materialReleases,
    supplierQuality,
  };
}

async function supplierRows(context: UserContext): Promise<SupplierQualityRow[]> {
  const rows = await prisma.qualityInspection.findMany({
    where: {
      AND: [
        buildInspectionScopeWhere(context),
        { inspectionType: "MATERIAL", goodsReceiptId: { not: null } },
      ],
    },
    select: {
      result: true,
      status: true,
      goodsReceiptId: true,
      goodsReceipt: { select: { supplier: { select: { name: true } } } },
      materialDecisions: { select: { rejectedQuantity: true } },
    },
  });

  const ncrRows = await prisma.nonConformanceReport.findMany({
    where: { AND: [buildNcrScopeWhere(context), { goodsReceiptId: { not: null } }] },
    select: { goodsReceipt: { select: { supplier: { select: { name: true } } } } },
  });

  const bySupplier = new Map<
    string,
    { inspections: number; passed: number; failed: number; conditional: number; rejected: Prisma.Decimal; ncrs: number }
  >();

  const blank = () => ({
    inspections: 0,
    passed: 0,
    failed: 0,
    conditional: 0,
    rejected: new Prisma.Decimal(0),
    ncrs: 0,
  });

  for (const row of rows) {
    const name = row.goodsReceipt?.supplier.name;
    if (!name) continue;

    const entry = bySupplier.get(name) ?? blank();
    entry.inspections += 1;
    if (row.status === "APPROVED" || row.status === "CLOSED") {
      if (row.result === "PASS") entry.passed += 1;
      else if (row.result === "FAIL") entry.failed += 1;
      else if (row.result === "CONDITIONAL") entry.conditional += 1;
    }
    entry.rejected = entry.rejected.plus(
      sum(row.materialDecisions.map((decision) => decision.rejectedQuantity)),
    );
    bySupplier.set(name, entry);
  }

  for (const row of ncrRows) {
    const name = row.goodsReceipt?.supplier.name;
    if (!name) continue;
    const entry = bySupplier.get(name) ?? blank();
    entry.ncrs += 1;
    bySupplier.set(name, entry);
  }

  return [...bySupplier.entries()]
    .map(([supplier, entry]) => {
      const decided = entry.passed + entry.failed + entry.conditional;
      return {
        supplier,
        inspections: entry.inspections,
        passed: entry.passed,
        failed: entry.failed,
        conditional: entry.conditional,
        percent: decided === 0 ? null : Math.round((entry.passed / decided) * 100),
        rejectedQuantity: quantityString(entry.rejected),
        ncrs: entry.ncrs,
      };
    })
    .sort((a, b) => b.inspections - a.inspections);
}

/** One project's quality position, for the project tab (PRD #21 §32, §199). */
export async function projectQuality(context: UserContext, projectId: string) {
  const [inspections, defects, ncrs, actions] = await Promise.all([
    can(context, "qaqc.inspection.view")
      ? prisma.qualityInspection.groupBy({
          by: ["result"],
          where: {
            AND: [
              buildInspectionScopeWhere(context),
              { projectId, status: { in: [...DECIDED] }, result: { not: "NOT_SET" } },
            ],
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    can(context, "qaqc.defect.view")
      ? prisma.qualityDefect.count({
          where: {
            AND: [
              buildDefectScopeWhere(context),
              { projectId, status: { in: [...OPEN_DEFECTS] } },
            ],
          },
        })
      : Promise.resolve(0),
    can(context, "qaqc.ncr.view")
      ? prisma.nonConformanceReport.count({
          where: {
            AND: [buildNcrScopeWhere(context), { projectId, status: { in: [...OPEN_NCRS] } }],
          },
        })
      : Promise.resolve(0),
    can(context, "qaqc.corrective_action.view")
      ? prisma.correctiveAction.count({
          where: {
            AND: [
              buildCorrectiveActionScopeWhere(context),
              {
                projectId,
                status: { in: ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "REOPENED"] },
              },
            ],
          },
        })
      : Promise.resolve(0),
  ]);

  const passed = inspections.find((row) => row.result === "PASS")?._count._all ?? 0;
  const total = inspections.reduce((running, row) => running + row._count._all, 0);

  return {
    passRate: total === 0 ? null : { passed, total, percent: Math.round((passed / total) * 100) },
    openDefects: defects,
    openNcrs: ncrs,
    openActions: actions,
  };
}
