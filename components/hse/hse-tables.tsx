import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn, type TableSortConfig } from "@/components/data/data-table";
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
import { getTranslations } from "@/lib/i18n/server";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { HseText } from "./hse-text";
import { PermitClock, PermitStatusBadge, RiskBadge, SeverityBadge } from "./hse-format";

/**
 * The HSE lists (PRD #22 §290–§297).
 *
 * An inspection row carries both its status and its result, side by side,
 * because they answer different questions and the reader needs both (§37, §38).
 * A hazard row carries its risk as a level *and* a score, because "High" alone
 * does not tell you whether it is a 10 or a 16.
 *
 * Column metadata (AUD-08 §5): each table's identity column (the primary) and
 * its status stay visible; every other column may be hidden in the Columns
 * control when a page names the list (`listId`). Header sorts appear only where
 * a page passes `sort` — the server-parsed sort of the rows on screen — and
 * only on columns whose order is one of the list's allowlisted sorts. Record
 * child tables (an incident's actions) pass neither and render as before.
 */

/** Presentation props every HSE table takes (AUD-08 §5). */
type ListProps = {
  /** `hse.<list>` or `projects.hse-<list>`: turns on the Columns control. */
  listId?: string;
  /** The applied sort and the list's allowlist; header sorts only when given. */
  sort?: TableSortConfig;
};

type ColumnMeta = Pick<TableColumn<unknown>, "mandatory" | "valueType" | "defaultHidden" | "sortKey">;

/**
 * Lays each column's presentation metadata over its definition by key
 * (AUD-08 §5): a stable id (the key), the mandatory flag, the value type and —
 * only when the page passed a sort — the allowlisted sort stem. Keeping it in
 * one table per list keeps the render functions free of preference plumbing.
 */
function withMeta<T>(
  columns: TableColumn<T>[],
  sort: TableSortConfig | undefined,
  meta: Record<string, ColumnMeta>,
): TableColumn<T>[] {
  return columns.map((column) => {
    const extra = meta[column.key];
    if (!extra) return { ...column, id: column.key };
    const { sortKey, ...rest } = extra;
    return { ...column, id: column.key, ...rest, ...(sort && sortKey ? { sortKey } : {}) };
  });
}

const STATUS: ColumnMeta = { mandatory: true, valueType: "status" };

const INSPECTION_COLUMNS: Record<string, ColumnMeta> = {
  inspectionNumber: { sortKey: "number" },
  scheduledDate: { valueType: "date", sortKey: "scheduled" },
  status: STATUS,
  result: STATUS,
  failedItemCount: { valueType: "number" },
};

const TEMPLATE_COLUMNS: Record<string, ColumnMeta> = {
  code: { sortKey: "name" },
  itemCount: { valueType: "number" },
  usageCount: { valueType: "number" },
  status: STATUS,
};

const HAZARD_COLUMNS: Record<string, ColumnMeta> = {
  risk: { valueType: "number", sortKey: "risk" },
  dueDate: { valueType: "date", sortKey: "due" },
  status: STATUS,
};

const INCIDENT_COLUMNS: Record<string, ColumnMeta> = {
  severity: { valueType: "status", sortKey: "severity" },
  occurredAt: { valueType: "date", sortKey: "occurred" },
  status: STATUS,
};

const RISK_ASSESSMENT_COLUMNS: Record<string, ColumnMeta> = {
  highestRisk: { valueType: "status" },
  itemCount: { valueType: "number" },
  reviewDate: { valueType: "date", sortKey: "review" },
  status: STATUS,
};

const ACTION_COLUMNS: Record<string, ColumnMeta> = {
  priority: { valueType: "status", sortKey: "priority" },
  dueDate: { valueType: "date", sortKey: "due" },
  status: STATUS,
};

const TOOLBOX_COLUMNS: Record<string, ColumnMeta> = {
  talkDate: { valueType: "date", sortKey: "date" },
  attendedCount: { valueType: "number" },
  status: STATUS,
};

