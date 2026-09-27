import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn, type TableSortConfig } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "@/lib/i18n/server";
import { qaqcLabel } from "./qaqc-labels";
import type {
  CorrectiveActionSummaryDTO,
  DefectSummaryDTO,
  InspectionSummaryDTO,
  NcrSummaryDTO,
  RequestSummaryDTO,
  TemplateSummaryDTO,
} from "@/lib/modules/qaqc/qaqc.types";
import { formatDate } from "@/lib/utils/format";
import { ResultBadge, SeverityBadge } from "./qaqc-format";

/**
 * The QA/QC lists (PRD #21 §39, §63, §115, §127, §143).
 *
 * An inspection row carries both its status and its result, side by side,
 * because they answer different questions and the reader needs both (§65).
 *
 * Column metadata (AUD-08 §5): each table's identity column (the primary) and
 * its status stay visible; every other column may be hidden in the Columns
 * control when a page names the list (`listId`). Header sorts appear only where
 * a page passes `sort` — the server-parsed sort of the rows on screen — and
 * only on columns whose order is one of the list's allowlisted sorts. Record
 * child tables (an NCR's corrective actions) pass neither and render as before.
 */

/** Presentation props every QA/QC table takes (AUD-08 §5). */
type ListProps = {
  /** `qaqc.<list>` or `projects.qaqc-<list>`: turns on the Columns control. */
  listId?: string;
  /** The applied sort and the list's allowlist; header sorts only when given. */
  sort?: TableSortConfig;
};

type ColumnMeta = Pick<TableColumn<unknown>, "mandatory" | "valueType" | "defaultHidden" | "sortKey">;

