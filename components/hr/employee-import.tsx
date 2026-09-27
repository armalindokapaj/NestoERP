"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { Upload } from "lucide-react";

import { engineeringApi, failureMessage, failureOutcome } from "@/components/engineering/engineering-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { ImportBatchDTO, ImportResultDTO } from "@/lib/modules/workforce/workforce.import";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { cn } from "@/lib/utils/cn";
import { useHrTranslations } from "./hr-text";

/**
 * Adding employees from a spreadsheet (E-04 §93-§98, §228-§230): pick a CSV,
 * see every row checked — what is wrong, what may be a duplicate — then import
 * the good ones. Nobody gets a NESTO login from an import; an account is
 * requested from each employee's page afterwards.
 */

const FILTERS = ["all", "errors", "warnings"] as const;

export function EmployeeImport({ template }: { template: string }) {
  const [batch, setBatch] = React.useState<ImportBatchDTO | null>(null);
  const [result, setResult] = React.useState<ImportResultDTO | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"preview" | "commit" | "discard" | null>(null);
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("all");
  const input = React.useRef<HTMLInputElement>(null);
  const t = useHrTranslations();

  // A checked file waiting to be imported is unsaved work, and its only way
  // forward is the import itself (AUD-03 §3): leaving asks, and the prompt
  // never imports. Leaving sets the batch aside; nothing stored is deleted.
  const editor = useUnsavedEditor({ module: "hr", saveKind: "none", workflow: "Import", label: t("import.label") });
  const { setDirty, setSaving, setUnresolved } = editor;
  React.useEffect(() => setDirty(batch !== null), [batch, setDirty]);
  React.useEffect(() => setSaving(pending !== null), [pending, setSaving]);

  async function preview(file: File) {
    setError(null);
    setResult(null);
    setPending("preview");
    try {
      const csv = await file.text();
      setBatch(await engineeringApi<ImportBatchDTO>("/api/hr/employees/import", { body: { fileName: file.name, csv } }));
      setFilter("all");
    } catch (failure) {
      setError(failureMessage(failure, t("import.unreadable")));
    } finally {
      setPending(null);
      if (input.current) input.current.value = "";
    }
  }

  async function commit() {
    if (!batch) return;
    setError(null);
    setPending("commit");
    try {
      setResult(await engineeringApi<ImportResultDTO>(`/api/hr/employees/import/${batch.id}/commit`, { method: "POST" }));
      setUnresolved(false);
      setBatch(null);
    } catch (failure) {
      // No answer: it may have imported. Say so, and never run it again on its own (§6).
      const unknown = failureOutcome(failure).kind === "unknown";
      setUnresolved(unknown);
      setError(unknown ? OUTCOME_COPY.unknown : failureMessage(failure, t("import.didNotRun")));
    } finally {
      setPending(null);
    }
  }

  async function discard() {
    if (!batch) return;
    setPending("discard");
    try {
      await engineeringApi(`/api/hr/employees/import/${batch.id}/discard`, { method: "POST" });
      setBatch(null);
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setPending(null);
    }
  }

  const rows = batch?.rows.filter((row) => (filter === "errors" ? row.errors.length > 0 : filter === "warnings" ? row.warnings.length > 0 : true)) ?? [];
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(template)}`;

  return (
    <div className="space-y-4">
      <section className="nesto-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-card font-semibold text-fg">{t("import.chooseCsv")}</h2>
          <p className="mt-1 text-table text-fg-muted">
            {t("import.columnsHelp")}
          </p>
          <a href={templateHref} download="employees-template.csv" className="mt-1 inline-block text-table font-medium text-accent-strong hover:underline">
            {t("import.downloadTemplate")}
          </a>
        </div>
        <div className="shrink-0">
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" id="employee-import-file" onChange={(event) => event.target.files?.[0] && void preview(event.target.files[0])} data-testid="import-file" />
          <Button asChild disabled={pending !== null}>
            <label htmlFor="employee-import-file" className="cursor-pointer">
              <Upload aria-hidden="true" />
              {pending === "preview" ? t("import.checking") : t("import.chooseFile")}
            </label>
          </Button>
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
          {error}
        </p>
      ) : null}

      {result ? (
        <section className="nesto-card space-y-2 p-5" data-testid="import-result">
          <h2 className="text-card font-semibold text-fg">
            {t("import.imported", { count: result.createdCount })}
          </h2>
          <p className="text-table text-fg-muted">
            {result.assignedCount ? t("import.assigned", { count: result.assignedCount }) : ""}
            {result.crewedCount ? t("import.crewed", { count: result.crewedCount }) : ""}
            {t("import.noAccounts")}
          </p>
          {result.failed.length ? (
            <ul className="space-y-1 text-table text-danger-strong">
              {result.failed.map((row) => (
                <li key={row.line}>
                  {t("import.failedRow", { line: row.line, name: row.name, message: row.message })}
                </li>
              ))}
            </ul>
          ) : null}
          <Link href="/hr/employees?accountStatus=NO_ACCOUNT" className="text-table font-medium text-accent-strong hover:underline">
            {t("import.seeThem")}
          </Link>
        </section>
      ) : null}

      {batch ? (
        <section className="nesto-card p-0" data-testid="import-preview">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              {/* An unspaced file name breaks instead of widening the card (AUD-04 §3, D-07-16, MW-01). */}
              <h2 className="text-card font-semibold text-fg [overflow-wrap:anywhere]">{batch.fileName}</h2>
              <p className="text-meta text-fg-subtle" data-testid="import-summary">
                {t("import.summary", { rows: batch.rowCount, ready: batch.validCount, errors: batch.errorCount, warnings: batch.warningCount })}
                {batch.ignoredColumns.length ? t("import.notRead", { columns: batch.ignoredColumns.join(", ") }) : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => void discard()} disabled={pending !== null}>
                {t("import.setAside")}
              </Button>
              <Button size="sm" onClick={() => void commit()} disabled={pending !== null || batch.validCount === 0} data-testid="import-commit">
                {pending === "commit" ? t("import.importing") : t("import.importCount", { count: batch.validCount })}
              </Button>
            </div>
          </div>
          <nav aria-label={t("import.rowsToShow")} className="flex flex-wrap gap-1.5 px-5 py-2.5">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={cn("inline-flex items-center rounded-full border px-3 py-1 text-table touch:min-h-11", filter === value ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:text-fg")}
              >
                {value === "all" ? t("import.allRows") : value === "errors" ? t("import.errors") : t("import.toCheck")}
              </button>
            ))}
          </nav>
          <Table flush aria-label={t("import.rowsInFile")}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("import.row")}</TableHeaderCell>
                <TableHeaderCell>{t("import.name")}</TableHeaderCell>
                <TableHeaderCell>{t("import.tradeProjectCrew")}</TableHeaderCell>
                <TableHeaderCell>{t("import.check")}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.slice(0, 500).map((row) => (
                <TableRow key={row.line} data-testid="import-row" data-row-state={row.errors.length ? "error" : row.warnings.length ? "warning" : "ok"}>
                  <TableCell className="tabular-nums text-fg-muted">{row.line}</TableCell>
                  <TableCell className="font-medium">
                    {row.name}
                    {row.values.employeeNumber ? <span className="block text-meta font-normal text-fg-subtle">{row.values.employeeNumber}</span> : null}
                  </TableCell>
                  <TableCell className="text-fg-muted">{[row.values.trade, row.values.project, row.values.crew].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell>
                    {row.errors.length === 0 && row.warnings.length === 0 ? <Badge tone="success">{t("import.ready")}</Badge> : null}
                    {row.errors.map((message) => (
                      <span key={message} className="block text-meta text-danger-strong">
                        {message}
                      </span>
                    ))}
                    {row.warnings.map((message) => (
                      <span key={message} className="block text-meta text-warning-strong">
                        {message}
                      </span>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length > 500 ? <p className="px-5 py-3 text-meta text-fg-subtle">{t("import.first500", { total: rows.length })}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
