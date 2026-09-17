import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { readableUnitWhere } from "@/lib/modules/project-structure/structure.permissions";
import { UNIT_PUBLICATION_STATUS_LABELS } from "@/lib/modules/project-structure/unit-publishing.types";
import { publishUnit, requestUnitRevision } from "@/lib/modules/project-structure/unit-publishing.service";
import { loadPublishStates } from "@/lib/modules/project-structure/unit-publishing.state";
import { createCycleProvider, type CycleTable, type RecordFacts } from "../approvals.cycle-provider";
import { excludesAmountFilter, MATCH_LIMIT, projectRef, projectWhere, term } from "./shared";

/**
 * Unit publishing in the Center (E-05D §21, §47): an Architect submits a unit
 * and whoever may publish it approves — publishing it — or returns it for
 * revision with a reason. Nothing is rejected outright: a unit that is not right
 * yet goes back to be corrected. Publishing is `project.unit.publish`, never
 * Approvals' own grant, and the unit service re-checks readiness under its lock.
 */
export const projectsApprovalProvider = createCycleProvider({
  key: "projects",
  moduleKey: "projects",
  label: "Unit publishing",
  table: () => prisma.unitPublicationApproval as unknown as CycleTable,
  records: {
    UNIT: {
      recordType: "project_unit",
      noun: "Unit",
      canView: (context) => can(context, "project.structure.view"),
      canApprove: (context) => can(context, "project.unit.publish"),
      // Returning for revision is the only "no" a unit gets.
      canReject: (context) => can(context, "project.unit.revision_request"),
      // A publisher may publish the unit in front of them, whoever submitted it (E-05D §19).
      selfPermission: "project.unit.publish",
      reason: "A unit is published before Sales, Finance or the 3D explorer rely on it.",
      async match(context, filters) {
        if (excludesAmountFilter(filters)) return [];
        const rows = await prisma.projectUnit.findMany({
          where: {
            AND: [
              readableUnitWhere(context),
              projectWhere(filters),
              filters.q ? { OR: [{ unitCode: term(filters.q) }, { name: term(filters.q) }, { project: { name: term(filters.q) } }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const readable = await prisma.projectUnit.findMany({
          where: { AND: [readableUnitWhere(context), { id: { in: ids } }] },
          select: { id: true, project: { select: { id: true, name: true, code: true } } },
        });
        const projects = new Map(readable.map((row) => [row.id, row.project]));
        const states = await loadPublishStates(prisma, context.companyId, readable.map((row) => row.id));
        return new Map(
          [...states.values()].map(({ row, readiness, drift }): [string, RecordFacts] => {
            const project = projects.get(row.id)!;
            const current = row.currentPublication;
            return [
              row.id,
              {
                id: row.id,
                reference: row.unitCode,
                title: `${row.unitCode} — ${row.unitType.name}`,
                subtitle: `${row.floor.building.name} · ${row.floor.name}`,
                amount: null,
                project: projectRef(project),
                href: `/projects/${row.projectId}/units/${row.id}/publishing`,
                summary: [
                  { label: "Status", value: UNIT_PUBLICATION_STATUS_LABELS[row.publicationStatus] },
                  { label: "Published version", value: current ? `v${current.versionNumber}${drift ? " · unpublished changes" : ""}` : "Never published" },
                  { label: "Readiness", value: `${readiness.complete} / ${readiness.required} required items complete` },
                  { label: "Sales Plan", value: row.salesPlanDocument ? row.salesPlanDocument.originalFileName ?? row.salesPlanDocument.name : "Missing" },
                ],
                description: row.revisionReason ? `Last revision requested: ${row.revisionReason}` : null,
                warnings: readiness.ready ? [] : [{ code: "UNIT_NOT_READY", message: `Cannot be published yet. Missing: ${readiness.missing.join(", ")}.`, severity: "WARNING" }],
              },
            ];
          }),
        );
      },
      approve: async (context, id, note, guard) => {
        await publishUnit(context, id, { note }, guard);
      },
      returnForRevision: async (context, id, note, guard) => {
        await requestUnitRevision(context, id, { reason: note }, guard);
      },
    },
  },
});
