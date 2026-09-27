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

  // A checked file waiting to be imported is unsaved work, and its only way
  // forward is the import itself (AUD-03 §3): leaving asks, and the prompt
  // never imports. Leaving sets the batch aside; nothing stored is deleted.
  const editor = useUnsavedEditor({ module: "hr", saveKind: "none", workflow: "Import", label: "Employee import" });
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
      setError(failureMessage(failure, "The file could not be read."));
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
      setError(unknown ? OUTCOME_COPY.unknown : failureMessage(failure, "The import did not run."));
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
          <h2 className="text-card font-semibold text-fg">Choose a CSV file</h2>
          <p className="mt-1 text-table text-fg-muted">
            First name and Last name are required. Employee code, Trade, Category, Job title, Department, Start date, Employment type, Phone, Project, Site and Crew are read when present. Pay is never imported.
          </p>
          <a href={templateHref} download="employees-template.csv" className="mt-1 inline-block text-table font-medium text-accent-strong hover:underline">
            Download a template
          </a>
        </div>
        <div className="shrink-0">
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" id="employee-import-file" onChange={(event) => event.target.files?.[0] && void preview(event.target.files[0])} data-testid="import-file" />
          <Button asChild disabled={pending !== null}>
            <label htmlFor="employee-import-file" className="cursor-pointer">
              <Upload aria-hidden="true" />
              {pending === "preview" ? "Checking…" : "Choose file"}
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
            {result.createdCount} {result.createdCount === 1 ? "employee" : "employees"} imported
          </h2>
          <p className="text-table text-fg-muted">
            {result.assignedCount ? `${result.assignedCount} assigned to projects. ` : ""}
            {result.crewedCount ? `${result.crewedCount} put in crews. ` : ""}
            None of them has a NESTO account; request one from an employee&apos;s page when they need it.
          </p>
          {result.failed.length ? (
            <ul className="space-y-1 text-table text-danger-strong">
              {result.failed.map((row) => (
                <li key={row.line}>
                  Row {row.line} ({row.name}): {row.message}
                </li>
              ))}
            </ul>
          ) : null}
          <Link href="/hr/employees?accountStatus=NO_ACCOUNT" className="text-table font-medium text-accent-strong hover:underline">
            See them in the employee list
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
                {batch.rowCount} rows · {batch.validCount} ready · {batch.errorCount} with errors · {batch.warningCount} to check
                {batch.ignoredColumns.length ? ` · not read: ${batch.ignoredColumns.join(", ")}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => void discard()} disabled={pending !== null}>
                Set aside
              </Button>
              <Button size="sm" onClick={() => void commit()} disabled={pending !== null || batch.validCount === 0} data-testid="import-commit">
                {pending === "commit" ? "Importing…" : `Import ${batch.validCount} ${batch.validCount === 1 ? "employee" : "employees"}`}
              </Button>
            </div>
          </div>
          <nav aria-label="Rows to show" className="flex flex-wrap gap-1.5 px-5 py-2.5">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={cn("inline-flex items-center rounded-full border px-3 py-1 text-table touch:min-h-11", filter === value ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:text-fg")}
              >
                {value === "all" ? "All rows" : value === "errors" ? "Errors" : "To check"}
              </button>
            ))}
          </nav>
          <Table flush aria-label="Rows in the file">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Row</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Trade · project · crew</TableHeaderCell>
                <TableHeaderCell>Check</TableHeaderCell>
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
                    {row.errors.length === 0 && row.warnings.length === 0 ? <Badge tone="success">Ready</Badge> : null}
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
          {rows.length > 500 ? <p className="px-5 py-3 text-meta text-fg-subtle">Showing the first 500 of {rows.length} rows.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
