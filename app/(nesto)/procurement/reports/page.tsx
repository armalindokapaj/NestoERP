import type { Metadata } from "next";
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

export const metadata: Metadata = { title: "Procurement reports" };

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

  return (
    <ModulePage experience={experience} activeSection="reports">
      <div className="space-y-5">
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">Open orders</h2>
          <p className="mt-1 text-page font-semibold text-fg">
            {totalsLabel(reports.openOrders.totals)}
          </p>
          <p className="mt-1 text-meta text-fg-subtle">
            Across {reports.openOrders.count} order
            {reports.openOrders.count === 1 ? "" : "s"} still being delivered. Committed, not paid.
            {group ? " Added per currency across companies, never between currencies." : ""}
          </p>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          {reports.spendByCompany ? (
            <SpendPanel title="Committed spend by company" rows={reports.spendByCompany} showCompany={false} />
          ) : null}
          <SpendPanel title="Committed spend by supplier" rows={reports.spendBySupplier} />
          <SpendPanel title="Committed spend by project" rows={reports.spendByProject} />
          <SpendPanel title="Committed spend by category" rows={reports.spendByCategory} />

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Delivery performance</h2>
            <p className="mt-1 text-meta text-fg-subtle">
              Measured against the first recorded delivery. Orders with no agreed date are
              excluded — no promise was made to keep.
            </p>
            {reports.deliveryPerformance.length === 0 ? (
              <p className="mt-4 text-table text-fg-subtle">Nothing delivered against a date yet.</p>
            ) : (
              <ScrollRegion label="On-time delivery by supplier" className="mt-4">
              <table className="w-full text-table">
                <caption className="sr-only">On-time delivery by supplier</caption>
                <thead>
                  <tr className="text-left text-meta text-fg-subtle">
                    <th scope="col" className="pb-2 font-medium">Supplier</th>
                    {group ? <th scope="col" className="pb-2 font-medium">Company</th> : null}
                    <th scope="col" className="pb-2 text-right font-medium">Orders</th>
                    <th scope="col" className="pb-2 text-right font-medium">On time</th>
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
              <h2 className="text-card font-semibold text-fg">Enquiries</h2>
              <dl className="mt-4 space-y-2">
                {reports.rfqSummary.map((row) => (
                  <div key={row.status} className="flex items-baseline justify-between gap-3">
                    <dt className="text-table text-fg-muted">
                      {rfqStatusLabels[row.status as RFQStatus] ?? row.status}
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
  title,
  rows,
  showCompany = true,
}: {
  title: string;
  rows: { key: string; label: string; count: number; totals: CurrencyTotal[]; company?: CompanyRef }[];
  /** A row that is one company's own record names it; the by-company panel already does by its label. */
  showCompany?: boolean;
}) {
  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">Nothing committed yet.</p>
      ) : (
        <dl className="mt-4 space-y-2.5">
          {rows.slice(0, 8).map((row) => (
            <div key={row.key} className="flex items-baseline justify-between gap-3">
              <dt className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-table text-fg-muted">
                <span className="min-w-0 break-words">{row.label}</span>
                {showCompany && row.company ? <CompanyTag name={row.company.name} /> : null}
                <span className="text-meta text-fg-subtle">
                  {row.count} order{row.count === 1 ? "" : "s"}
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
