"use client";

import * as React from "react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { useCommand } from "@/components/engineering/form-kit";
import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SHEET_STATUSES, sheetStatusLabels, type AttendanceSheetDTO, type AttendanceSheetResult, type SheetStatus } from "@/lib/modules/workforce/workforce.types";
import { statusLabel } from "@/lib/utils/status";

/**
 * The site sheet (E-04 §123, §124): everybody working there that day, marked
 * at once — present with their times, absent, or off. A row somebody else
 * recorded (HR, the employee, approved leave, another project's sheet) is
 * shown as it stands and cannot be changed here. Only rows that were marked
 * are sent; the server decides the rest.
 */

type Draft = { status: SheetStatus | ""; checkIn: string; checkOut: string; notes: string };

function draftOf(row: AttendanceSheetDTO["rows"][number]): Draft {
  const status = row.attendance && (SHEET_STATUSES as readonly string[]).includes(row.attendance.status) ? (row.attendance.status as SheetStatus) : "";
  return { status, checkIn: row.attendance?.checkIn ?? "", checkOut: row.attendance?.checkOut ?? "", notes: row.attendance?.notes ?? "" };
}

export function AttendanceSheet({ sheet }: { sheet: AttendanceSheetDTO }) {
  const { run, pending } = useCommand();
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(() => Object.fromEntries(sheet.rows.map((row) => [row.employeeId, draftOf(row)])));
  const [error, setError] = React.useState<string | null>(null);
  const editable = sheet.rows.filter((row) => sheet.canRecord && !row.locked);

  React.useEffect(() => {
    setDrafts(Object.fromEntries(sheet.rows.map((row) => [row.employeeId, draftOf(row)])));
  }, [sheet]);

  const change = (employeeId: string, patch: Partial<Draft>) => setDrafts((current) => ({ ...current, [employeeId]: { ...current[employeeId]!, ...patch } }));

  function markAll(status: SheetStatus) {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of editable) if (!next[row.employeeId]!.status) next[row.employeeId] = { ...next[row.employeeId]!, status };
      return next;
    });
  }

  async function save() {
    setError(null);
    const rows = editable
      .map((row) => ({ employeeId: row.employeeId, ...drafts[row.employeeId]! }))
      .filter((row) => row.status !== "")
      .map((row) => ({ employeeId: row.employeeId, status: row.status, checkIn: row.status === "PRESENT" ? row.checkIn || null : null, checkOut: row.status === "PRESENT" ? row.checkOut || null : null, notes: row.notes || null }));
    if (rows.length === 0) {
      setError("Mark at least one worker.");
      return;
    }
    await run(
      "save",
      async () => {
        try {
          return await engineeringApi<AttendanceSheetResult>("/api/workforce/attendance", {
            body: { date: sheet.date, projectId: sheet.project?.id ?? null, siteId: sheet.site?.id ?? null, crewId: sheet.crew?.id ?? null, rows },
          });
        } catch (failure) {
          setError(failureMessage(failure));
          throw failure;
        }
      },
      "Attendance saved.",
    );
  }

  if (sheet.rows.length === 0) {
    return <p className="nesto-card px-5 py-8 text-center text-table text-fg-muted">Nobody is assigned here on {sheet.date}. Assign people to the project or put them in the crew first.</p>;
  }

  return (
    <section className="nesto-card p-0" aria-labelledby="sheet-heading" data-testid="attendance-sheet">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 id="sheet-heading" className="text-card font-semibold text-fg">
          {sheet.rows.length} {sheet.rows.length === 1 ? "worker" : "workers"} · {sheet.date}
        </h2>
        {editable.length > 0 ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => markAll("PRESENT")} disabled={pending !== null}>
              Mark the rest present
            </Button>
          </div>
        ) : null}
      </div>
      <ul className="divide-y divide-line">
        {sheet.rows.map((row) => {
          const draft = drafts[row.employeeId] ?? draftOf(row);
          const open = sheet.canRecord && !row.locked;
          return (
            <li key={row.employeeId} className="grid gap-2 px-5 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)] md:items-center" data-testid="sheet-row" data-worker-name={row.name}>
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-fg">{row.name}</p>
                <p className="truncate text-meta text-fg-subtle">{[row.trade, row.crew].filter(Boolean).join(" · ") || "—"}</p>
              </div>
              {open ? (
                <select aria-label={`Attendance for ${row.name}`} className={selectClass} value={draft.status} onChange={(event) => change(row.employeeId, { status: event.target.value as SheetStatus | "" })}>
                  <option value="">Not marked</option>
                  {SHEET_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {sheetStatusLabels[status]}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-table text-fg-muted">
                  {row.attendance ? statusLabel(row.attendance.status) : "Not marked"}
                  {row.locked ? <Badge className="ml-2">{row.locked}</Badge> : null}
                </p>
              )}
              {open && draft.status === "PRESENT" ? (
                <div className="flex flex-wrap gap-2">
                  <Input type="time" aria-label={`Check-in for ${row.name}`} value={draft.checkIn} onChange={(event) => change(row.employeeId, { checkIn: event.target.value })} className="w-28" />
                  <Input type="time" aria-label={`Check-out for ${row.name}`} value={draft.checkOut} onChange={(event) => change(row.employeeId, { checkOut: event.target.value })} className="w-28" />
                  <Input aria-label={`Note for ${row.name}`} placeholder="Note" value={draft.notes} onChange={(event) => change(row.employeeId, { notes: event.target.value })} className="min-w-0 flex-1" />
                </div>
              ) : open ? (
                <Input aria-label={`Note for ${row.name}`} placeholder="Note" value={draft.notes} onChange={(event) => change(row.employeeId, { notes: event.target.value })} />
              ) : (
                <p className="text-meta text-fg-subtle">{[row.attendance?.checkIn && row.attendance.checkOut ? `${row.attendance.checkIn}–${row.attendance.checkOut}` : null, row.attendance?.notes].filter(Boolean).join(" · ")}</p>
              )}
            </li>
          );
        })}
      </ul>
      {sheet.canRecord ? (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-3">
          {error ? (
            <p role="alert" className="mr-auto text-table text-danger-strong">
              {error}
            </p>
          ) : null}
          <Button onClick={() => void save()} disabled={pending !== null || editable.length === 0} data-testid="save-sheet">
            {pending === "save" ? "Saving…" : "Save attendance"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