/**
 * Lays each column's presentation metadata over its definition by key
 * (AUD-08 §5): a stable id (the key), the mandatory flag, the value type and —
 * only when the page passed a sort — the allowlisted sort stem.
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

const REQUEST_COLUMNS: Record<string, ColumnMeta> = {
  requiredByDate: { valueType: "date", sortKey: "required" },
  priority: { valueType: "status", sortKey: "priority" },
  status: STATUS,
};

const INSPECTION_COLUMNS: Record<string, ColumnMeta> = {
  inspectionNumber: { sortKey: "number" },
  inspectionDate: { valueType: "date", sortKey: "date" },
  status: STATUS,
  result: STATUS,
};

const TEMPLATE_COLUMNS: Record<string, ColumnMeta> = {
  name: { sortKey: "name" },
  itemCount: { valueType: "number" },
  usageCount: { valueType: "number" },
  status: STATUS,
};

const DEFECT_COLUMNS: Record<string, ColumnMeta> = {
  dueDate: { valueType: "date", sortKey: "due" },
  severity: { valueType: "status", sortKey: "severity" },
  status: STATUS,
};

const NCR_COLUMNS: Record<string, ColumnMeta> = {
  openActions: { valueType: "number" },
  dueDate: { valueType: "date", sortKey: "due" },
  severity: { valueType: "status", sortKey: "severity" },
  status: STATUS,
};

const CORRECTIVE_ACTION_COLUMNS: Record<string, ColumnMeta> = {
  dueDate: { valueType: "date", sortKey: "due" },
  status: STATUS,
};

export async function RequestTable({
  listId,
  sort,
  requests,
  caption,
}: ListProps & {
  requests: RequestSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("qaqc");
  const columns: TableColumn<RequestSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.request"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">{row.requestNumber}</span>
        </span>
      ),
    },
    {
      key: "inspectionType",
      label: t("table.type"),
      hideBelow: "lg",
      render: (row) => qaqcLabel(t, "inspectionType", row.inspectionType),
    },
    {
      key: "project",
      label: t("table.project"),
      hideBelow: "md",
      render: (row) =>
        row.project ? row.project.code : <span className="text-fg-subtle">{t("common.company")}</span>,
    },
    {
      key: "assignedInspector",
      label: t("table.inspector"),
      hideBelow: "xl",
      render: (row) =>
        row.assignedInspector ? (
          <PersonLink memberId={row.assignedInspector.memberId} name={row.assignedInspector.fullName} />
        ) : (
          <span className="text-warning-strong">{t("common.unassigned")}</span>
        ),
    },
    {
      key: "requiredByDate",
      label: t("table.neededBy"),
      hideBelow: "lg",
      render: (row) =>
        row.requiredByDate ? (
          <span className={row.overdue ? "text-danger-strong" : undefined}>
            {formatDate(row.requiredByDate)}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "priority",
      label: t("table.priority"),
      hideBelow: "xl",
      render: (row) => qaqcLabel(t, "priority", row.priority),
    },
    {
      key: "status",
      label: t("table.status"),
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      columns={withMeta(columns, sort, REQUEST_COLUMNS)}
      records={requests}
      rowKey={(row) => row.id}
      rowHref={(row) => `/qaqc/requests/${row.id}`}
      caption={caption ?? t("table.requestsCaption")}
    />
  );
}

export async function InspectionTable({
  listId,
  sort,
  inspections,
  caption,
}: ListProps & {
  inspections: InspectionSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("qaqc");
  const columns: TableColumn<InspectionSummaryDTO>[] = [
    {
      key: "inspectionNumber",
      label: t("table.inspection"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="flex flex-wrap items-center gap-1.5 font-medium text-fg">
            {row.inspectionNumber}
            {row.reinspectionSequence ? (
              <Badge tone="info">{t("common.reinspectionN", { n: row.reinspectionSequence })}</Badge>
            ) : null}
          </span>
          <span className="text-meta text-fg-subtle">
            {row.templateName ?? qaqcLabel(t, "inspectionType", row.inspectionType)}
          </span>
        </span>
      ),
    },
    {
      key: "project",
      label: t("table.project"),
      hideBelow: "md",
      render: (row) =>
        row.project ? row.project.code : <span className="text-fg-subtle">{t("common.company")}</span>,
    },
    {
      key: "assignedInspector",
      label: t("table.inspector"),
      hideBelow: "xl",
      render: (row) =>
        row.assignedInspector ? (
          <PersonLink memberId={row.assignedInspector.memberId} name={row.assignedInspector.fullName} />
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "inspectionDate",
      label: t("table.date"),
      hideBelow: "lg",
      render: (row) =>
        row.inspectionDate ? formatDate(row.inspectionDate) : <span className="text-fg-subtle">—</span>,
    },
    {
      // Two columns on purpose: where it is, and what was found (§65).
      key: "status",
      label: t("table.status"),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "result",
      label: t("table.result"),
      render: (row) => <ResultBadge result={row.result} />,
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      columns={withMeta(columns, sort, INSPECTION_COLUMNS)}
      records={inspections}
      rowKey={(row) => row.id}
      rowHref={(row) => `/qaqc/inspections/${row.id}`}
      caption={caption ?? t("table.inspectionsCaption")}
    />
  );
}

export async function TemplateTable({
  listId,
  sort,
  templates,
  caption,
}: ListProps & {
  templates: TemplateSummaryDTO[];
  caption?: string;
}) {
  const t = await getTranslations("qaqc");
  const columns: TableColumn<TemplateSummaryDTO>[] = [
    {
      key: "name",
      label: t("table.template"),
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
      label: t("table.type"),
      hideBelow: "md",
      render: (row) => qaqcLabel(t, "inspectionType", row.inspectionType),
    },
    {
      key: "itemCount",
      label: t("table.checks"),
      align: "right",
      render: (row) => <span className="tabular-nums">{row.itemCount}</span>,
    },
    {
      key: "usageCount",
      label: t("table.used"),
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums">{row.usageCount}</span>,
    },
    {
      key: "status",
      label: t("table.status"),
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      columns={withMeta(columns, sort, TEMPLATE_COLUMNS)}
      records={templates}
      rowKey={(row) => row.id}
      rowHref={(row) => `/qaqc/templates/${row.id}`}
      caption={caption ?? t("table.templatesCaption")}
    />
  );
}

export async function DefectTable({
  listId,
  sort,
  defects,
  showProject = true,
  caption,
}: ListProps & {
  defects: DefectSummaryDTO[];
  showProject?: boolean;
  caption?: string;
}) {
  const t = await getTranslations("qaqc");
  const columns: TableColumn<DefectSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.defect"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">{row.defectNumber}</span>
        </span>
      ),
    },
  ];

  if (showProject) {
    columns.push({
      key: "project",
      label: t("table.project"),
      hideBelow: "md",
      render: (row) => row.project.code,
    });
  }

  columns.push(
    {
      key: "assignedTo",
      label: t("table.assignedTo"),
      hideBelow: "xl",
      render: (row) =>
        row.assignedTo ? (
          <PersonLink memberId={row.assignedTo.memberId} name={row.assignedTo.fullName} />
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "dueDate",
      label: t("table.due"),
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
    {
      key: "severity",
      label: t("table.severity"),
      render: (row) => <SeverityBadge severity={row.severity} />,
    },
    {
      key: "status",
      label: t("table.status"),
      render: (row) => <StatusBadge status={row.status} />,
    },
  );

  return (
    <DataTable
      listId={listId}
      sort={sort}
      columns={withMeta(columns, sort, DEFECT_COLUMNS)}
      records={defects}
      rowKey={(row) => row.id}
      rowHref={(row) => `/qaqc/defects/${row.id}`}
      caption={caption ?? t("table.defectsCaption")}
    />
  );
}

export async function NcrTable({
  listId,
  sort,
  ncrs,
  showProject = true,
  caption,
}: ListProps & {
  ncrs: NcrSummaryDTO[];
  showProject?: boolean;
  caption?: string;
}) {
  const t = await getTranslations("qaqc");
  const columns: TableColumn<NcrSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.ncr"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">{row.ncrNumber}</span>
        </span>
      ),
    },
    {
      key: "category",
      label: t("table.category"),
      hideBelow: "lg",
      render: (row) => qaqcLabel(t, "ncrCategory", row.category),
    },
  ];

  if (showProject) {
    columns.push({
      key: "project",
      label: t("table.project"),
      hideBelow: "md",
      render: (row) =>
        row.project ? row.project.code : <span className="text-fg-subtle">{t("common.company")}</span>,
    });
  }

  columns.push(
    {
      key: "openActions",
      label: t("table.openActions"),
      align: "right",
      hideBelow: "xl",
      render: (row) => <span className="tabular-nums">{row.openActions}</span>,
    },
    {
      key: "dueDate",
      label: t("table.due"),
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
    {
      key: "severity",
      label: t("table.severity"),
      render: (row) => <SeverityBadge severity={row.severity} />,
    },
    {
      key: "status",
      label: t("table.status"),
      render: (row) => <StatusBadge status={row.status} />,
    },
  );

  return (
    <DataTable
      listId={listId}
      sort={sort}
      columns={withMeta(columns, sort, NCR_COLUMNS)}
      records={ncrs}
      rowKey={(row) => row.id}
      rowHref={(row) => `/qaqc/ncrs/${row.id}`}
      caption={caption ?? t("table.ncrsCaption")}
    />
  );
}

export async function CorrectiveActionTable({
  listId,
  sort,
  actions,
  showParent = true,
  caption,
}: ListProps & {
  actions: CorrectiveActionSummaryDTO[];
  showParent?: boolean;
  caption?: string;
}) {
  const t = await getTranslations("qaqc");
  const columns: TableColumn<CorrectiveActionSummaryDTO>[] = [
    {
      key: "title",
      label: t("table.action"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.title}</span>
          <span className="text-meta text-fg-subtle">{row.actionNumber}</span>
        </span>
      ),
    },
  ];

  if (showParent) {
    columns.push({
      key: "parent",
      label: t("table.raisedAgainst"),
      hideBelow: "md",
      render: (row) => {
        if (!row.parent) return <span className="text-fg-subtle">—</span>;
        const href =
          row.parent.kind === "NCR"
            ? `/qaqc/ncrs/${row.parent.id}`
            : row.parent.kind === "DEFECT"
              ? `/qaqc/defects/${row.parent.id}`
              : `/qaqc/inspections/${row.parent.id}`;

        return (
          <Link href={href} className="text-accent-strong hover:underline">
            {row.parent.label}
          </Link>
        );
      },
    });
  }

  columns.push(
    {
      key: "assignedTo",
      label: t("table.assignedTo"),
      hideBelow: "lg",
      render: (row) =>
        row.assignedTo ? (
          <PersonLink memberId={row.assignedTo.memberId} name={row.assignedTo.fullName} />
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "dueDate",
      label: t("table.due"),
      hideBelow: "xl",
      render: (row) =>
        row.dueDate ? (
          <span className={row.overdue ? "text-danger-strong" : undefined}>
            {formatDate(row.dueDate)}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "status",
      label: t("table.status"),
      render: (row) => <StatusBadge status={row.status} />,
    },
  );

  return (
    <DataTable
      listId={listId}
      sort={sort}
      columns={withMeta(columns, sort, CORRECTIVE_ACTION_COLUMNS)}
      records={actions}
      rowKey={(row) => row.id}
      rowHref={(row) => `/qaqc/corrective-actions/${row.id}`}
      caption={caption ?? t("table.actionsCaption")}
    />
  );
}
