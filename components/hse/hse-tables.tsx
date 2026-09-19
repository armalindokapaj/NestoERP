import Link from "next/link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import {
  actionTypeLabels,
  environmentalCategoryLabels,
  hazardCategoryLabels,
  incidentTypeLabels,
  inspectionTypeLabels,
  permitTypeLabels,
  priorityLabels,
} from "@/lib/modules/hse/hse.status";
import { riskLevelLabels } from "@/lib/modules/hse/hse.risk";
import type {
  ActionSummaryDTO,
  HazardSummaryDTO,
  IncidentSummaryDTO,
  InspectionSummaryDTO,
  ObservationSummaryDTO,
  PermitSummaryDTO,
  PpeCheckDTO,
  RiskAssessmentSummaryDTO,
  StopWorkSummaryDTO,
  TemplateSummaryDTO,
  ToolboxSummaryDTO,
} from "@/lib/modules/hse/hse.types";
import { formatDate } from "@/lib/utils/format";
import { PermitClock, PermitStatusBadge, RiskBadge, SeverityBadge } from "./hse-format";

/**
 * The HSE lists (PRD #22 §290–§297).
 *
 * An inspection row carries both its status and its result, side by side,
 * because they answer different questions and the reader needs both (§37, §38).
 * A hazard row carries its risk as a level *and* a score, because "High" alone
 * does not tell you whether it is a 10 or a 16.
 */

