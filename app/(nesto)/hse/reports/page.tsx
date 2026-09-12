import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RiskMatrix } from "@/components/hse/hse-format";
import { ModulePage } from "@/components/modules/module-page";
import { DataTable, type TableColumn } from "@/components/data/data-table";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import * as reports from "@/lib/modules/hse/reports/reports.service";

export const metadata: Metadata = { title: "HSE reports" };

/**
 * The HSE reports (PRD #22 §199–§215).
 *
 * Every one aggregates server-side under the reader's own scope, and only the
 * reports they hold the underlying permission for are offered at all
 * (PRD #22 §217, §424).
 */
export default async function HseReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hse");
  if (!can(context, "hse.report.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "hse");
  const params = await searchParams;
  const available = reports.availableReports(context);

  const requested = typeof params.report === "string" ? params.report : undefined;
  const active = available.find((report) => report.key === requested) ?? available[0];

  const result = active ? await reports.runReport(context, active.key) : null;

  /*
   * A report row has no id of its own — several of them are aggregates — so the
   * key is its position. Deriving it from the first cell collides the moment
   * two rows share a likelihood or a bucket label.
   */
  type KeyedRow = reports.ReportRow & { __key: string };
  const records: KeyedRow[] =
    result?.rows.map((row, index) => ({ ...row, __key: String(index) })) ?? [];

  const columns: TableColumn<KeyedRow>[] =
    result?.columns.map((column) => ({
      key: column.key,
      label: column.label,
      primary: column === result.columns[0],
      render: (row) => {
        const value = row[column.key];
        if (value === null || value === undefined || value === "") {
          return <span className="text-fg-subtle">—</span>;
        }
        return column.numeric ? (
          <span className="tabular-nums">{value}</span>
        ) : (
          <>{value}</>
        );
      },
    })) ?? [];

  return (
    <ModulePage
      experience={experience}
      activeSection="reports"
      description="Safety performance, aggregated under your own access."
    >
      <div className="space-y-5">
        <nav aria-label="Reports" className="flex flex-wrap gap-2">
          {available.map((report) => (
            <Link
              key={report.key}
              href={`/hse/reports?report=${report.key}`}
              aria-current={report.key === active?.key ? "page" : undefined}
              className={
                report.key === active?.key
                  ? "rounded-full border border-line-strong bg-surface-muted px-3 py-1.5 text-meta font-medium text-fg"
                  : "rounded-full border border-line px-3 py-1.5 text-meta text-fg-muted hover:border-line-strong"
              }
            >
              {report.label}
            </Link>
          ))}
        </nav>

        {result ? (
          <section className="space-y-4">
            <h2 className="text-card font-semibold text-fg">{result.label}</h2>

            {/* The 5x5 grid, with every cell carrying its score in text (§358). */}
            {result.matrix ? (
              <div className="nesto-card p-5">
                <RiskMatrix
                  cells={result.matrix}
                  hrefFor={(cell) =>
                    `/hse/hazards?view=open&riskLevel=${
                      result.matrix!.find(
                        (entry) =>
                          entry.likelihood === cell.likelihood &&
                          entry.severity === cell.severity,
                      )?.level ?? "LOW"
                    }`
                  }
                />
              </div>
            ) : null}

            {result.rows.length === 0 ? (
              <p className="nesto-card p-5 text-table text-fg-subtle">
                Nothing to report yet under your access.
              </p>
            ) : (
              <DataTable
                caption={result.label}
                columns={columns}
                records={records}
                rowKey={(row) => row.__key}
              />
            )}
          </section>
        ) : (
          <p className="nesto-card p-5 text-table text-fg-subtle">
            No reports are available to you.
          </p>
        )}
      </div>
    </ModulePage>
  );
}
