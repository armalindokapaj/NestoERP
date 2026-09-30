import { DataTable, type TableColumn, type TableSortConfig } from "@/components/data/data-table";
import { PriorityBadge, StatusBadge, statusLabel } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import type { TaskSummaryDTO } from "@/lib/modules/tasks/task.types";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils/format";

/**
 * The Tasks list (PRD #11 §31, §146, §147).
 *
 * Operational ERP density on desktop; record cards below the tablet
 * breakpoint. Clicking a row opens the task — individual cells are not
 * separately clickable.
 *
 * In the Group workspace every row carries its company (Workspace Context §32,
 * §45), shown as a column of its own, and opening a task goes through
 * `CompanyRecordLink`: the task's page is a company page, so the click enters
 * that company's workspace first.
 *
 * Column metadata (AUD-08 §5): the task title is the identity column and
 * cannot be hidden; status stays mandatory. Header sorts are offered only
 * where the page passes `sort` — the server-parsed sort of the rows on screen —
 * and only for the allowlisted stems (`due`, `priority`, `title`).
 */
export async function TaskTable({
  tasks,
  listId = "tasks.list",
  sort,
}: {
  tasks: TaskSummaryDTO[];
  /** A nested use (a project's Tasks tab) names its own list, so its column choice is its own. */
  listId?: string;
  /** Header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const t = await getTranslations("tasks");
  const grouped = tasks.some((task) => task.company);
  const sortable = Boolean(sort);

  const columns: TableColumn<TaskSummaryDTO>[] = [
    {
      key: "title",
      id: "title",
      label: t("fields.task"),
      primary: true,
      mandatory: true,
      sortKey: sortable ? "title" : undefined,
      render: (task) => {
        const title = (
          <>
            <span className="block truncate">{task.title}</span>
            <span className="block text-meta font-normal text-fg-subtle">
              {task.project ? task.project.name : t("common.personalTask")}
            </span>
          </>
        );
        return task.company ? (
          <CompanyRecordLink
            companyId={task.company.id}
            companyName={task.company.name}
            href={`/tasks/${task.id}`}
            className="font-medium text-fg transition-colors hover:text-accent focus-visible:text-accent"
          >
            {title}
          </CompanyRecordLink>
        ) : (
          title
        );
      },
    },
    ...(grouped
      ? [
          {
            key: "company",
            id: "company",
            mandatory: true,
            label: t("fields.company"),
            render: (task: TaskSummaryDTO) => (task.company ? <CompanyTag name={task.company.name} /> : null),
          },
        ]
      : []),
    {
      key: "project",
      id: "project",
      label: t("fields.project"),
      hideBelow: "lg",
      render: (task) =>
        task.project ? (
          <span className="text-fg-muted">{task.project.code}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "assignee",
      id: "assignee",
      label: t("fields.assignee"),
      hideBelow: "xl",
      render: (task) =>
        task.assignee ? (
          <span className="text-fg-muted">
            <PersonLink memberId={task.assignee.memberId} name={task.assignee.fullName} />
            {task.assignee.membershipActive ? null : (
              // Never silently hide an assignee who has left (PRD #11 §174).
              <span className="ml-1 text-meta text-fg-subtle">{t("common.inactiveParen")}</span>
            )}
          </span>
        ) : (
          <span className="text-fg-subtle">{t("common.unassigned")}</span>
        ),
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("fields.status"),
      render: (task) => <StatusBadge status={task.status} />,
    },
    {
      key: "priority",
      id: "priority",
      valueType: "status",
      sortKey: sortable ? "priority" : undefined,
      label: t("fields.priority"),
      hideBelow: "lg",
      render: (task) => <PriorityBadge priority={task.priority} />,
    },
    {
      key: "dueDate",
      id: "due",
      valueType: "date",
      sortKey: sortable ? "due" : undefined,
      label: t("fields.due"),
      hideBelow: "md",
      render: (task) =>
        task.dueDate ? (
          // Overdue is stated in words as well as colour (PRD #11 §200).
          <span className={task.isOverdue ? "font-medium text-danger-strong" : "text-fg-muted"}>
            {formatDate(task.dueDate)}
            {task.isOverdue ? <span className="ml-1 text-meta">{t("common.overdue")}</span> : null}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={t("common.tasks")}
      columns={columns}
      records={tasks}
      rowKey={(task) => task.id}
      // A group row links itself, through its company (above).
      rowHref={grouped ? undefined : (task) => `/tasks/${task.id}`}
      // Phone (MOB-03 §46): title, status, then priority, due date and project; the assignee waits behind More details.
      mobile={{
        status: (task) => <StatusBadge status={task.status} />,
        facts: ["priority", "dueDate", "project"],
        omit: ["status"],
        label: (task) =>
          [task.title, statusLabel(task.status), task.priority ? statusLabel(task.priority) : null, task.dueDate ? formatDate(task.dueDate) : null, task.project?.name]
            .filter(Boolean)
            .join(", "),
      }}
    />
  );
}
