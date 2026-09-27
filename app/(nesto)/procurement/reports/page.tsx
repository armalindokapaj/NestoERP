import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { CompanyTag } from "@/components/workspace/company-tag";
import { inGroupWorkspace } from "@/config/workspace";
import { requireModule } from "@/lib/context/current-user";
import { procurementReportsForWorkspace } from "@/lib/modules/procurement/reports/reports.service";
import {
  canReadProcurement,
  resolveProcurementExperience,
} from "@/lib/modules/procurement/procurement.workspace";
import { rfqStatusLabels } from "@/lib/modules/procurement/procurement.status";
import type { CompanyRef, CurrencyTotal } from "@/lib/modules/procurement/procurement.types";
import { totalsLabel } from "@/components/procurement/procurement-format";
import type { RFQStatus } from "@prisma/client";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { procurementLabel } from "@/lib/i18n/modules/procurement/labels";
import type { Translate } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("procurement");
  return { title: t("meta.reports") };
}

/**
 * Procurement reports (PRD #19 §178–§187).
 *
 * Every figure is scoped to the reader, so two people on this page see
 * different totals and both are right. "Spend" here means committed — what was
 * ordered — and says so, because what was actually paid lives in Finance
 * (PRD #19 §179).
 *
 * In the Group workspace the same report is built from every company the reader
 * may read it in (Workspace Context §41): a figure is added per currency and
 * never across two (§72), suppliers and projects stay each company's own rows
 * with the company shown, and committed spend is also broken down by company.
 */
export default async function ReportsPage() {
  const context = await requireModule("procurement");
  if (!(await canReadProcurement(context, "procurement.report.view"))) redirect("/access-denied");

  const group = inGroupWorkspace(context);
  const experience = await resolveProcurementExperience(context);
  const reports = await procurementReportsForWorkspace(context);
  const t = await getTranslations("procurement");

  return (
    <ModulePage experience={experience} activeSection="reports">
      <div className="space-y-5">
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">{t("reports.openOrders")}</h2>
          <p className="mt-1 text-page font-semibold text-fg">
            {totalsLabel(reports.openOrders.totals)}
          </p>
          <p className="mt-1 text-meta text-fg-subtle">
            {t("reports.openOrdersNote", { count: reports.openOrders.count })}
            {group ? ` ${t("reports.groupNote")}` : ""}
          </p>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          {reports.spendByCompany ? (
            <SpendPanel t={t} title={t("reports.spendByCompany")} rows={reports.spendByCompany} showCompany={false} />
          ) : null}
          <SpendPanel t={t} title={t("reports.spendBySupplier")} rows={reports.spendBySupplier} />
          <SpendPanel t={t} title={t("reports.spendByProject")} rows={reports.spendByProject} />
          <SpendPanel t={t} title={t("reports.spendByCategory")} rows={reports.spendByCategory} />

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("reports.deliveryPerformance")}</h2>
            <p className="mt-1 text-meta text-fg-subtle">
              {t("reports.deliveryNote")}
            </p>
            {reports.deliveryPerformance.length === 0 ? (
              <p className="mt-4 text-table text-fg-subtle">{t("reports.deliveryEmpty")}</p>
            ) : (
              <ScrollRegion label={t("reports.onTimeBySupplier")} className="mt-4">
              <table className="w-full text-table">
                <caption className="sr-only">{t("reports.onTimeBySupplier")}</caption>
                <thead>
                  <tr className="text-left text-meta text-fg-subtle">
                    <th scope="col" className="pb-2 font-medium">{t("common.supplier")}</th>
                    {group ? <th scope="col" className="pb-2 font-medium">{t("common.company")}</th> : null}
                    <th scope="col" className="pb-2 text-right font-medium">{t("reports.orders")}</th>
                    <th scope="col" className="pb-2 text-right font-medium">{t("reports.onTime")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {reports.deliveryPerformance.map((row) => (
                    <tr key={row.supplier.id}>
                      <td className="min-w-[8rem] py-2 pr-3 text-fg [overflow-wrap:anywhere]">{row.supplier.name}</td>
                      {group ? (
                        <td className="py-2">{row.company ? <CompanyTag name={row.company.name} /> : null}</td>
                      ) : null}
                      <td className="py-2 text-right tabular-nums text-fg-muted">{row.orders}</td>
                      <td className="py-2 text-right tabular-nums text-fg">
                        {row.onTimeRate === null
                          ? "—"
                          : `${Math.round(row.onTimeRate * 100)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </ScrollRegion>
            )}
          </section>

          {reports.rfqSummary.length > 0 ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("reports.enquiries")}</h2>
              <dl className="mt-4 space-y-2">
                {reports.rfqSummary.map((row) => (
                  <div key={row.status} className="flex items-baseline justify-between gap-3">
                    <dt className="text-table text-fg-muted">
                      {procurementLabel(t, "rfqStatus", row.status, rfqStatusLabels[row.status as RFQStatus] ?? row.status)}
                    </dt>
                    <dd className="tabular-nums text-table font-medium text-fg">{row.count}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>
      </div>
    </ModulePage>
  );
}

function SpendPanel({
  t,
  title,
  rows,
  showCompany = true,
}: {
  t: Translate<"procurement">;
  title: string;
  rows: { key: string; label: string; count: number; totals: CurrencyTotal[]; company?: CompanyRef }[];
  /** A row that is one company's own record names it; the by-company panel already does by its label. */
  showCompany?: boolean;
}) {
  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{t("reports.nothingCommitted")}</p>
      ) : (
        <dl className="mt-4 space-y-2.5">
          {rows.slice(0, 8).map((row) => (
            <div key={row.key} className="flex items-baseline justify-between gap-3">
              <dt className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-table text-fg-muted">
                <span className="min-w-0 break-words">{row.label}</span>
                {showCompany && row.company ? <CompanyTag name={row.company.name} /> : null}
                <span className="text-meta text-fg-subtle">
                  {t("common.orderCount", { count: row.count })}
                </span>
              </dt>
              <dd className="shrink-0 tabular-nums text-table font-medium text-fg">
                {totalsLabel(row.totals)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
