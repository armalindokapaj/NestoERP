import { DataTable, type TableColumn } from "@/components/data/data-table";
import { PriorityBadge, StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import type { TaskSummaryDTO } from "@/lib/modules/tasks/task.types";
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
 */
export function TaskTable({ tasks }: { tasks: TaskSummaryDTO[] }) {
  const grouped = tasks.some((task) => task.company);

  const columns: TableColumn<TaskSummaryDTO>[] = [
    {
      key: "title",
      label: "Task",
      primary: true,
      render: (task) => {
        const title = (
          <>
            <span className="block truncate">{task.title}</span>
            <span className="block text-meta font-normal text-fg-subtle">
              {task.project ? task.project.name : "Personal task"}
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
            label: "Company",
            render: (task: TaskSummaryDTO) => (task.company ? <CompanyTag name={task.company.name} /> : null),
          },
        ]
      : []),
    {
      key: "project",
      label: "Project",
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
      label: "Assignee",
      hideBelow: "xl",
      render: (task) =>
        task.assignee ? (
          <span className="text-fg-muted">
            <PersonLink memberId={task.assignee.memberId} name={task.assignee.fullName} />
            {task.assignee.membershipActive ? null : (
              // Never silently hide an assignee who has left (PRD #11 §174).
              <span className="ml-1 text-meta text-fg-subtle">(inactive)</span>
            )}
          </span>
        ) : (
          <span className="text-fg-subtle">Unassigned</span>
        ),
    },
    {
      key: "status",
      label: "Status",
      render: (task) => <StatusBadge status={task.status} />,
    },
    {
      key: "priority",
      label: "Priority",
      hideBelow: "lg",
      render: (task) => <PriorityBadge priority={task.priority} />,
    },
    {
      key: "dueDate",
      label: "Due",
      hideBelow: "md",
      render: (task) =>
        task.dueDate ? (
          // Overdue is stated in words as well as colour (PRD #11 §200).
          <span className={task.isOverdue ? "font-medium text-danger-strong" : "text-fg-muted"}>
            {formatDate(task.dueDate)}
            {task.isOverdue ? <span className="ml-1 text-meta">Overdue</span> : null}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
  ];

  return (
    <DataTable
      caption="Tasks"
      columns={columns}
      records={tasks}
      rowKey={(task) => task.id}
      // A group row links itself, through its company (above).
      rowHref={grouped ? undefined : (task) => `/tasks/${task.id}`}
    />
  );
}
