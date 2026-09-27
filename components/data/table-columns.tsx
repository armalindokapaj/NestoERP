"use client";

import * as React from "react";
import { Columns3, RotateCcw } from "lucide-react";

import { useTablePreferences } from "@/components/data/use-table-preferences";
import { useMediaQuery } from "@/components/ui/use-breakpoint";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isColumnId, optionalColumns, type ColumnMeta } from "@/lib/tables/columns";
import { columnChoices, resolveHiddenColumns } from "@/lib/tables/preferences";
import { cn } from "@/lib/utils/cn";
import { BREAKPOINT_PX, columnStatesAt, shownOverWidth, withColumnChoiceAt } from "@/lib/tables/visibility";

/**
 * The Columns control and the column visibility it applies (AUD-08 §5, DT-08).
 *
 * The table itself is rendered on the server with every permitted column —
 * render functions never cross to the browser — and each cell carries its
 * column id. Hiding is a scoped style rule, not an unmount: nothing is
 * refetched, and an editor inside a hidden cell keeps its unsaved input
 * (AUD-03 §5, AUD-08 §8). The rule is written for exactly this table instance.
 *
 * The first render (server and hydration) applies the defaults; the stored
 * choice is applied once read for the tab's own identity and workspace.
 * Mandatory columns are listed, checked and disabled, so what cannot be hidden
 * is visible in the control too. The control is omitted where a table has no
 * optional column.
 *
 * Width (AUD-04 §5, MW-05): a column whose breakpoint hides it at the width
 * the table is drawn at is listed unchecked, "Hidden at this width", and
 * counted in "N hidden" — so a tablet reader knows it is there and can show
 * it. Showing it stores a choice that overrides the breakpoint at every width
 * (`lib/tables/visibility.ts`). The width is read after hydration; the rules
 * the table draws with need no width at all, so crossing a breakpoint (a
 * rotation) changes nothing but the control's labels — no refetch, no
 * remount (MW-16). `leading` is drawn at the start of the control's row (the
 * phone Sort control).
 */
export function TableColumnsScope({
  listId,
  columns,
  label,
  leading,
  children,
}: {
  listId: string;
  columns: ColumnMeta[];
  /** The table's name, for the control's accessible label. */
  label?: string;
  /** Drawn at the start of the control's row (AUD-04: the phone Sort control). */
  leading?: React.ReactNode;
  children: React.ReactNode;
}) {
  const preferences = useTablePreferences(listId);
  const hidden = React.useMemo(() => resolveHiddenColumns(columns, preferences.stored), [columns, preferences.stored]);
  const forced = React.useMemo(() => shownOverWidth(columns, preferences.stored), [columns, preferences.stored]);
  const optional = React.useMemo(() => optionalColumns(columns), [columns]);
  const width = useWidthTier();
  const states = React.useMemo(() => columnStatesAt(columns, preferences.stored, width), [columns, preferences.stored, width]);
  const hiddenHere = states.filter((state) => !state.visible);
  const scope = `t${React.useId().replace(/[^A-Za-z0-9_-]/g, "")}`;

  const setVisible = React.useCallback(
    (id: string, visible: boolean) => {
      preferences.update((current) => ({ ...current, columns: withColumnChoiceAt(columns, current, id, visible, width) }));
    },
    [columns, preferences, width],
  );

  const reset = React.useCallback(() => {
    preferences.update((current) => ({ ...current, columns: {} }));
  }, [preferences]);

  // A shown-over-width column overrides its breakpoint class in the table
  // only (cells), never the card lines, which are not table cells.
  const rules = [
    ...hidden.filter(isColumnId).map((id) => `[data-table-scope="${scope}"] [data-col-id="${id}"]{display:none}`),
    ...forced.filter(isColumnId).map((id) => `[data-table-scope="${scope}"] :is(th,td)[data-col-id="${id}"]{display:table-cell}`),
  ].join("\n");

  const customised = Object.keys(columnChoices(columns, hidden)).length > 0 || forced.length > 0;

  return (
    <div
      data-table-scope={scope}
      data-list-id={listId}
      data-hidden-columns={hidden.join(" ")}
      data-width-hidden-columns={hiddenHere.filter((state) => state.reason === "width").map((state) => state.id).join(" ")}
      data-preferences={preferences.ready ? "ready" : "pending"}
    >
      {rules ? <style>{rules}</style> : null}
      {optional.length > 0 || leading ? (
        <div className={cn("mb-2 flex flex-wrap items-center justify-end gap-2", optional.length === 0 && "md:hidden")}>
          {leading}
          {optional.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm" className="ml-auto" aria-label={label ? `Columns: ${label}` : "Columns"}>
                <Columns3 aria-hidden="true" />
                Columns
                {hiddenHere.length > 0 ? (
                  <span className="text-fg-subtle tabular-nums">
                    <span aria-hidden="true">·</span> {hiddenHere.length} hidden
                  </span>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <fieldset>
                <legend className="mb-2 text-table font-semibold text-fg">Show columns</legend>
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {columns.map((column, index) => {
                    const id = `${scope}-${column.id}`;
                    const locked = column.mandatory || !isColumnId(column.id);
                    const state = states[index];
                    const note = locked ? "Always shown" : state?.reason === "width" ? "Hidden at this width" : null;
                    return (
                      <li key={column.id} className="flex min-h-9 items-center gap-2 touch:min-h-11">
                        <Checkbox
                          id={id}
                          checked={locked || state?.visible !== false}
                          disabled={locked}
                          onCheckedChange={(checked) => setVisible(column.id, checked === true)}
                          aria-describedby={note ? `${id}-note` : undefined}
                        />
                        {/* The label fills the row, so the whole row is the hit area. */}
                        <label htmlFor={id} className="flex min-w-0 flex-1 items-center self-stretch text-table text-fg">
                          {column.label}
                        </label>
                        {note ? (
                          <span id={`${id}-note`} className="text-micro text-fg-subtle">
                            {note}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                <Button variant="ghost" size="sm" onClick={reset} disabled={!customised}>
                  <RotateCcw aria-hidden="true" />
                  Reset columns
                </Button>
                {!preferences.persistent && preferences.ready ? (
                  <span className="text-micro text-fg-subtle">Not saved on this device</span>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * The width the table is drawn at, as the breakpoint it falls in (0, 768,
 * 1024 or 1200), or undefined before hydration — the server and the first
 * client render agree on the defaults, and nothing is guessed from the user
 * agent (AUD-04 §3, §8).
 */
function useWidthTier(): number | undefined {
  const md = useMediaQuery(`(min-width: ${BREAKPOINT_PX.md}px)`);
  const lg = useMediaQuery(`(min-width: ${BREAKPOINT_PX.lg}px)`);
  const xl = useMediaQuery(`(min-width: ${BREAKPOINT_PX.xl}px)`);
  if (md === undefined) return undefined;
  return xl ? BREAKPOINT_PX.xl : lg ? BREAKPOINT_PX.lg : md ? BREAKPOINT_PX.md : 0;
}

