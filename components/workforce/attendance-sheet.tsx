"use client";

import * as React from "react";

import { engineeringApi, failureMessage, failureOutcome } from "@/components/engineering/engineering-api";
import { useCommand } from "@/components/engineering/form-kit";
import { selectClass } from "@/components/forms/record-form";
import { guardNavigation, useRouter } from "@/components/navigation/guarded-router";
import { useWorkforceTranslations } from "@/components/workforce/workforce-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { SHEET_STATUSES, sheetStatusLabels, type AttendanceSheetDTO, type AttendanceSheetResult, type SheetStatus } from "@/lib/modules/workforce/workforce.types";
import { statusLabel } from "@/lib/utils/status";
import { workforceLabel } from "@/lib/i18n/modules/workforce/labels";
import { FormSelect } from "@/components/ui/form-select";

/**
 * The site sheet (E-04 §123, §124): everybody working there that day, marked
 * at once — present with their times, absent, or off. A row somebody else
 * recorded (HR, the employee, approved leave, another project's sheet) is
 * shown as it stands and cannot be changed here. Only rows that were marked
 * are sent; the server decides the rest.
 *
 * The marks are unsaved work until saved (AUD-03 §3): leaving — a link, Back,
 * opening another sheet — asks first, and "Save and continue" runs this same
 * save. Dirty against the sheet as loaded; putting a mark back makes it clean.
 */

type Draft = { status: SheetStatus | ""; checkIn: string; checkOut: string; notes: string };

/**
 * The form that chooses the sheet. A plain GET submit would reload the page
 * and drop the marks on the open sheet without a word; this one asks first,
 * then opens the chosen sheet — even the same one, which also starts over
 * (AUD-03 §5). The query is exactly what the browser would have sent.
 */
export function AttendanceSheetFilter({ children, ...props }: Omit<React.ComponentProps<"form">, "onSubmit" | "method">) {
  const router = useRouter();
  return (
    <form
      {...props}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        const query = new URLSearchParams();
        for (const [name, value] of new FormData(event.currentTarget)) if (typeof value === "string") query.append(name, value);
        const href = `${window.location.pathname}?${query.toString()}`;
        guardNavigation({ kind: "navigate", href }, () => router.push(href));
      }}
    >
      {children}
    </form>
  );
}

function draftOf(row: AttendanceSheetDTO["rows"][number]): Draft {
  const status = row.attendance && (SHEET_STATUSES as readonly string[]).includes(row.attendance.status) ? (row.attendance.status as SheetStatus) : "";
  return { status, checkIn: row.attendance?.checkIn ?? "", checkOut: row.attendance?.checkOut ?? "", notes: row.attendance?.notes ?? "" };
}

function draftsOf(sheet: AttendanceSheetDTO): Record<string, Draft> {
  return Object.fromEntries(sheet.rows.map((row) => [row.employeeId, draftOf(row)]));
}

function sameDraft(a: Draft | undefined, b: Draft | undefined): boolean {
  return a?.status === b?.status && a?.checkIn === b?.checkIn && a?.checkOut === b?.checkOut && a?.notes === b?.notes;
}

