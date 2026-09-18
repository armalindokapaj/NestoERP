import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { accountStatusLabels, workerCategoryLabels } from "@/lib/modules/hr/hr.status";
import type { CrewSummaryDTO, WorkerSummaryDTO } from "@/lib/modules/workforce/workforce.types";
import { orDash } from "@/lib/utils/format";

/**
 * The workforce tables (E-04 §137). A worker row opens their profile's
 * Workforce tab — the person, not the login (E-09 §7) — and shows standard work
 * facts only: never pay or private contact data (§79).
 */
export function WorkerTable({ workers }: { workers: WorkerSummaryDTO[] }) {
  const columns: TableColumn<WorkerSummaryDTO>[] = [
    {
      key: "worker",
      label: "Worker",
      primary: true,
      render: (worker) => (
        <span className="min-w-0">
          <span className="block truncate">{worker.name}</span>
          <span className="block truncate text-meta font-normal text-fg-subtle">{orDash(worker.jobTitle)}</span>
        </span>
      ),
    },
    { key: "code", label: "Code", hideBelow: "xl", render: (worker) => <span className="text-fg-muted tabular-nums">{orDash(worker.employeeNumber)}</span> },
    {
      key: "trade",
      label: "Category · trade",
      hideBelow: "lg",
      render: (worker) => <span className="text-fg-muted">{[worker.workerCategory ? workerCategoryLabels[worker.workerCategory] : null, worker.trade?.name].filter(Boolean).join(" · ") || "—"}</span>,
    },
    {
      key: "crew",
      label: "Crew",
      hideBelow: "md",
      render: (worker) => (
        <span className="min-w-0 text-fg-muted">
          <span className="block truncate">{orDash(worker.crew?.name)}</span>
          {worker.supervisor ? <span className="block truncate text-meta text-fg-subtle">Foreman {worker.supervisor}</span> : null}
        </span>
      ),
    },
    {
      key: "project",
      label: "Project · site",
      hideBelow: "md",
      render: (worker) => <span className="text-fg-muted">{[worker.project?.name, worker.site?.name].filter(Boolean).join(" · ") || "—"}</span>,
    },
    { key: "status", label: "Status", render: (worker) => <StatusBadge status={worker.employmentStatus} /> },
    {
      key: "account",
      label: "NESTO account",
      hideBelow: "lg",
      render: (worker) => <span className={worker.accountStatus === "HAS_ACCOUNT" ? "text-fg-muted" : "text-fg-subtle"}>{worker.accountStatus === "HAS_ACCOUNT" ? "Yes" : accountStatusLabels[worker.accountStatus]}</span>,
    },
  ];
  return <DataTable caption="Workers" columns={columns} records={workers} rowKey={(worker) => worker.employeeId} rowHref={(worker) => `/people/${worker.personId}?tab=workforce`} />;
}

export function CrewTable({ crews }: { crews: CrewSummaryDTO[] }) {
  const columns: TableColumn<CrewSummaryDTO>[] = [
    { key: "name", label: "Crew", primary: true, render: (crew) => <span className="truncate">{crew.name}</span> },
    { key: "project", label: "Project · site", render: (crew) => <span className="text-fg-muted">{[crew.project?.name, crew.site?.name].filter(Boolean).join(" · ") || "Company crew"}</span> },
    { key: "supervisor", label: "Foreman", hideBelow: "md", render: (crew) => <span className="text-fg-muted">{orDash(crew.supervisor?.name)}</span> },
    { key: "trade", label: "Trade", hideBelow: "lg", render: (crew) => <span className="text-fg-muted">{crew.trade?.name ?? "Mixed"}</span> },
    { key: "members", label: "People", align: "right", render: (crew) => <span className="tabular-nums text-fg-muted">{crew.memberCount}</span> },
  ];
  return <DataTable caption="Crews" columns={columns} records={crews} rowKey={(crew) => crew.id} rowHref={(crew) => `/workforce/crews/${crew.id}`} />;
}
