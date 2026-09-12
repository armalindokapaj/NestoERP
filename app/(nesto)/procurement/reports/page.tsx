import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { procurementReports } from "@/lib/modules/procurement/reports/reports.service";
import { rfqStatusLabels } from "@/lib/modules/procurement/procurement.status";
import { totalsLabel } from "@/components/procurement/procurement-format";
import type { RFQStatus } from "@prisma/client";

export const metadata: Metadata = { title: "Procurement reports" };

/**
 * Procurement reports (PRD #19 §178–§187).
 *
 * Every figure is scoped to the reader, so two people on this page see
 * different totals and both are right. "Spend" here means committed — what was
 * ordered — and says so, because what was actually paid lives in Finance
 * (PRD #19 §179).
 */
export default async function ReportsPage() {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.report.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "procurement");
  const reports = await procurementReports(context);

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
          </p>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
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
              <table className="mt-4 w-full text-table">
                <caption className="sr-only">On-time delivery by supplier</caption>
                <thead>
                  <tr className="text-left text-meta text-fg-subtle">
                    <th scope="col" className="pb-2 font-medium">Supplier</th>
                    <th scope="col" className="pb-2 text-right font-medium">Orders</th>
                    <th scope="col" className="pb-2 text-right font-medium">On time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {reports.deliveryPerformance.map((row) => (
                    <tr key={row.supplier.id}>
                      <td className="py-2 text-fg">{row.supplier.name}</td>
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
}: {
  title: string;
  rows: { key: string; label: string; count: number; totals: { currency: string; count: number; value: string }[] }[];
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
              <dt className="min-w-0 truncate text-table text-fg-muted">
                {row.label}
                <span className="ml-2 text-meta text-fg-subtle">
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