export function AttendanceSheet({ sheet }: { sheet: AttendanceSheetDTO }) {
  const { run, pending } = useCommand();
  const t = useWorkforceTranslations();
  const [baseline, setBaseline] = React.useState<Record<string, Draft>>(() => draftsOf(sheet));
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(baseline);
  const [error, setError] = React.useState<string | null>(null);
  const editable = sheet.rows.filter((row) => sheet.canRecord && !row.locked);
  const latest = React.useRef(drafts);
  latest.current = drafts;

  React.useEffect(() => {
    const loaded = draftsOf(sheet);
    setBaseline(loaded);
    setDrafts(loaded);
  }, [sheet]);

  const editor = useUnsavedEditor({ module: "workforce", saveKind: "save", label: t("sheet.label", { date: sheet.date }), save: () => save() });
  const { setDirty, setSaving, setUnresolved } = editor;
  const dirty = editable.some((row) => !sameDraft(drafts[row.employeeId], baseline[row.employeeId]));
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);
  React.useEffect(() => setSaving(pending === "save"), [pending, setSaving]);

  const change = (employeeId: string, patch: Partial<Draft>) => setDrafts((current) => ({ ...current, [employeeId]: { ...current[employeeId]!, ...patch } }));

  function markAll(status: SheetStatus) {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of editable) if (!next[row.employeeId]!.status) next[row.employeeId] = { ...next[row.employeeId]!, status };
      return next;
    });
  }

  async function save(): Promise<SaveOutcome> {
    if (pending === "save") return { kind: "unknown" };
    setError(null);
    const submitted = drafts;
    const rows = editable
      .map((row) => ({ employeeId: row.employeeId, ...drafts[row.employeeId]! }))
      .filter((row) => row.status !== "")
      .map((row) => ({ employeeId: row.employeeId, status: row.status, checkIn: row.status === "PRESENT" ? row.checkIn || null : null, checkOut: row.status === "PRESENT" ? row.checkOut || null : null, notes: row.notes || null }));
    if (rows.length === 0) {
      setError(t("sheet.markAtLeastOne"));
      return { kind: "invalid" };
    }
    let outcome = { kind: "unknown" } as SaveOutcome;
    await run(
      "save",
      async () => {
        try {
          const result = await engineeringApi<AttendanceSheetResult>("/api/workforce/attendance", {
            body: { date: sheet.date, projectId: sheet.project?.id ?? null, siteId: sheet.site?.id ?? null, crewId: sheet.crew?.id ?? null, rows },
          });
          outcome = { kind: "committed" };
          return result;
        } catch (failure) {
          outcome = failureOutcome(failure);
          // No answer: it may have saved. Say so; the marks stay (§6).
          setError(outcome.kind === "unknown" ? OUTCOME_COPY.unknown : failureMessage(failure));
          throw failure;
        }
      },
      t("sheet.saved"),
    );
    setUnresolved(outcome.kind === "unknown");
    if (outcome.kind === "committed") {
      // What was sent is saved; anything marked while it saved stays unsaved.
      setBaseline(submitted);
      if (latest.current === submitted) setDirty(false);
    }
    return outcome;
  }

  if (sheet.rows.length === 0) {
    return <p className="nesto-card px-5 py-8 text-center text-table text-fg-muted">{t("sheet.nobody", { date: sheet.date })}</p>;
  }

  return (
    <section className="nesto-card p-0" aria-labelledby="sheet-heading" data-testid="attendance-sheet">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 id="sheet-heading" className="text-card font-semibold text-fg">
          {t("sheet.heading", { count: sheet.rows.length, date: sheet.date })}
        </h2>
        {editable.length > 0 ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => markAll("PRESENT")} disabled={pending !== null}>
              {t("sheet.markRest")}
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
                <FormSelect aria-label={t("sheet.attendanceFor", { name: row.name })} className={selectClass} value={draft.status} onChange={(event) => change(row.employeeId, { status: event.target.value as SheetStatus | "" })}>
                  <option value="">{t("sheet.notMarked")}</option>
                  {SHEET_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {workforceLabel(t, "sheetStatus", status, sheetStatusLabels[status])}
                    </option>
                  ))}
                </FormSelect>
              ) : (
                <p className="text-table text-fg-muted">
                  {row.attendance ? workforceLabel(t, "attendanceStatus", row.attendance.status, statusLabel(row.attendance.status)) : t("sheet.notMarked")}
                  {row.locked ? <Badge className="ml-2">{row.locked}</Badge> : null}
                </p>
              )}
              {open && draft.status === "PRESENT" ? (
                <div className="flex flex-wrap gap-2">
                  <Input type="time" aria-label={t("sheet.checkIn", { name: row.name })} value={draft.checkIn} onChange={(event) => change(row.employeeId, { checkIn: event.target.value })} className="w-28" />
                  <Input type="time" aria-label={t("sheet.checkOut", { name: row.name })} value={draft.checkOut} onChange={(event) => change(row.employeeId, { checkOut: event.target.value })} className="w-28" />
                  <Input aria-label={t("sheet.noteFor", { name: row.name })} placeholder={t("sheet.note")} value={draft.notes} onChange={(event) => change(row.employeeId, { notes: event.target.value })} className="min-w-0 flex-1" />
                </div>
              ) : open ? (
                <Input aria-label={t("sheet.noteFor", { name: row.name })} placeholder={t("sheet.note")} value={draft.notes} onChange={(event) => change(row.employeeId, { notes: event.target.value })} />
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
            {pending === "save" ? t("sheet.saving") : t("sheet.save")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
