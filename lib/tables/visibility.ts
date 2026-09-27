import type { ColumnMeta, ColumnValueType } from "@/lib/tables/columns";
import { isColumnId } from "@/lib/tables/columns";
import { defaultVisible, type StoredTablePreferences } from "@/lib/tables/preferences";

/**
 * Which columns a table shows at the width it is drawn at (AUD-04 §5, MW-05).
 *
 * A column's `hideBelow` drops it from the table below a breakpoint, to keep a
 * desktop table dense. At tablet width (768–1199) that used to lose the data
 * outright: the table replaces the phone cards there, and the Columns control
 * could not bring the column back (survey RC-5, D-02-08, D-04-08, D-06-01).
 * Two rules fix that once, for every table:
 *
 * - **Figures never hide by width.** A money or number column (or, where a
 *   table predates `valueType`, a right-aligned one) is what a comparison
 *   table is for. It stays in the semantic table, which scrolls inside its own
 *   region instead (PRD §5 "comparison-heavy tables").
 * - **Other columns are default-hidden at that width, not lost.** The Columns
 *   control shows them unchecked with "Hidden at this width", counts them in
 *   "N hidden", and checking one shows it at every width. Below `md` the phone
 *   cards carry every line anyway, so nothing counts as width-hidden there.
 *
 * Presentation only, like the rest of `lib/tables`: the server decided which
 * rows and fields exist before any of this runs (AUD-08 §5, DT-09).
 */

export type Breakpoint = "md" | "lg" | "xl";

/**
 * The design system's breakpoints, CSS px — styles/globals.css `--breakpoint-*`
 * (xl is 1200 there, not Tailwind's 1280), as in `components/ui/use-breakpoint`.
 * Restated here because this module is shared with server components.
 */
export const BREAKPOINT_PX: Record<Breakpoint, number> = { md: 768, lg: 1024, xl: 1200 };

type Presentational = { valueType?: ColumnValueType; align?: "left" | "right" };

/** A money or number column — or a right-aligned one that declares no value type. */
export function isFigureColumn(column: Presentational): boolean {
  if (column.valueType) return column.valueType === "money" || column.valueType === "number";
  return column.align === "right";
}

/** The `hideBelow` that still applies: none for a figure column. */
export function effectiveHideBelow(column: Presentational & { hideBelow?: Breakpoint }): Breakpoint | undefined {
  return column.hideBelow && !isFigureColumn(column) ? column.hideBelow : undefined;
}

/**
 * Whether the column's breakpoint hides it from the table at `width`.
 * Unknown width (server render, hydration) and phone widths (cards, which
 * show every line) never count as width-hidden.
 */
export function hiddenByWidth(column: Pick<ColumnMeta, "hideBelow">, width: number | undefined): boolean {
  if (!column.hideBelow || width === undefined || width < BREAKPOINT_PX.md) return false;
  return width < BREAKPOINT_PX[column.hideBelow];
}

export type ColumnState = {
  id: string;
  visible: boolean;
  /** Why: cannot be hidden, the person's choice, the column's default, or its breakpoint. */
  reason: "mandatory" | "choice" | "default" | "width";
};

function optional(column: ColumnMeta): boolean {
  return !column.mandatory && isColumnId(column.id);
}

/** Every column's visibility at `width`, and why. */
export function columnStatesAt(
  columns: readonly ColumnMeta[],
  stored: StoredTablePreferences | null,
  width: number | undefined,
): ColumnState[] {
  return columns.map((column) => {
    if (!optional(column)) return { id: column.id, visible: true, reason: "mandatory" };
    const choice = stored?.columns[column.id];
    if (typeof choice === "boolean") return { id: column.id, visible: choice, reason: "choice" };
    if (!defaultVisible(column)) return { id: column.id, visible: false, reason: "default" };
    if (hiddenByWidth(column, width)) return { id: column.id, visible: false, reason: "width" };
    return { id: column.id, visible: true, reason: "default" };
  });
}

/** The ids not shown at `width`, whatever the reason. */
export function hiddenColumnsAt(
  columns: readonly ColumnMeta[],
  stored: StoredTablePreferences | null,
  width: number | undefined,
): string[] {
  return columnStatesAt(columns, stored, width)
    .filter((state) => !state.visible)
    .map((state) => state.id);
}

/**
 * Columns with a breakpoint that the person asked to see: they are shown at
 * every width, overriding the breakpoint's CSS.
 */
export function shownOverWidth(columns: readonly ColumnMeta[], stored: StoredTablePreferences | null): string[] {
  return columns.filter((column) => optional(column) && column.hideBelow && stored?.columns[column.id] === true).map((column) => column.id);
}

/**
 * The stored choices after the person sets one column at `width`. A choice
 * equal to what the column would show at this width anyway is not stored, so
 * the column follows its default (and breakpoint) again; any other choice is.
 * Choices for unknown or mandatory columns are dropped.
 */
export function withColumnChoiceAt(
  columns: readonly ColumnMeta[],
  stored: StoredTablePreferences | null,
  id: string,
  visible: boolean,
  width: number | undefined,
): Record<string, boolean> {
  const choices: Record<string, boolean> = {};
  for (const column of columns) {
    const choice = stored?.columns[column.id];
    if (optional(column) && typeof choice === "boolean") choices[column.id] = choice;
  }
  const column = columns.find((entry) => entry.id === id);
  if (!column || !optional(column)) return choices;
  const automatic = defaultVisible(column) && !hiddenByWidth(column, width);
  if (visible === automatic) delete choices[id];
  else choices[id] = visible;
  return choices;
}
