import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { qaqcReports } from "@/lib/modules/qaqc/reports/reports.service";
import {
  INSPECTION_TYPES,
  correctiveActionStatusLabels,
  inspectionTypeLabels,
  ncrCategoryLabels,
} from "@/lib/modules/qaqc/qaqc.status";
import { qaqcLabel } from "@/components/qaqc/qaqc-labels";
import type { CorrectiveActionStatus, NCRCategory } from "@prisma/client";
import type { Translate } from "@/lib/i18n/translator";

/** The report service's aging buckets, named by their English label. */
const AGING_KEYS: Record<string, "underWeek" | "weeks" | "months" | "overMonths"> = {
  "Under a week": "underWeek",
  "1–4 weeks": "weeks",
  "1–3 months": "months",
  "Over 3 months": "overMonths",
};

/** A pass-rate row's type, named by its English label; project rows keep theirs. */
function typeLabel(t: Translate<"qaqc">, label: string): string {
  const type = INSPECTION_TYPES.find((value) => inspectionTypeLabels[value] === label);
  return type ? qaqcLabel(t, "inspectionType", type) : label;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.reports") };
}

/**
 * Built-in quality reports (PRD #21 §191–§200).
 *
 * Every figure is counted through the reader's own scope, so a site engineer
 * and the quality manager see different totals on this page and both are right
 * (PRD #21 §202).
 *
 * A pass rate reads "—" rather than 0% when nothing has been decided: a quality
 * metric computed from no decisions is worse than no metric (§193).
 */
