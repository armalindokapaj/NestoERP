import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContractExportLink } from "@/components/contracts/export-link";
import { ContractTable } from "@/components/contracts/contract-table";
import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { contractReports } from "@/lib/modules/contracts/reports/reports.service";
import { contractTypeLabels } from "@/lib/modules/contracts/contracts/contract.schema";
import { obligationTypeLabels } from "@/lib/modules/contracts/obligations/obligation.status";
import { totalsLabel } from "@/components/contracts/contract-format";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Legal reports" };

/**
 * The built-in legal reports (PRD #18 §216–§224, §299).
 *
 * Every one of them runs through the same scope clause and the same redaction
 * as the screens. A report is not a more generous view of the data — it is the
 * same data, grouped. Value is grouped by currency and never summed across them
 * (PRD #18 §221, §447).
 */
export default async function ContractReportsPage() {
  const context = await requireModule("contracts");
  if (!can(context, "legal.report.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "contracts");
  const reports = await contractReports(context);

  return (
    <ModulePage
      experience={experience}
      activeSection="reports"
      actions={can(context, "legal.export") ? <ContractExportLink /> : null}
    >
      <div className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Contracts by status">
            {reports.byStatus.length === 0 ? (
              <Empty />
            ) : (
              <ul className="divide-y divide-line">
                {reports.byStatus.map((row) => (
                  <li key={row.status} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <StatusBadge status={row.status} />
                    <span className="tabular-nums text-table text-fg">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Contracts by type">
            {reports.byType.length === 0 ? (
              <Empty />
            ) : (
              <ul className="divide-y divide-line">
                {reports.byType.map((row) => (
                  <li
                    key={row.contractType}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                  >
                    <span className="text-table text-fg">{contractTypeLabels[row.contractType]}</span>
                    <span className="tabular-nums text-table text-fg">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Expiring contracts"
            description="Active agreements, by how long they have left."
          >
            <ul className="divide-y divide-line">
              {reports.expiring.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                  <span className="text-table text-fg">{row.label}</span>
                  <span className="flex items-center gap-3">
                    {row.totals ? (
                      <span className="text-meta tabular-nums text-fg-subtle">
                        {totalsLabel(row.totals)}
                      </span>
                    ) : null}
                    <span className="tabular-nums text-table text-fg">{row.count}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Contracts by owner">
            {reports.byOwner.length === 0 ? (
              <Empty />
            ) : (
              <ul className="divide-y divide-line">
                {reports.byOwner.map((row) => (
                  <li
                    key={row.owner.memberId}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                  >
                    <span className={row.owner.active ? "text-table text-fg" : "text-table text-fg-subtle"}>
                      {row.owner.fullName}
                      {row.owner.active ? "" : " (inactive)"}
                    </span>
                    <span className="flex items-center gap-3">
                      {row.totals ? (
                        <span className="text-meta tabular-nums text-fg-subtle">
                          {totalsLabel(row.totals)}
                        </span>
                      ) : null}
                      <span className="tabular-nums text-table text-fg">{row.count}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {reports.value ? (
            <Panel
              title="Contract value"
              description="Grouped by currency. EUR and USD are never added together."
            >
              <ul className="divide-y divide-line">
                {reports.value.map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <span className="text-table text-fg">{row.label}</span>
                    <span className="text-meta tabular-nums text-fg">{totalsLabel(row.totals)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel
            title="Renewal notices"
            description="When the renewal conversation has to start."
          >
            {reports.renewals.length === 0 ? (
              <Empty label="No contract renews inside the next year." />
            ) : (
              <ul className="divide-y divide-line">
                {reports.renewals.slice(0, 12).map((row) => (
                  <li
                    key={row.contract.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-table text-fg">
                        {row.contract.contractNumber}
                      </span>
                      <span className="block truncate text-meta text-fg-subtle">
                        {row.noticeDays ?? 0} days&apos; notice
                      </span>
                    </span>
                    <span className="shrink-0 text-meta tabular-nums text-fg-subtle">
                      {row.alertDate ? formatDate(row.alertDate) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {reports.openObligations.length > 0 ? (
          <Panel title="Open obligations" description="Every requirement still outstanding.">
            <ul className="divide-y divide-line">
              {reports.openObligations.slice(0, 20).map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                  <span className="min-w-0">
                    <span className="block truncate text-table text-fg">{row.title}</span>
                    <span className="block truncate text-meta text-fg-subtle">
                      {obligationTypeLabels[row.type]} · {row.responsible?.fullName ?? "Unassigned"}
                    </span>
                  </span>
                  <span
                    className={
                      row.isOverdue
                        ? "shrink-0 text-meta tabular-nums text-warning-strong"
                        : "shrink-0 text-meta tabular-nums text-fg-subtle"
                    }
                  >
                    {row.dueDate ? formatDate(row.dueDate) : "No due date"}
                    {row.isOverdue ? ` · ${row.daysOverdue}d overdue` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {reports.amendments.length > 0 ? (
          <Panel title="Amendments" description="Every change to an agreement, and what it changed.">
            <ul className="divide-y divide-line">
              {reports.amendments.slice(0, 20).map((row) => (
                <li
                  key={`${row.contractId}-${row.amendmentNumber}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-table text-fg">
                      {row.contractNumber} · {row.amendmentNumber}
                    </span>
                    <span className="block truncate text-meta text-fg-subtle">{row.title}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    {row.valueChange?.to ? (
                      <span className="text-meta tabular-nums text-fg-subtle">
                        {row.valueChange.from ?? "—"} → {row.valueChange.to}
                      </span>
                    ) : null}
                    {row.expiryChange?.to ? (
                      <span className="text-meta tabular-nums text-fg-subtle">
                        expiry → {row.expiryChange.to}
                      </span>
                    ) : null}
                    <StatusBadge status={row.status} />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {reports.terminated.length > 0 ? (
          <Panel title="Terminated contracts" description="Ended before their natural expiry.">
            <ul className="divide-y divide-line">
              {reports.terminated.map((row) => (
                <li key={row.contract.id} className="space-y-1 py-2.5 first:pt-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-table text-fg">{row.contract.contractNumber}</span>
                    <span className="text-meta tabular-nums text-fg-subtle">
                      {row.terminationDate ? formatDate(row.terminationDate) : "—"}
                    </span>
                  </div>
                  {row.terminationReason ? (
                    <p className="text-meta text-fg-muted">{row.terminationReason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Panel title="Contract portfolio" description="Every contract in scope.">
          {reports.portfolio.length === 0 ? (
            <Empty />
          ) : (
            <ContractTable contracts={reports.portfolio} caption="Contract portfolio" />
          )}
        </Panel>
      </div>
    </ModulePage>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      {description ? <p className="mt-1 text-meta text-fg-subtle">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ label = "Nothing to report yet." }: { label?: string }) {
  return <p className="text-table text-fg-subtle">{label}</p>;
}
