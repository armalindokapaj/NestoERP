import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink, personHref } from "@/components/people/person-link";
import { accountStatusLabels, workerCategoryLabels } from "@/lib/modules/hr/hr.status";
import type { CrewSummaryDTO, WorkerSummaryDTO } from "@/lib/modules/workforce/workforce.types";
import { orDash } from "@/lib/utils/format";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The workforce tables (E-04 §137). A worker row opens their profile's
 * Workforce tab — the person, not the login (E-09 §7) — and shows standard work
 * facts only: never pay or private contact data (§79).
 */
export async function WorkerTable({ workers, listId = "workforce.workers", sort }: {
  workers: WorkerSummaryDTO[];
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const [t, th] = await Promise.all([getTranslations("workforce"), getTranslations("hr")]);
  const columns: TableColumn<WorkerSummaryDTO>[] = [
    {
      key: "worker",
      id: "worker",
      mandatory: true,
      sortKey: sort ? "name" : undefined,
      label: t("table.worker"),
      primary: true,
      render: (worker) => (
        <span className="min-w-0">
          <span className="block truncate">{worker.name}</span>
          <span className="block truncate text-meta font-normal text-fg-subtle">{orDash(worker.jobTitle)}</span>
        </span>
      ),
    },
    { key: "code", label: t("table.code"), hideBelow: "xl", render: (worker) => <span className="text-fg-muted tabular-nums">{orDash(worker.employeeNumber)}</span> },
    {
      key: "trade",
      id: "trade",
      label: t("table.categoryTrade"),
      hideBelow: "lg",
      render: (worker) => <span className="text-fg-muted">{[worker.workerCategory ? hrLabel(th, "workerCategory", worker.workerCategory, workerCategoryLabels[worker.workerCategory]) : null, worker.trade?.name].filter(Boolean).join(" · ") || "—"}</span>,
    },
    {
      key: "crew",
      id: "crew",
      label: t("table.crew"),
      hideBelow: "md",
      render: (worker) => (
        <span className="min-w-0 text-fg-muted">
          <span className="block truncate">{orDash(worker.crew?.name)}</span>
          {worker.supervisor ? (
            <span className="block truncate text-meta text-fg-subtle">
              {t("table.foreman")} <PersonLink personId={worker.supervisorPersonId} name={worker.supervisor} tab="workforce" />
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "project",
      id: "project",
      label: t("table.projectSite"),
      hideBelow: "md",
      render: (worker) => <span className="text-fg-muted">{[worker.project?.name, worker.site?.name].filter(Boolean).join(" · ") || "—"}</span>,
    },
    { key: "status", id: "status", label: t("table.status"), mandatory: true, valueType: "status", render: (worker) => <StatusBadge status={worker.employmentStatus} /> },
    {
      key: "account",
      id: "account",
      label: t("table.account"),
      hideBelow: "lg",
      render: (worker) => <span className={worker.accountStatus === "HAS_ACCOUNT" ? "text-fg-muted" : "text-fg-subtle"}>{worker.accountStatus === "HAS_ACCOUNT" ? t("table.yes") : hrLabel(th, "accountStatus", worker.accountStatus, accountStatusLabels[worker.accountStatus])}</span>,
    },
  ];
  return <DataTable listId={listId} sort={sort} caption={t("table.workersCaption")} columns={columns} records={workers} rowKey={(worker) => worker.employeeId} rowHref={(worker) => personHref({ personId: worker.personId }, "workforce")!} />;
}

export async function CrewTable({ crews }: { crews: CrewSummaryDTO[] }) {
  const t = await getTranslations("workforce");
  const columns: TableColumn<CrewSummaryDTO>[] = [
    { key: "name", label: t("table.crew"), primary: true, render: (crew) => <span className="truncate">{crew.name}</span> },
    { key: "project", label: t("table.projectSite"), render: (crew) => <span className="text-fg-muted">{[crew.project?.name, crew.site?.name].filter(Boolean).join(" · ") || t("table.companyCrew")}</span> },
    { key: "supervisor", label: t("table.foreman"), hideBelow: "md", render: (crew) => <span className="text-fg-muted">{crew.supervisor ? <PersonLink personId={crew.supervisor.personId} name={crew.supervisor.name} tab="workforce" /> : "—"}</span> },
    { key: "trade", label: t("table.trade"), hideBelow: "lg", render: (crew) => <span className="text-fg-muted">{crew.trade?.name ?? t("table.mixed")}</span> },
    { key: "members", label: t("table.people"), align: "right", render: (crew) => <span className="tabular-nums text-fg-muted">{crew.memberCount}</span> },
  ];
  return <DataTable listId="workforce.crews" caption={t("table.crewsCaption")} columns={columns} records={crews} rowKey={(crew) => crew.id} rowHref={(crew) => `/workforce/crews/${crew.id}`} />;
}