export default async function QaqcReportsPage() {
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");
  if (!can(context, "qaqc.report.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "qaqc");
  const reports = await qaqcReports(context);

  return (
    <ModulePage
      experience={experience}
      activeSection="reports"
      description={t("descriptions.reports")}
    >
      <div className="space-y-6">
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">{t("reports.passRate")}</h2>
          <p className="mt-1 text-meta text-fg-subtle">{t("reports.passRateBody")}</p>

          <div className="mt-4 flex flex-wrap items-baseline gap-3">
            <span className="text-page font-semibold tabular-nums text-fg">
              {reports.passRateOverall.percent === null
                ? "—"
                : `${reports.passRateOverall.percent}%`}
            </span>
            <span className="text-table text-fg-muted">
              {reports.passRateOverall.total === 0
                ? t("reports.nothingDecided")
                : t("reports.passSummary", {
                    passed: reports.passRateOverall.passed,
                    failed: reports.passRateOverall.failed,
                    conditional: reports.passRateOverall.conditional,
                  })}
            </span>
          </div>

          {reports.passRateByType.length > 0 ? (
            <dl className="mt-5 space-y-2.5 border-t border-line pt-4">
              {reports.passRateByType.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <dt className="text-table text-fg-muted">{typeLabel(t, row.label)}</dt>
                  <dd className="text-table tabular-nums text-fg">
                    {row.percent === null ? "—" : `${row.percent}%`}{" "}
                    <span className="text-fg-subtle">({row.total})</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>

        {reports.passRateByProject.length > 0 ? (
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("reports.byProject")}</h2>
            {/* Long project names wrap instead of being cut (AUD-04 §8, D-04-05, MW-17). */}
            <dl className="mt-4 space-y-2.5">
              {reports.passRateByProject.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <dt className="min-w-0 text-table text-fg-muted [overflow-wrap:anywhere]">{row.label}</dt>
                  <dd className="shrink-0 text-table tabular-nums text-fg">
                    {row.percent === null ? "—" : `${row.percent}%`}{" "}
                    <span className="text-fg-subtle">({row.total})</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <AgingPanel
            title={t("reports.defectAging")}
            rows={reports.defectAging.map((row) => ({ ...row, label: AGING_KEYS[row.label] ? t(`labels.aging.${AGING_KEYS[row.label]}`) : row.label }))}
            emptyLabel={t("reports.noDefectsOpen")}
          />
          <AgingPanel
            title={t("reports.ncrAging")}
            rows={reports.ncrAging.map((row) => ({ ...row, label: AGING_KEYS[row.label] ? t(`labels.aging.${AGING_KEYS[row.label]}`) : row.label }))}
            emptyLabel={t("reports.noNcrsOpen")}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <CountPanel
            title={t("reports.ncrsByCategory")}
            emptyLabel={t("reports.noNcrs")}
            rows={reports.ncrsByCategory.map((row) => ({
              key: row.category,
              label: qaqcLabel(t, "ncrCategory", row.category, ncrCategoryLabels[row.category as NCRCategory] ?? row.category),
              count: row.count,
            }))}
          />
          <CountPanel
            title={t("reports.defectsBySeverity")}
            emptyLabel={t("reports.noDefectsOpen")}
            rows={reports.defectsBySeverity.map((row) => ({
              key: row.severity,
              label: qaqcLabel(t, "severity", row.severity),
              count: row.count,
            }))}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <CountPanel
            title={t("reports.correctiveActions")}
            emptyLabel={t("reports.noActions")}
            rows={reports.correctiveActions.map((row) => ({
              key: row.status,
              label:
                qaqcLabel(t, "actionStatus", row.status, correctiveActionStatusLabels[row.status as CorrectiveActionStatus] ?? row.status),
              count: row.count,
            }))}
          />

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("reports.reinspections")}</h2>
            <p className="mt-1 text-meta text-fg-subtle">{t("reports.reinspectionsBody")}</p>
            <div className="mt-4 flex flex-wrap items-baseline gap-3">
              <span className="text-page font-semibold tabular-nums text-fg">
                {reports.reinspections.total}
              </span>
              <span className="text-table text-fg-muted">
                {reports.reinspections.total === 0
                  ? t("reports.noneYet")
                  : t("reports.passedRelook", { count: reports.reinspections.passed })}
              </span>
            </div>
          </section>
        </div>

        {reports.supplierQuality && reports.supplierQuality.length > 0 ? (
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("reports.bySupplier")}</h2>
            <p className="mt-1 text-meta text-fg-subtle">{t("reports.bySupplierBody")}</p>

            <ScrollRegion label={t("reports.bySupplier")} className="mt-4">
              <table className="w-full text-table">
                <caption className="sr-only">{t("reports.bySupplierCaption")}</caption>
                <thead>
                  <tr className="border-b border-line text-left text-meta text-fg-subtle">
                    <th scope="col" className="py-2 pr-4 font-medium">{t("reports.supplier")}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">{t("reports.inspections")}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">{t("reports.passRate")}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">{t("reports.rejected")}</th>
                    <th scope="col" className="py-2 text-right font-medium">{t("reports.ncrs")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {reports.supplierQuality.map((row) => (
                    <tr key={row.supplier}>
                      <td className="py-2.5 pr-4 text-fg">{row.supplier}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-fg">
                        {row.inspections}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-fg">
                        {row.percent === null ? "—" : `${row.percent}%`}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-fg-muted">
                        {row.rejectedQuantity}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-fg-muted">{row.ncrs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </section>
        ) : null}

        {reports.materialReleases ? (
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("reports.materialDecisions")}</h2>
            <p className="mt-1 text-meta text-fg-subtle">{t("reports.materialBody")}</p>
            <dl className="mt-4 space-y-2.5">
              <Row label={t("reports.accepted")} value={reports.materialReleases.released} />
              <Row label={t("reports.rejected")} value={reports.materialReleases.rejected} />
              <Row label={t("reports.acceptedCondition")} value={reports.materialReleases.conditional} />
              <Row
                label={t("reports.inspectionsInvolved")}
                value={String(reports.materialReleases.inspections)}
              />
            </dl>
          </section>
        ) : null}
      </div>
    </ModulePage>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-table text-fg-muted">{label}</dt>
      <dd className="text-table font-medium tabular-nums text-fg">{value}</dd>
    </div>
  );
}

function AgingPanel({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: { label: string; count: number }[];
  emptyLabel: string;
}) {
  const total = rows.reduce((running, row) => running + row.count, 0);

  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      {total === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{emptyLabel}</p>
      ) : (
        <dl className="mt-4 space-y-2.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3">
              <dt className="text-table text-fg-muted">{row.label}</dt>
              <dd className="text-table font-medium tabular-nums text-fg">{row.count}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function CountPanel({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: { key: string; label: string; count: number }[];
  emptyLabel: string;
}) {
  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{emptyLabel}</p>
      ) : (
        <dl className="mt-4 space-y-2.5">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3">
              <dt className="text-table text-fg-muted">{row.label}</dt>
              <dd className="text-table font-medium tabular-nums text-fg">{row.count}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
