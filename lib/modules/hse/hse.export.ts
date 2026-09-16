import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { toCsv } from "@/lib/utils/csv";
import * as actions from "./actions/action.service";
import * as environment from "./environment/environment.service";
import * as hazards from "./hazards/hazard.service";
import {
  actionStatusLabels,
  actionTypeLabels,
  environmentalCategoryLabels,
  environmentalStatusLabels,
  hazardCategoryLabels,
  hazardStatusLabels,
  incidentStatusLabels,
  incidentTypeLabels,
  inspectionResultLabels,
  inspectionStatusLabels,
  inspectionTypeLabels,
  permitStatusLabels,
  permitTypeLabels,
  priorityLabels,
  riskAssessmentStatusLabels,
  severityLabels,
  toolboxStatusLabels,
} from "./hse.status";
import { riskLevelLabels } from "./hse.risk";
import * as incidents from "./incidents/incident.service";
import * as inspections from "./inspections/inspection.service";
import * as permits from "./permits/permit.service";
import * as risk from "./risk-assessments/risk.service";
import * as toolbox from "./toolbox/toolbox.service";
import {
  actionListSchema,
  hazardListSchema,
  incidentListSchema,
  inspectionListSchema,
  observationListSchema,
  permitListSchema,
  riskAssessmentListSchema,
  toolboxListSchema,
  type ActionListQuery,
  type HazardListQuery,
  type IncidentListQuery,
  type InspectionListQuery,
  type ObservationListQuery,
  type PermitListQuery,
  type RiskAssessmentListQuery,
  type ToolboxListQuery,
} from "./hse.schema";

/**
 * CSV export (PRD #22 §216, §217).
 *
 * The export is the list. It parses the same query, calls the same service and
 * receives the same scoped DTOs — so the file can never contain a row the
 * reader could not open on screen.
 *
 * Two consequences worth stating. Status and result stay separate columns on an
 * inspection, because collapsing them is the confusion this module exists to
 * avoid (§37, §38). And an incident's injury flags are written only when the
 * DTO carried them: a reader whose `injury` came back null exports a file
 * without those columns filled, rather than a row of "no" that would read as an
 * answer (§22).
 */

export const EXPORT_ROW_CAP = 10_000;

export type HseExportKind =
  | "inspections"
  | "hazards"
  | "incidents"
  | "risk-assessments"
  | "actions"
  | "toolbox-talks"
  | "permits"
  | "environment";