const PERMIT_COLUMNS: Record<string, ColumnMeta> = {
  validUntil: { valueType: "datetime", sortKey: "expiry" },
  status: STATUS,
};

const PPE_COLUMNS: Record<string, ColumnMeta> = {
  checkNumber: { sortKey: "number" },
  checkDate: { valueType: "date", sortKey: "recent" },
  result: STATUS,
};

const OBSERVATION_COLUMNS: Record<string, ColumnMeta> = {
  severity: { valueType: "status" },
  dueDate: { valueType: "date" },
  status: STATUS,
};

const STOP_WORK_COLUMNS: Record<string, ColumnMeta> = {
  issuedAt: { valueType: "date", sortKey: "issued" },
  releasedAt: { valueType: "date" },
  status: STATUS,
};

function ProjectCell({ project }: { project: { code: string } | null }) {
  return project ? <>{project.code}</> : <span className="text-fg-subtle"><HseText k="table.company" /></span>;
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export async function InspectionTable({
  listId,
  sort,
  inspections,
  caption,
}: ListProps & {
  inspections: InspectionSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("hse");
  const columns: TableColumn<InspectionSummaryDTO>[] = [
    {
      key: "inspectionNumber",
      label: t("table.col.inspection"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.inspectionNumber}</span>
          <span className="text-meta text-fg-subtle">
            {hseLabel(t, "inspectionType", row.inspectionType, inspectionTypeLabels[row.inspectionType])}
          </span>
        </span>
      ),
    },
    {
      key: "project",
      label: t("table.col.project"),
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "assignedInspector",
      label: t("table.col.inspector"),
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
      label: t("table.col.scheduled"),
      hideBelow: "lg",
      render: (row) =>
        row.scheduledDate ? formatDate(row.scheduledDate) : <span className="text-fg-subtle">—</span>,
    },
    // Two columns, deliberately: status is where it is, result is what was
    // found (PRD #22 §37, §38).
    { key: "status", label: t("table.col.status"), render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "result",
      label: t("table.col.result"),
      render: (row) =>
        row.result === "NOT_SET" ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <StatusBadge status={row.result} />
        ),
    },
    {
      key: "failedItemCount",
      label: t("table.col.failed"),
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
      listId={listId}
      sort={sort}
      caption={caption ?? t("table.caption.inspections")}
      columns={withMeta(columns, sort, INSPECTION_COLUMNS)}
      records={inspections}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/inspections/${row.id}`}
    />
  );
}

export async function TemplateTable({
  templates,
  listId,
  sort,
}: ListProps & { templates: TemplateSummaryDTO[] }) {
  const t = await getTranslations("hse");
  const columns: TableColumn<TemplateSummaryDTO>[] = [
    {
      key: "code",
      label: t("table.col.checklist"),
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
      label: t("table.col.type"),
      hideBelow: "md",
      render: (row) => hseLabel(t, "inspectionType", row.inspectionType, inspectionTypeLabels[row.inspectionType]),
    },
    { key: "itemCount", label: t("table.col.items"), hideBelow: "lg", render: (row) => row.itemCount },
    {
      key: "usageCount",
      label: t("table.col.used"),
      hideBelow: "lg",
      // How many inspections depend on this version, which is what decides
      // whether editing it versions it (PRD #22 §349).
      render: (row) =>
        row.usageCount > 0 ? `${row.usageCount}×` : <span className="text-fg-subtle">{t("table.notYet")}</span>,
    },
    { key: "status", label: t("table.col.status"), render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={t("table.caption.templates")}
      columns={withMeta(columns, sort, TEMPLATE_COLUMNS)}
      records={templates}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/templates/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Hazards                                                                     */
/* -------------------------------------------------------------------------- */

export async function HazardTable({
  listId,
  sort,
  hazards,
  caption,
}: ListProps & {
  hazards: HazardSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("hse");
  const columns: TableColumn<HazardSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.col.hazard"),
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
      label: t("table.col.category"),
      hideBelow: "xl",
      render: (row) => hseLabel(t, "hazardCategory", row.hazardCategory, hazardCategoryLabels[row.hazardCategory]),
    },
    {
      key: "project",
      label: t("table.col.project"),
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    { key: "risk", label: t("table.col.risk"), render: (row) => <RiskBadge risk={row.risk} /> },
    {
      key: "residualRisk",
      label: t("table.col.residual"),
      hideBelow: "xl",
      render: (row) =>
        row.residualRisk ? (
          <span className="text-fg-muted">
            {hseLabel(t, "riskLevel", row.residualRisk.level, riskLevelLabels[row.residualRisk.level])} {row.residualRisk.score}
          </span>
        ) : (
          <span className="text-fg-subtle">{t("table.notAssessed")}</span>
        ),
    },
    {
      key: "assignedTo",
      label: t("table.col.assignedTo"),
      hideBelow: "xl",
      render: (row) =>
        row.assignedTo ? (
          <PersonLink memberId={row.assignedTo.memberId} name={row.assignedTo.fullName} />
        ) : (
          <span className="text-warning-strong">{t("table.unassigned")}</span>
        ),
    },
    {
      key: "dueDate",
      label: t("table.col.due"),
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
    { key: "status", label: t("table.col.status"), render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={caption ?? t("table.caption.hazards")}
      columns={withMeta(columns, sort, HAZARD_COLUMNS)}
      records={hazards}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/hazards/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

export async function IncidentTable({
  listId,
  sort,
  incidents,
  caption,
}: ListProps & {
  incidents: IncidentSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("hse");
  const columns: TableColumn<IncidentSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.col.incident"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">
            {row.incidentNumber} · {hseLabel(t, "incidentType", row.incidentType, incidentTypeLabels[row.incidentType])}
          </span>
        </span>
      ),
    },
    {
      key: "project",
      label: t("table.col.project"),
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "severity",
      label: t("table.col.severity"),
      render: (row) => <SeverityBadge severity={row.severity} />,
    },
    {
      key: "occurredAt",
      label: t("table.col.occurred"),
      hideBelow: "lg",
      render: (row) => formatDate(row.occurredAt),
    },
    {
      key: "injury",
      label: t("table.col.injury"),
      hideBelow: "xl",
      // Blank when the reader may not see them, never "No" (PRD #22 §22).
      render: (row) =>
        row.injury === null ? (
          <span className="text-fg-subtle">—</span>
        ) : row.injury.injuryOccurred ? (
          <Badge tone="danger">{t("table.yes")}</Badge>
        ) : (
          <span className="text-fg-subtle">{t("table.no")}</span>
        ),
    },
    {
      key: "investigator",
      label: t("table.col.investigator"),
      hideBelow: "xl",
      render: (row) =>
        row.investigator ? (
          <PersonLink memberId={row.investigator.memberId} name={row.investigator.fullName} />
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "status", label: t("table.col.status"), render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={caption ?? t("table.caption.incidents")}
      columns={withMeta(columns, sort, INCIDENT_COLUMNS)}
      records={incidents}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/incidents/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Risk assessments                                                            */
/* -------------------------------------------------------------------------- */

export async function RiskAssessmentTable({
  listId,
  sort,
  assessments,
  caption,
}: ListProps & {
  assessments: RiskAssessmentSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("hse");
  const columns: TableColumn<RiskAssessmentSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.col.assessment"),
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
      label: t("table.col.project"),
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "highestRisk",
      label: t("table.col.highestRisk"),
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
            {hseLabel(t, "riskLevel", row.highestRisk, riskLevelLabels[row.highestRisk])}
          </Badge>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "itemCount", label: t("table.col.lines"), hideBelow: "xl", render: (row) => row.itemCount },
    {
      key: "reviewDate",
      label: t("table.col.review"),
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
    { key: "status", label: t("table.col.status"), render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={caption ?? t("table.caption.riskAssessments")}
      columns={withMeta(columns, sort, RISK_ASSESSMENT_COLUMNS)}
      records={assessments}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/risk-assessments/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export async function ActionTable({
  listId,
  sort,
  actions,
  caption,
}: ListProps & {
  actions: ActionSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("hse");
  const columns: TableColumn<ActionSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.col.action"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">
            {row.actionNumber} · {hseLabel(t, "actionType", row.actionType, actionTypeLabels[row.actionType])}
          </span>
        </span>
      ),
    },
    {
      key: "source",
      label: t("table.col.source"),
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
          <span className="text-fg-subtle">{t("table.standalone")}</span>
        ),
    },
    {
      key: "project",
      label: t("table.col.project"),
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "priority",
      label: t("table.col.priority"),
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
          {hseLabel(t, "priority", row.priority, priorityLabels[row.priority])}
        </Badge>
      ),
    },
    {
      key: "assignedTo",
      label: t("table.col.assignedTo"),
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
      label: t("table.col.due"),
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
    { key: "status", label: t("table.col.status"), render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={caption ?? t("table.caption.actions")}
      columns={withMeta(columns, sort, ACTION_COLUMNS)}
      records={actions}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/actions/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbox talks                                                               */
/* -------------------------------------------------------------------------- */

export async function ToolboxTable({
  listId,
  sort,
  talks,
  caption,
}: ListProps & {
  talks: ToolboxSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("hse");
  const columns: TableColumn<ToolboxSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.col.talk"),
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
      label: t("table.col.project"),
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "talkDate",
      label: t("table.col.date"),
      hideBelow: "lg",
      render: (row) => formatDate(row.talkDate),
    },
    {
      key: "conductedBy",
      label: t("table.col.conductedBy"),
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
      label: t("table.col.attended"),
      render: (row) => `${row.attendedCount} / ${row.participantCount}`,
    },
    { key: "status", label: t("table.col.status"), render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={caption ?? t("table.caption.toolbox")}
      columns={withMeta(columns, sort, TOOLBOX_COLUMNS)}
      records={talks}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/toolbox-talks/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Permits                                                                     */
/* -------------------------------------------------------------------------- */

export async function PermitTable({
  listId,
  sort,
  permits,
  caption,
}: ListProps & {
  permits: PermitSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("hse");
  const columns: TableColumn<PermitSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.col.permit"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">
            {row.permitNumber} · {hseLabel(t, "permitType", row.permitType, permitTypeLabels[row.permitType])}
          </span>
        </span>
      ),
    },
    { key: "project", label: t("table.col.project"), hideBelow: "md", render: (row) => row.project.code },
    { key: "locationText", label: t("table.col.location"), hideBelow: "xl", render: (row) => row.locationText },
    {
      key: "responsible",
      label: t("table.col.responsible"),
      hideBelow: "xl",
      render: (row) => {
        const person = row.responsible ?? row.requestedBy;
        return person ? <PersonLink memberId={person.memberId} name={person.fullName} /> : "—";
      },
    },
    {
      key: "validUntil",
      label: t("table.col.validUntil"),
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
      label: t("table.col.status"),
      render: (row) => (
        <PermitStatusBadge status={row.status} effectiveStatus={row.effectiveStatus} />
      ),
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={caption ?? t("table.caption.permits")}
      columns={withMeta(columns, sort, PERMIT_COLUMNS)}
      records={permits}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/permits/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* PPE                                                                         */
/* -------------------------------------------------------------------------- */

export async function PpeTable({
  listId,
  sort,
  checks,
  canEdit = false,
}: ListProps & {
  checks: PpeCheckDTO[];
  canEdit?: boolean;
}) {
  const t = await getTranslations("hse");
  const columns: TableColumn<PpeCheckDTO>[] = [
    {
      key: "checkNumber",
      label: t("table.col.check"),
      primary: true,
      render: (row) =>
        canEdit ? (
          <Link href={`/hse/ppe/${row.id}/edit`} className="flex flex-col hover:text-accent">
            <span className="font-medium text-fg">{row.checkNumber}</span>
            <span className="text-meta text-fg-subtle">
              {row.subject?.fullName ?? row.subjectWorker?.name ?? row.externalSubjectName ?? t("table.areaSpotCheck")}
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
                row.externalSubjectName ?? t("table.areaSpotCheck")
              )}
            </span>
          </span>
        ),
    },
    {
      key: "project",
      label: t("table.col.project"),
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "checkDate",
      label: t("table.col.date"),
      hideBelow: "lg",
      render: (row) => formatDate(row.checkDate),
    },
    {
      key: "checkedBy",
      label: t("table.col.checkedBy"),
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
      label: t("table.col.failed"),
      hideBelow: "lg",
      render: (row) =>
        row.failedItems.length > 0 ? (
          <span className="text-danger-strong">{row.failedItems.join(", ")}</span>
        ) : (
          <span className="text-fg-subtle">{t("table.none")}</span>
        ),
    },
    { key: "result", label: t("table.col.result"), render: (row) => <StatusBadge status={row.result} /> },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={t("table.caption.ppe")}
      columns={withMeta(columns, sort, PPE_COLUMNS)}
      records={checks}
      rowKey={(row) => row.id}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Environment                                                                 */
/* -------------------------------------------------------------------------- */

export async function ObservationTable({
  listId,
  sort,
  observations,
  caption,
}: ListProps & {
  observations: ObservationSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("hse");
  const columns: TableColumn<ObservationSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.col.observation"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">
            {row.observationNumber} · {hseLabel(t, "environmentalCategory", row.category, environmentalCategoryLabels[row.category])}
          </span>
        </span>
      ),
    },
    {
      key: "project",
      label: t("table.col.project"),
      hideBelow: "md",
      render: (row) => <ProjectCell project={row.project} />,
    },
    {
      key: "severity",
      label: t("table.col.severity"),
      render: (row) => <SeverityBadge severity={row.severity} />,
    },
    {
      key: "assignedTo",
      label: t("table.col.assignedTo"),
      hideBelow: "xl",
      render: (row) =>
        row.assignedTo ? (
          <PersonLink memberId={row.assignedTo.memberId} name={row.assignedTo.fullName} />
        ) : (
          <span className="text-warning-strong">{t("table.unassigned")}</span>
        ),
    },
    {
      key: "dueDate",
      label: t("table.col.due"),
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
    { key: "status", label: t("table.col.status"), render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={caption ?? t("table.caption.observations")}
      columns={withMeta(columns, sort, OBSERVATION_COLUMNS)}
      records={observations}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/environment/${row.id}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

export async function StopWorkTable({
  listId,
  sort,
  records,
  caption,
}: ListProps & {
  records: StopWorkSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("hse");
  const columns: TableColumn<StopWorkSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.col.stopWork"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">{row.stopWorkNumber}</span>
        </span>
      ),
    },
    { key: "project", label: t("table.col.project"), hideBelow: "md", render: (row) => row.project.code },
    {
      key: "issuedAt",
      label: t("table.col.issued"),
      hideBelow: "lg",
      render: (row) => formatDate(row.issuedAt),
    },
    {
      key: "issuedBy",
      label: t("table.col.issuedBy"),
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
      label: t("table.col.released"),
      hideBelow: "lg",
      render: (row) =>
        row.releasedAt ? formatDate(row.releasedAt) : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "status",
      label: t("table.col.status"),
      // ACTIVE reads as danger here and nowhere else: work has been halted
      // (PRD #22 §331).
      render: (row) =>
        row.status === "ACTIVE" ? (
          <Badge tone="danger">{t("table.active")}</Badge>
        ) : (
          <StatusBadge status={row.status} />
        ),
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={caption ?? t("table.caption.stopWork")}
      columns={withMeta(columns, sort, STOP_WORK_COLUMNS)}
      records={records}
      rowKey={(row) => row.id}
      rowHref={(row) => `/hse/stop-work/${row.id}`}
    />
  );
}
