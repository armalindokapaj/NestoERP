import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { qaqcReports } from "@/lib/modules/qaqc/reports/reports.service";
import {
  correctiveActionStatusLabels,
  ncrCategoryLabels,
  severityLabels,
} from "@/lib/modules/qaqc/qaqc.status";
import type {
  CorrectiveActionStatus,
  NCRCategory,
  QualitySeverity,
} from "@prisma/client";

export const metadata: Metadata = { title: "Quality reports" };

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
  if (!can(context, "qaqc.report.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "qaqc");
  const reports = await qaqcReports(context);

  return (
    <ModulePage
      experience={experience}
      activeSection="reports"
      description="Counted through your own access. Two people on this page can see different totals, and both are right."
    >
      <div className="space-y-6">
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">Pass rate</h2>
          <p className="mt-1 text-meta text-fg-subtle">
            Decided inspections only. One that nobody has signed off is not yet a pass or a
            failure.
          </p>

          <div className="mt-4 flex flex-wrap items-baseline gap-3">
            <span className="text-page font-semibold tabular-nums text-fg">
              {reports.passRateOverall.percent === null
                ? "—"
                : `${reports.passRateOverall.percent}%`}
            </span>
            <span className="text-table text-fg-muted">
              {reports.passRateOverall.total === 0
                ? "Nothing decided yet"
                : `${reports.passRateOverall.passed} passed, ${reports.passRateOverall.failed} failed, ${reports.passRateOverall.conditional} conditional`}
            </span>
          </div>

          {reports.passRateByType.length > 0 ? (
            <dl className="mt-5 space-y-2.5 border-t border-line pt-4">
              {reports.passRateByType.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <dt className="text-table text-fg-muted">{row.label}</dt>
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
            <h2 className="text-card font-semibold text-fg">Quality by project</h2>
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
            title="How long defects have been open"
            rows={reports.defectAging}
            emptyLabel="No defects are open."
          />
          <AgingPanel
            title="How long NCRs have been open"
            rows={reports.ncrAging}
            emptyLabel="No NCRs are open."
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <CountPanel
            title="NCRs by category"
            emptyLabel="No NCRs are visible to you."
            rows={reports.ncrsByCategory.map((row) => ({
              key: row.category,
              label: ncrCategoryLabels[row.category as NCRCategory] ?? row.category,
              count: row.count,
            }))}
          />
          <CountPanel
            title="Open defects by severity"
            emptyLabel="No defects are open."
            rows={reports.defectsBySeverity.map((row) => ({
              key: row.severity,
              label: severityLabels[row.severity as QualitySeverity],
              count: row.count,
            }))}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <CountPanel
            title="Corrective actions"
            emptyLabel="No corrective actions are visible to you."
            rows={reports.correctiveActions.map((row) => ({
              key: row.status,
              label:
                correctiveActionStatusLabels[row.status as CorrectiveActionStatus] ?? row.status,
              count: row.count,
            }))}
          />

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Reinspections</h2>
            <p className="mt-1 text-meta text-fg-subtle">
              Work that had to be looked at again, and how often the second look passed.
            </p>
            <div className="mt-4 flex flex-wrap items-baseline gap-3">
              <span className="text-page font-semibold tabular-nums text-fg">
                {reports.reinspections.total}
              </span>
              <span className="text-table text-fg-muted">
                {reports.reinspections.total === 0
                  ? "None yet"
                  : `${reports.reinspections.passed} passed on re-look`}
              </span>
            </div>
          </section>
        </div>

        {reports.supplierQuality && reports.supplierQuality.length > 0 ? (
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Quality by supplier</h2>
            <p className="mt-1 text-meta text-fg-subtle">
              What quality found on the deliveries you can see. This is not a supplier scorecard
              — it counts inspections, not performance.
            </p>

            <ScrollRegion label="Quality by supplier" className="mt-4">
              <table className="w-full text-table">
                <caption className="sr-only">Quality outcomes by supplier</caption>
                <thead>
                  <tr className="border-b border-line text-left text-meta text-fg-subtle">
                    <th scope="col" className="py-2 pr-4 font-medium">Supplier</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Inspections</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Pass rate</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Rejected</th>
                    <th scope="col" className="py-2 text-right font-medium">NCRs</th>
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
            <h2 className="text-card font-semibold text-fg">Material decisions</h2>
            <p className="mt-1 text-meta text-fg-subtle">
              Summed across every material decision you can see. These are quantities of different
              things, so this answers &ldquo;how much did quality turn away&rdquo; rather than
              &ldquo;how much of what&rdquo; — the per-line detail is on each inspection.
            </p>
            <dl className="mt-4 space-y-2.5">
              <Row label="Accepted" value={reports.materialReleases.released} />
              <Row label="Rejected" value={reports.materialReleases.rejected} />
              <Row label="Accepted with a condition" value={reports.materialReleases.conditional} />
              <Row
                label="Inspections involved"
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
