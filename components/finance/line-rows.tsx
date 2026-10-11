"use client";

import * as React from "react";

import { useFieldErrors } from "@/components/forms/record-form";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseDecimalInput, type DecimalRule } from "@/lib/modules/finance/finance.decimal";
import { cn } from "@/lib/utils/cn";

/**
 * Repeated line rows with stable identity (AUD-09 §3, §7, FV-02, FV-16).
 *
 * AUD-09: candidate for components/forms — the line editors of Finance,
 * Sales, Procurement and Inventory share it.
 *
 * - Every row has a local id that survives reordering and removal (React's key,
 *   and the root of its inputs' DOM ids), so a row is never "row 2" to the
 *   editor, only to the payload.
 * - Inputs are named by their position at submit, in the canonical path the
 *   server answers with: `lineItems.2.quantity`. The browser's own focus of the
 *   first invalid field (AUD-03 `focusFirstInvalid`) therefore finds it by name.
 * - The server's answer is mapped onto rows **as they were submitted**. The
 *   fields are disabled from submit until the answer arrives, so at the moment
 *   new field errors arrive the rows on screen are the submitted snapshot; the
 *   errors are re-keyed by row id there and then. Removing or reordering rows
 *   afterwards moves each error with its row, never onto a neighbour.
 * - Removing a row that was never saved is a local change; a saved line leaves
 *   the document only when the edit is saved (lines are replaced as one
 *   document on the server).
 */

export type Row<T> = T & { rowId: string };

export function useLineRows<T extends object>(initial: T[], empty: () => T, options: { max: number }) {
  const counter = React.useRef(0);
  // Deterministic for the rows the page rendered with, so server and client
  // agree on the first render; new rows count up from there.
  const [rows, setRows] = React.useState<Row<T>[]>(() =>
    (initial.length > 0 ? initial : [empty()]).map((row, index) => ({ ...row, rowId: `row-${index}` })),
  );
  /**
   * The last row removed, with where it stood, so a mis-tap can be undone
   * (AUD-04 §5, §6, MW-08): on a phone the remove control sits under a thumb,
   * and a line's typed figures must not vanish silently. One level only; the
   * next removal or addition replaces it.
   */
  const [removed, setRemoved] = React.useState<{ row: Row<T>; index: number; position: number } | null>(null);

  const add = React.useCallback(() => {
    setRemoved(null);
    setRows((current) => {
      if (current.length >= options.max) return current;
      counter.current += 1;
      return [...current, { ...empty(), rowId: `new-${counter.current}` }];
    });
  }, [empty, options.max]);

  const remove = React.useCallback(
    (rowId: string) => {
      if (rows.length <= 1) return;
      const index = rows.findIndex((row) => row.rowId === rowId);
      if (index < 0) return;
      setRemoved({ row: rows[index], index, position: index + 1 });
      setRows(rows.filter((row) => row.rowId !== rowId));
    },
    [rows],
  );

  /** Puts the last removed row back where it was, with its values and its identity. */
  const undo = React.useCallback(() => {
    if (!removed) return;
    setRows((current) => {
      if (current.length >= options.max || current.some((row) => row.rowId === removed.row.rowId)) return current;
      const next = [...current];
      next.splice(Math.min(removed.index, next.length), 0, removed.row);
      return next;
    });
    setRemoved(null);
  }, [removed, options.max]);

  const dismissRemoved = React.useCallback(() => setRemoved(null), []);

  const update = React.useCallback((rowId: string, patch: Partial<T>) => {
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }, []);

  return { rows, add, remove, update, atLimit: rows.length >= options.max, removed, undo, dismissRemoved };
}

/**
 * "Line 2 removed · Undo" (AUD-04 §6, MW-08, D-02-06): a removed line is said
 * out loud and can be put back, instead of disappearing on one tap. Nothing
 * is saved until the form is, so the undo is local, like the removal.
 */