function ProjectCell({ project }: { project: { code: string } | null }) {
  return project ? <>{project.code}</> : <span className="text-fg-subtle">Company</span>;
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export function InspectionTable({
  inspections,
  caption = "Safety inspections",
}: {
  inspections: InspectionSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<InspectionSummaryDTO>[] = [
    {
      key: "inspectionNumber",
      label: "Inspection",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.inspectionNumber}</span>
          <span className="text-meta text-fg-subtle">
            {inspectionTypeLabels[row.inspectionType]}
          </span>
        </span>
      ),
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "assignedInspector",
      label: "Inspector",
      hideBelow: "xl",
      render: (row) =>
        row.assignedInspector ? (
          <PersonLink memberId={row.assignedInspector.memberId} name={row.assignedInspector.fullName} />
        ) : (
          "—"
        ),
    },
    {
      key: "scheduledDate",
      label: "Scheduled",
      hideBelow: "lg",
      render: (row) =>
        row.scheduledDate ? formatDate(row.scheduledDate) : <span className="text-fg-subtle">—</span>,
    },
    // Two columns, deliberately: status is where it is, result is what was
    // found (PRD #22 §37, §38).
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "result",
      label: "Result",
      render: (row) =>
        row.result === "NOT_SET" ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <StatusBadge status={row.result} />
        ),
    },
    {
      key: "failedItemCount",
      label: "Failed",
      hideBelow: "xl",
      render: (row) =>
        row.failedItemCount > 0 ? (
          <span className="text-danger-strong">{row.failedItemCount}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      records={inspections}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/inspections/${row.id}`}
    />
  );
}

export function TemplateTable({ templates }: { templates: TemplateSummaryDTO[] }) {
  const columns: TableColumn<TemplateSummaryDTO>[] = [
    {
      key: "code",
      label: "Checklist",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.name}</span>
          <span className="text-meta text-fg-subtle">
            {row.code} · v{row.version}
          </span>
        </span>
      ),
    },
    {
      key: "inspectionType",
      label: "Type",
      hideBelow: "md",
      render: (row) => inspectionTypeLabels[row.inspectionType],
    },
    { key: "itemCount", label: "Items", hideBelow: "lg", render: (row) => row.itemCount },
    {
      key: "usageCount",
      label: "Used",
      hideBelow: "lg",
      // How many inspections depend on this version, which is what decides
      // whether editing it versions it (PRD #22 §349).
      render: (row) =>
        row.usageCount > 0 ? `${row.usageCount}×` : <span className="text-fg-subtle">Not yet</span>,
    },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      caption="Safety checklists"
      columns={columns}
      records={templates}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/templates/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Hazards                                                                     */
/* -------------------------------------------------------------------------- */

export function HazardTable({
  hazards,
  caption = "Hazards",
}: {
  hazards: HazardSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<HazardSummaryDTO>[] = [
    {
      key: "title",
      label: "Hazard",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">{row.hazardNumber}</span>
        </span>
      ),
    },
    {
      key: "hazardCategory",
      label: "Category",
      hideBelow: "xl",
      render: (row) => hazardCategoryLabels[row.hazardCategory],
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    { key: "risk", label: "Risk", render: (row) => <RiskBadge risk={row.risk} /> },
    {
      key: "residualRisk",
      label: "Residual",
      hideBelow: "xl",
      render: (row) =>
        row.residualRisk ? (
          <span className="text-fg-muted">
            {riskLevelLabels[row.residualRisk.level]} {row.residualRisk.score}
          </span>
        ) : (
          <span className="text-fg-subtle">Not assessed</span>
        ),
    },
    {
      key: "assignedTo",
      label: "Assigned to",
      hideBelow: "xl",
      render: (row) =>
        row.assignedTo ? (
          <PersonLink memberId={row.assignedTo.memberId} name={row.assignedTo.fullName} />
        ) : (
          <span className="text-warning-strong">Unassigned</span>
        ),
    },
    {
      key: "dueDate",
      label: "Due",
      hideBelow: "lg",
      render: (row) =>
        row.dueDate ? (
          <span className={row.overdue ? "text-danger-strong" : undefined}>
            {formatDate(row.dueDate)}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      records={hazards}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/hazards/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

export function IncidentTable({
  incidents,
  caption = "Incidents",
}: {
  incidents: IncidentSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<IncidentSummaryDTO>[] = [
    {
      key: "title",
      label: "Incident",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">
            {row.incidentNumber} · {incidentTypeLabels[row.incidentType]}
          </span>
        </span>
      ),
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "severity",
      label: "Severity",
      render: (row) => <SeverityBadge severity={row.severity} />,
    },
    {
      key: "occurredAt",
      label: "Occurred",
      hideBelow: "lg",
      render: (row) => formatDate(row.occurredAt),
    },
    {
      key: "injury",
      label: "Injury",
      hideBelow: "xl",
      // Blank when the reader may not see them, never "No" (PRD #22 §22).
      render: (row) =>
        row.injury === null ? (
          <span className="text-fg-subtle">—</span>
        ) : row.injury.injuryOccurred ? (
          <Badge tone="danger">Yes</Badge>
        ) : (
          <span className="text-fg-subtle">No</span>
        ),
    },
    {
      key: "investigator",
      label: "Investigator",
      hideBelow: "xl",
      render: (row) =>
        row.investigator ? (
          <PersonLink memberId={row.investigator.memberId} name={row.investigator.fullName} />
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      records={incidents}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/incidents/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Risk assessments                                                            */
/* -------------------------------------------------------------------------- */

export function RiskAssessmentTable({
  assessments,
  caption = "Risk assessments",
}: {
  assessments: RiskAssessmentSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<RiskAssessmentSummaryDTO>[] = [
    {
      key: "title",
      label: "Assessment",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">
            {row.assessmentNumber} · v{row.version}
          </span>
        </span>
      ),
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "highestRisk",
      label: "Highest risk",
      render: (row) =>
        row.highestRisk ? (
          <Badge
            tone={
              row.highestRisk === "CRITICAL"
                ? "danger"
                : row.highestRisk === "HIGH"
                  ? "warning"
                  : "neutral"
            }
          >
            {riskLevelLabels[row.highestRisk]}
          </Badge>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "itemCount", label: "Lines", hideBelow: "xl", render: (row) => row.itemCount },
    {
      key: "reviewDate",
      label: "Review",
      hideBelow: "lg",
      render: (row) =>
        row.reviewDate ? (
          // Flagged, never invalidated: a person decides (PRD #22 §359).
          <span className={row.reviewDue ? "text-warning-strong" : undefined}>
            {formatDate(row.reviewDate)}
            {row.reviewDue ? " · due" : ""}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      records={assessments}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/risk-assessments/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export function ActionTable({
  actions,
  caption = "HSE actions",
}: {
  actions: ActionSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<ActionSummaryDTO>[] = [
    {
      key: "title",
      label: "Action",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">
            {row.actionNumber} · {actionTypeLabels[row.actionType]}
          </span>
        </span>
      ),
    },
    {
      key: "source",
      label: "Source",
      hideBelow: "xl",
      // The reference always; the link only where the reader may follow it
      // (PRD #22 §187).
      render: (row) =>
        row.source ? (
          row.source.href ? (
            <Link href={row.source.href} className="text-accent hover:underline">
              {row.source.label}
            </Link>
          ) : (
            <span>{row.source.label}</span>
          )
        ) : (
          <span className="text-fg-subtle">Standalone</span>
        ),
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "priority",
      label: "Priority",
      hideBelow: "lg",
      render: (row) => (
        <Badge
          tone={
            row.priority === "CRITICAL"
              ? "danger"
              : row.priority === "HIGH"
                ? "warning"
                : "neutral"
          }
        >
          {priorityLabels[row.priority]}
        </Badge>
      ),
    },
    {
      key: "assignedTo",
      label: "Assigned to",
      hideBelow: "xl",
      render: (row) =>
        row.assignedTo ? (
          <PersonLink memberId={row.assignedTo.memberId} name={row.assignedTo.fullName} />
        ) : (
          "—"
        ),
    },
    {
      key: "dueDate",
      label: "Due",
      hideBelow: "lg",
      render: (row) =>
        row.dueDate ? (
          <span className={row.overdue ? "text-danger-strong" : undefined}>
            {formatDate(row.dueDate)}
            {row.daysOverdue > 0 ? ` · ${row.daysOverdue}d` : ""}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      records={actions}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/actions/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbox talks                                                               */
/* -------------------------------------------------------------------------- */

export function ToolboxTable({
  talks,
  caption = "Toolbox talks",
}: {
  talks: ToolboxSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<ToolboxSummaryDTO>[] = [
    {
      key: "title",
      label: "Talk",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">
            {row.talkNumber} · {row.topic}
          </span>
        </span>
      ),
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "talkDate",
      label: "Date",
      hideBelow: "lg",
      render: (row) => formatDate(row.talkDate),
    },
    {
      key: "conductedBy",
      label: "Conducted by",
      hideBelow: "xl",
      render: (row) =>
        row.conductedBy ? (
          <PersonLink memberId={row.conductedBy.memberId} name={row.conductedBy.fullName} />
        ) : (
          "—"
        ),
    },
    {
      key: "attendedCount",
      label: "Attended",
      render: (row) => `${row.attendedCount} / ${row.participantCount}`,
    },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      records={talks}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/toolbox-talks/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Permits                                                                     */
/* -------------------------------------------------------------------------- */

export function PermitTable({
  permits,
  caption = "Work permits",
}: {
  permits: PermitSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<PermitSummaryDTO>[] = [
    {
      key: "title",
      label: "Permit",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">
            {row.permitNumber} · {permitTypeLabels[row.permitType]}
          </span>
        </span>
      ),
    },
    { key: "project", label: "Project", hideBelow: "md", render: (row) => row.project.code },
    { key: "locationText", label: "Location", hideBelow: "xl", render: (row) => row.locationText },
    {
      key: "responsible",
      label: "Responsible",
      hideBelow: "xl",
      render: (row) => {
        const person = row.responsible ?? row.requestedBy;
        return person ? <PersonLink memberId={person.memberId} name={person.fullName} /> : "—";
      },
    },
    {
      key: "validUntil",
      label: "Valid until",
      hideBelow: "lg",
      render: (row) => (
        <span className="flex flex-col">
          <span>{formatDate(row.validUntil)}</span>
          <span className="text-meta">
            <PermitClock hoursRemaining={row.hoursRemaining} />
          </span>
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <PermitStatusBadge status={row.status} effectiveStatus={row.effectiveStatus} />
      ),
    },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      records={permits}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/permits/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* PPE                                                                         */
/* -------------------------------------------------------------------------- */

export function PpeTable({
  checks,
  canEdit = false,
}: {
  checks: PpeCheckDTO[];
  canEdit?: boolean;
}) {
  const columns: TableColumn<PpeCheckDTO>[] = [
    {
      key: "checkNumber",
      label: "Check",
      primary: true,
      render: (row) =>
        canEdit ? (
          <Link href={`/hse/ppe/${row.id}/edit`} className="flex flex-col hover:text-accent">
            <span className="font-medium text-fg">{row.checkNumber}</span>
            <span className="text-meta text-fg-subtle">
              {row.subject?.fullName ?? row.subjectWorker?.name ?? row.externalSubjectName ?? "Area spot check"}
            </span>
          </Link>
        ) : (
          <span className="flex flex-col">
            <span className="font-medium text-fg">{row.checkNumber}</span>
            <span className="text-meta text-fg-subtle">
              {row.subject ? (
                <PersonLink memberId={row.subject.memberId} name={row.subject.fullName} />
              ) : row.subjectWorker ? (
                <PersonLink personId={row.subjectWorker.personId} name={row.subjectWorker.name} />
              ) : (
                row.externalSubjectName ?? "Area spot check"
              )}
            </span>
          </span>
        ),
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "checkDate",
      label: "Date",
      hideBelow: "lg",
      render: (row) => formatDate(row.checkDate),
    },
    {
      key: "checkedBy",
      label: "Checked by",
      hideBelow: "xl",
      render: (row) =>
        row.checkedBy ? (
          <PersonLink memberId={row.checkedBy.memberId} name={row.checkedBy.fullName} />
        ) : (
          "—"
        ),
    },
    {
      key: "failedItems",
      label: "Failed",
      hideBelow: "lg",
      render: (row) =>
        row.failedItems.length > 0 ? (
          <span className="text-danger-strong">{row.failedItems.join(", ")}</span>
        ) : (
          <span className="text-fg-subtle">None</span>
        ),
    },
    { key: "result", label: "Result", render: (row) => <StatusBadge status={row.result} /> },
  ];

  return (
    <DataTable caption="PPE checks" columns={columns} records={checks} rowKey={(row) => row.id} />
  );
}

/* -------------------------------------------------------------------------- */
/* Environment                                                                 */
/* -------------------------------------------------------------------------- */

export function ObservationTable({
  observations,
  caption = "Environmental observations",
}: {
  observations: ObservationSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<ObservationSummaryDTO>[] = [
    {
      key: "title",
      label: "Observation",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">
            {row.observationNumber} · {environmentalCategoryLabels[row.category]}
          </span>
        </span>
      ),
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "severity",
      label: "Severity",
      render: (row) => <SeverityBadge severity={row.severity} />,
    },
    {
      key: "assignedTo",
      label: "Assigned to",
      hideBelow: "xl",
      render: (row) =>
        row.assignedTo ? (
          <PersonLink memberId={row.assignedTo.memberId} name={row.assignedTo.fullName} />
        ) : (
          <span className="text-warning-strong">Unassigned</span>
        ),
    },
    {
      key: "dueDate",
      label: "Due",
      hideBelow: "lg",
      render: (row) =>
        row.dueDate ? (
          <span className={row.overdue ? "text-danger-strong" : undefined}>
            {formatDate(row.dueDate)}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      records={observations}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/environment/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

export function StopWorkTable({
  records,
  caption = "Stop-work records",
}: {
  records: StopWorkSummaryDTO[];
  caption?: string;
}) {
  const columns: TableColumn<StopWorkSummaryDTO>[] = [
    {
      key: "title",
      label: "Stop work",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">{row.stopWorkNumber}</span>
        </span>
      ),
    },
    { key: "project", label: "Project", hideBelow: "md", render: (row) => row.project.code },
    {
      key: "issuedAt",
      label: "Issued",
      hideBelow: "lg",
      render: (row) => formatDate(row.issuedAt),
    },
    {
      key: "issuedBy",
      label: "Issued by",
      hideBelow: "xl",
      render: (row) =>
        row.issuedBy ? (
          <PersonLink memberId={row.issuedBy.memberId} name={row.issuedBy.fullName} />
        ) : (
          "—"
        ),
    },
    {
      key: "releasedAt",
      label: "Released",
      hideBelow: "lg",
      render: (row) =>
        row.releasedAt ? formatDate(row.releasedAt) : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "status",
      label: "Status",
      // ACTIVE reads as danger here and nowhere else: work has been halted
      // (PRD #22 §331).
      render: (row) =>
        row.status === "ACTIVE" ? (
          <Badge tone="danger">Active</Badge>
        ) : (
          <StatusBadge status={row.status} />
        ),
    },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      records={records}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/stop-work/${row.id}`}
    />
  );
}
