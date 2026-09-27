import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { ContractExportLink } from "@/components/contracts/export-link";
import { ContractTable } from "@/components/contracts/contract-table";
import { ModulePage } from "@/components/modules/module-page";
import { PersonLink } from "@/components/people/person-link";
import { StatusBadge } from "@/components/modules/status-badge";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { contractReports } from "@/lib/modules/contracts/reports/reports.service";
import { contractTypeLabels } from "@/lib/modules/contracts/contracts/contract.schema";
import { obligationTypeLabels } from "@/lib/modules/contracts/obligations/obligation.status";
import { totalsLabel } from "@/components/contracts/contract-format";
import { formatDate } from "@/lib/utils/format";
import { contractsLabel } from "@/lib/i18n/modules/contracts/labels";
import type { Translate } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("meta.legalReports") };
}

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

  const t = await getTranslations("contracts");
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
          <Panel title={t("reports.byStatus")}>
            {reports.byStatus.length === 0 ? (
              <Empty label={t("reports.empty")} />
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

          <Panel title={t("reports.byType")}>
            {reports.byType.length === 0 ? (
              <Empty label={t("reports.empty")} />
            ) : (
              <ul className="divide-y divide-line">
                {reports.byType.map((row) => (
                  <li
                    key={row.contractType}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                  >
                    <span className="text-table text-fg">{contractsLabel(t, "contractType", row.contractType, contractTypeLabels[row.contractType])}</span>
                    <span className="tabular-nums text-table text-fg">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title={t("reports.expiring")}
            description={t("reports.expiringDescription")}
          >
            <ul className="divide-y divide-line">
              {reports.expiring.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                  <span className="text-table text-fg">{contractsLabel(t, "expiryBucket", row.key, row.label)}</span>
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

          <Panel title={t("reports.byOwner")}>
            {reports.byOwner.length === 0 ? (
              <Empty label={t("reports.empty")} />
            ) : (
              <ul className="divide-y divide-line">
                {reports.byOwner.map((row) => (
                  <li
                    key={row.owner.memberId}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                  >
                    <span className={row.owner.active ? "text-table text-fg" : "text-table text-fg-subtle"}>
                      <PersonLink memberId={row.owner.memberId} name={row.owner.fullName} />
                      {row.owner.active ? "" : t("common.inactiveSuffix")}
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
              title={t("reports.value")}
              description={t("reports.valueDescription")}
            >
              <ul className="divide-y divide-line">
                {reports.value.map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <span className="text-table text-fg">{valueRowLabel(t, row.key, row.label)}</span>
                    <span className="text-meta tabular-nums text-fg">{totalsLabel(row.totals)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel
            title={t("reports.renewals")}
            description={t("reports.renewalsDescription")}
          >
            {reports.renewals.length === 0 ? (
              <Empty label={t("reports.noRenewals")} />
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
                        {t("reports.noticeDays", { count: row.noticeDays ?? 0 })}
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
          <Panel title={t("reports.openObligations")} description={t("reports.openObligationsDescription")}>
            <ul className="divide-y divide-line">
              {reports.openObligations.slice(0, 20).map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                  <span className="min-w-0">
                    <span className="block truncate text-table text-fg">{row.title}</span>
                    <span className="block truncate text-meta text-fg-subtle">
                      {contractsLabel(t, "obligationType", row.type, obligationTypeLabels[row.type])} ·{" "}
                      {row.responsible ? <PersonLink memberId={row.responsible.memberId} name={row.responsible.fullName} /> : t("common.unassigned")}
                    </span>
                  </span>
                  <span
                    className={
                      row.isOverdue
                        ? "shrink-0 text-meta tabular-nums text-warning-strong"
                        : "shrink-0 text-meta tabular-nums text-fg-subtle"
                    }
                  >
                    {row.dueDate ? formatDate(row.dueDate) : t("obligations.noDueDate")}
                    {row.isOverdue ? t("reports.daysOverdue", { count: row.daysOverdue }) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {reports.amendments.length > 0 ? (
          <Panel title={t("reports.amendments")} description={t("reports.amendmentsDescription")}>
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
                        {t("reports.expiryArrow", { date: row.expiryChange.to })}
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
          <Panel title={t("reports.terminated")} description={t("reports.terminatedDescription")}>
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

        <Panel title={t("reports.portfolio")} description={t("reports.portfolioDescription")}>
          {reports.portfolio.length === 0 ? (
            <Empty label={t("reports.empty")} />
          ) : (
            <ContractTable contracts={reports.portfolio} caption={t("reports.portfolio")} listId="contracts.report-portfolio" />
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

/** A value row's name: `status:ACTIVE` or `type:LEASE`, in the reader's language. */
function valueRowLabel(t: Translate<"contracts">, key: string, fallback: string): string {
  const [kind, value] = key.split(":");
  if (kind === "status" && value) return contractsLabel(t, "contractStatus", value, fallback);
  if (kind === "type" && value) return contractsLabel(t, "contractType", value, fallback);
  return fallback;
}

function Empty({ label = "Nothing to report yet." }: { label?: string }) {
  return <p className="text-table text-fg-subtle">{label}</p>;
}