export function RemovedLineNotice({
  removed,
  label,
  noun,
  onUndo,
  onDismiss,
}: {
  removed: { position: number } | null;
  /** What the removed line was, when it had a name. */
  label?: string;
  noun?: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  // The frame dictionary: Inventory's forms show this notice too, and Finance's is not there on their pages.
  const t = useTranslations("ui");
  const shownNoun = noun ?? t("lineNoun");
  return (
    <div role="status" aria-live="polite" className="empty:hidden" data-testid="line-removed-notice">
      {removed ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-table text-fg">
          <span className="min-w-0 break-words">
            {label
              ? t("lineRemovedNamed", { noun: shownNoun, position: removed.position, label })
              : t("lineRemoved", { noun: shownNoun, position: removed.position })}
          </span>
          <span className="flex items-center gap-1">
            <Button type="button" variant="secondary" size="sm" onClick={onUndo}>
              {t("lineUndo")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
              {t("lineDismiss")}
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

type RowErrors = { source: Record<string, string[]>; byRow: Map<string, Record<string, string>>; list: string | undefined };

/**
 * The server's field errors for `prefix.<index>.<field>`, keyed by the row id
 * that sat at `<index>` when the answer arrived (the submitted snapshot).
 * `list` is an error about the lines as a whole (`lineItems`).
 */
export function useRowErrors(prefix: string, rowIds: string[]) {
  const fieldErrors = useFieldErrors();
  const [state, setState] = React.useState<RowErrors>({ source: {}, byRow: new Map(), list: undefined });

  // Derived when a new answer arrives, during render, from the rows as they
  // are in that render — the rows that were submitted.
  if (state.source !== fieldErrors) {
    const byRow = new Map<string, Record<string, string>>();
    const pattern = new RegExp(`^${prefix}\\.(\\d+)\\.(\\w+)$`);
    for (const [key, messages] of Object.entries(fieldErrors)) {
      const match = key.match(pattern);
      if (!match || !messages?.[0]) continue;
      const rowId = rowIds[Number(match[1])];
      if (!rowId) continue;
      const row = byRow.get(rowId) ?? {};
      row[match[2]] = messages[0];
      byRow.set(rowId, row);
    }
    setState({ source: fieldErrors, byRow, list: fieldErrors[prefix]?.[0] });
  }

  /** A corrected field stops showing the server's old complaint about it. */
  const clear = React.useCallback((rowId: string, field: string) => {
    setState((current) => {
      const row = current.byRow.get(rowId);
      if (!row || !(field in row)) return current;
      const next = new Map(current.byRow);
      const { [field]: _removed, ...rest } = row;
      void _removed;
      next.set(rowId, rest);
      return { ...current, byRow: next };
    });
  }, []);

  return { forRow: (rowId: string) => state.byRow.get(rowId) ?? {}, list: state.list, clear };
}

/**
 * A decimal input for a line (AUD-09 §3, §4, FV-06): the same parser the
 * server runs, checked on blur and when the browser validates the form, the
 * message beside the field and linked to it. Nothing is announced per
 * keystroke; a field with an error re-checks as it is corrected.
 */
export function DecimalCell({
  id,
  name,
  label,
  value,
  rule,
  serverError,
  onChange,
  className,
  unit,
  required = true,
  markRequired = false,
  refine,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  rule: DecimalRule;
  serverError?: string;
  onChange: (value: string) => void;
  className?: string;
  /** Shown beside the label: the unit or currency the number is in. */
  unit?: string;
  required?: boolean;
  /** Show the required mark beside the label (a standalone field; line cells are all required). */
  markRequired?: boolean;
  /** A domain rule on the parsed value, e.g. "greater than zero". */
  refine?: (canonical: string) => string | null;
}) {
  const [touched, setTouched] = React.useState(false);
  const local = React.useMemo(() => {
    if (!required && value.trim() === "") return null;
    const parsed = parseDecimalInput(value, rule);
    if (!parsed.ok) return parsed.message;
    return refine?.(parsed.value) ?? null;
  }, [value, rule, refine, required]);
  const ref = React.useRef<HTMLInputElement>(null);

  // The browser's own validation carries the same sentence, so an invalid
  // number stops the submit before a request is sent (the server still checks).
  React.useEffect(() => {
    ref.current?.setCustomValidity(local ?? "");
  }, [local]);

  const shown = (touched ? local : null) ?? serverError;
  const errorId = `${id}-error`;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {unit ? <span className="ml-1 text-meta font-normal text-fg-subtle">({unit})</span> : null}
        {markRequired && required ? <span className="ml-0.5 text-danger-strong">*</span> : null}
      </Label>
      <Input
        ref={ref}
        id={id}
        name={name}
        // A phone's decimal pad has no minus key (iOS), so a field whose rule
        // allows a negative gets the full keyboard; the parser, not the
        // keyboard, decides what is accepted (AUD-04 §6, MW-09).
        inputMode={rule.allowNegative ? "text" : "decimal"}
        autoComplete="off"
        value={value}
        required={required}
        aria-invalid={shown ? true : undefined}
        aria-describedby={shown ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setTouched(true)}
        onInvalid={() => setTouched(true)}
      />
      {shown ? (
        <p id={errorId} className="text-meta text-danger-strong">
          {shown}
        </p>
      ) : null}
    </div>
  );
}

/** An error beside a non-numeric line field, linked by id. */
export function CellError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-meta text-danger-strong">
      {message}
    </p>
  );
}
