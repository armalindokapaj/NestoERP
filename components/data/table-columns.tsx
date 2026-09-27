"use client";

import * as React from "react";
import { Columns3, RotateCcw } from "lucide-react";

import { useTablePreferences } from "@/components/data/use-table-preferences";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isColumnId, optionalColumns, type ColumnMeta } from "@/lib/tables/columns";
import { columnChoices, resolveHiddenColumns } from "@/lib/tables/preferences";

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
 */
export function TableColumnsScope({
  listId,
  columns,
  label,
  children,
}: {
  listId: string;
  columns: ColumnMeta[];
  /** The table's name, for the control's accessible label. */
  label?: string;
  children: React.ReactNode;
}) {
  const preferences = useTablePreferences(listId);
  const hidden = React.useMemo(() => resolveHiddenColumns(columns, preferences.stored), [columns, preferences.stored]);
  const optional = React.useMemo(() => optionalColumns(columns), [columns]);
  const scope = `t${React.useId().replace(/[^A-Za-z0-9_-]/g, "")}`;

  const setVisible = React.useCallback(
    (id: string, visible: boolean) => {
      preferences.update((current) => {
        const nextHidden = new Set(resolveHiddenColumns(columns, current));
        if (visible) nextHidden.delete(id);
        else nextHidden.add(id);
        return { ...current, columns: columnChoices(columns, [...nextHidden]) };
      });
    },
    [columns, preferences],
  );

  const reset = React.useCallback(() => {
    preferences.update((current) => ({ ...current, columns: {} }));
  }, [preferences]);

  const rules = hidden
    .filter(isColumnId)
    .map((id) => `[data-table-scope="${scope}"] [data-col-id="${id}"]{display:none}`)
    .join("\n");

  const customised = Object.keys(columnChoices(columns, hidden)).length > 0;

  return (
    <div
      data-table-scope={scope}
      data-list-id={listId}
      data-hidden-columns={hidden.join(" ")}
      data-preferences={preferences.ready ? "ready" : "pending"}
    >
      {rules ? <style>{rules}</style> : null}
      {optional.length > 0 ? (
        <div className="mb-2 flex justify-end">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm" aria-label={label ? `Columns: ${label}` : "Columns"}>
                <Columns3 aria-hidden="true" />
                Columns
                {hidden.length > 0 ? (
                  <span className="text-fg-subtle tabular-nums">
                    <span aria-hidden="true">·</span> {hidden.length} hidden
                  </span>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <fieldset>
                <legend className="mb-2 text-table font-semibold text-fg">Show columns</legend>
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {columns.map((column) => {
                    const id = `${scope}-${column.id}`;
                    const locked = column.mandatory || !isColumnId(column.id);
                    return (
                      <li key={column.id} className="flex min-h-9 items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={locked || !hidden.includes(column.id)}
                          disabled={locked}
                          onCheckedChange={(checked) => setVisible(column.id, checked === true)}
                          aria-describedby={locked ? `${id}-note` : undefined}
                        />
                        <label htmlFor={id} className="min-w-0 flex-1 text-table text-fg">
                          {column.label}
                        </label>
                        {locked ? (
                          <span id={`${id}-note`} className="text-micro text-fg-subtle">
                            Always shown
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
        </div>
      ) : null}
      {children}
    </div>
  );
}