function day(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

export type HseExportQueries = {
  inspections: InspectionListQuery;
  hazards: HazardListQuery;
  incidents: IncidentListQuery;
  riskAssessments: RiskAssessmentListQuery;
  actions: ActionListQuery;
  toolbox: ToolboxListQuery;
  permits: PermitListQuery;
  environment: ObservationListQuery;
};

/**
 * Only the query for the kind being exported is needed (PRD #47 §69). The route
 * parses just that one: parsing all eight made a filter meaningful to one list
 * — an incident severity, say — fail another list's schema and turn a
 * perfectly good export into a 422.
 */
export async function exportHse(
  context: UserContext,
  kind: HseExportKind,
  given: Partial<HseExportQueries>,
): Promise<{ filename: string; csv: string }> {
  assertModule(context, "hse");
  assertPermission(context, "hse.export");

  const stamp = new Date().toISOString().slice(0, 10);
  const cap = { limit: EXPORT_ROW_CAP, page: 1 };
  const queries: HseExportQueries = {
    inspections: given.inspections ?? inspectionListSchema.parse({}),
    hazards: given.hazards ?? hazardListSchema.parse({}),
    incidents: given.incidents ?? incidentListSchema.parse({}),
    riskAssessments: given.riskAssessments ?? riskAssessmentListSchema.parse({}),
    actions: given.actions ?? actionListSchema.parse({}),
    toolbox: given.toolbox ?? toolboxListSchema.parse({}),
    permits: given.permits ?? permitListSchema.parse({}),
    environment: given.environment ?? observationListSchema.parse({}),
  };

  switch (kind) {
    case "inspections": {
      const { data } = await inspections.listInspections(context, {
        ...queries.inspections,
        ...cap,
      });
      return {
        filename: `hse-inspections-${stamp}.csv`,
        csv: toCsv(
          [
            "Inspection",
            "Type",
            "Status",
            "Result",
            "Project",
            "Inspector",
            "Scheduled",
            "Inspected",
            "Location",
            "Failed items",
          ],
          data.map((row) => [
            row.inspectionNumber,
            inspectionTypeLabels[row.inspectionType],
            inspectionStatusLabels[row.status],
            inspectionResultLabels[row.result],
            row.project?.code ?? null,
            row.assignedInspector?.fullName ?? null,
            day(row.scheduledDate),
            day(row.inspectionDate),
            row.locationText,
            row.failedItemCount,
          ]),
        ),
      };
    }

    case "hazards": {
      const { data } = await hazards.listHazards(context, { ...queries.hazards, ...cap });
      return {
        filename: `hse-hazards-${stamp}.csv`,
        csv: toCsv(
          [
            "Hazard",
            "Title",
            "Category",
            "Status",
            "Likelihood",
            "Severity",
            "Risk score",
            "Risk level",
            "Residual score",
            "Residual level",
            "Project",
            "Assigned to",
            "Observed",
            "Due",
            "Overdue",
          ],
          data.map((row) => [
            row.hazardNumber,
            row.title,
            hazardCategoryLabels[row.hazardCategory],
            hazardStatusLabels[row.status],
            row.risk.likelihood,
            row.risk.severity,
            row.risk.score,
            riskLevelLabels[row.risk.level],
            row.residualRisk?.score ?? null,
            row.residualRisk ? riskLevelLabels[row.residualRisk.level] : null,
            row.project?.code ?? null,
            row.assignedTo?.fullName ?? null,
            day(row.observedAt),
            day(row.dueDate),
            yesNo(row.overdue),
          ]),
        ),
      };
    }

    case "incidents": {
      const { data } = await incidents.listIncidents(context, { ...queries.incidents, ...cap });
      return {
        filename: `hse-incidents-${stamp}.csv`,
        csv: toCsv(
          [
            "Incident",
            "Type",
            "Title",
            "Severity",
            "Status",
            "Project",
            "Reported by",
            "Investigator",
            "Occurred",
            "Reported",
            "Injury",
            "First aid",
            "Medical treatment",
            "Lost time",
            "Property damage",
            "Environmental impact",
          ],
          data.map((row) => [
            row.incidentNumber,
            incidentTypeLabels[row.incidentType],
            row.title,
            severityLabels[row.severity],
            incidentStatusLabels[row.status],
            row.project?.code ?? null,
            row.reportedBy?.fullName ?? null,
            row.investigator?.fullName ?? null,
            day(row.occurredAt),
            day(row.reportedAt),
            // Blank, not "No", when the reader may not see them (§22).
            row.injury ? yesNo(row.injury.injuryOccurred) : null,
            row.injury ? yesNo(row.injury.firstAidRequired) : null,
            row.injury ? yesNo(row.injury.medicalTreatmentRequired) : null,
            row.injury ? yesNo(row.injury.lostTime) : null,
            row.injury ? yesNo(row.injury.propertyDamage) : null,
            row.injury ? yesNo(row.injury.environmentalImpact) : null,
          ]),
        ),
      };
    }

    case "risk-assessments": {
      const { data } = await risk.listRiskAssessments(context, {
        ...queries.riskAssessments,
        ...cap,
      });
      return {
        filename: `hse-risk-assessments-${stamp}.csv`,
        csv: toCsv(
          [
            "Assessment",
            "Title",
            "Version",
            "Status",
            "Project",
            "Owner",
            "Assessed",
            "Review",
            "Review due",
            "Highest risk",
            "Lines",
          ],
          data.map((row) => [
            row.assessmentNumber,
            row.title,
            row.version,
            riskAssessmentStatusLabels[row.status],
            row.project?.code ?? null,
            row.owner?.fullName ?? null,
            day(row.assessmentDate),
            day(row.reviewDate),
            yesNo(row.reviewDue),
            row.highestRisk ? riskLevelLabels[row.highestRisk] : null,
            row.itemCount,
          ]),
        ),
      };
    }

    case "actions": {
      const { data } = await actions.listActions(context, { ...queries.actions, ...cap });
      return {
        filename: `hse-actions-${stamp}.csv`,
        csv: toCsv(
          [
            "Action",
            "Type",
            "Title",
            "Priority",
            "Status",
            "Source",
            "Project",
            "Assigned to",
            "Due",
            "Days overdue",
          ],
          data.map((row) => [
            row.actionNumber,
            actionTypeLabels[row.actionType],
            row.title,
            priorityLabels[row.priority],
            actionStatusLabels[row.status],
            row.source?.label ?? null,
            row.project?.code ?? null,
            row.assignedTo?.fullName ?? null,
            day(row.dueDate),
            row.daysOverdue,
          ]),
        ),
      };
    }

    case "toolbox-talks": {
      const { data } = await toolbox.listToolboxTalks(context, { ...queries.toolbox, ...cap });
      return {
        filename: `hse-toolbox-talks-${stamp}.csv`,
        csv: toCsv(
          [
            "Talk",
            "Title",
            "Topic",
            "Status",
            "Project",
            "Conducted by",
            "Date",
            "Location",
            "Attended",
            "Participants",
          ],
          data.map((row) => [
            row.talkNumber,
            row.title,
            row.topic,
            toolboxStatusLabels[row.status],
            row.project?.code ?? null,
            row.conductedBy?.fullName ?? null,
            day(row.talkDate),
            row.locationText,
            row.attendedCount,
            row.participantCount,
          ]),
        ),
      };
    }

    case "permits": {
      const { data } = await permits.listPermits(context, { ...queries.permits, ...cap });
      return {
        filename: `hse-permits-${stamp}.csv`,
        csv: toCsv(
          [
            "Permit",
            "Type",
            "Title",
            "Status",
            "Effective status",
            "Project",
            "Location",
            "Requested by",
            "Responsible",
            "Valid from",
            "Valid until",
          ],
          data.map((row) => [
            row.permitNumber,
            permitTypeLabels[row.permitType],
            row.title,
            permitStatusLabels[row.status],
            // Both columns: the stored one and the one the clock says, because
            // the difference is the whole point (§151, §360).
            permitStatusLabels[row.effectiveStatus],
            row.project.code,
            row.locationText,
            row.requestedBy?.fullName ?? null,
            row.responsible?.fullName ?? null,
            day(row.validFrom),
            day(row.validUntil),
          ]),
        ),
      };
    }

    case "environment": {
      const { data } = await environment.listObservations(context, {
        ...queries.environment,
        ...cap,
      });
      return {
        filename: `hse-environmental-${stamp}.csv`,
        csv: toCsv(
          [
            "Observation",
            "Category",
            "Title",
            "Severity",
            "Status",
            "Project",
            "Reported by",
            "Assigned to",
            "Observed",
            "Due",
            "Overdue",
          ],
          data.map((row) => [
            row.observationNumber,
            environmentalCategoryLabels[row.category],
            row.title,
            severityLabels[row.severity],
            environmentalStatusLabels[row.status],
            row.project?.code ?? null,
            row.reportedBy?.fullName ?? null,
            row.assignedTo?.fullName ?? null,
            day(row.observedAt),
            day(row.dueDate),
            yesNo(row.overdue),
          ]),
        ),
      };
    }
  }
}
