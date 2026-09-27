/**
 * Column presentation metadata shared by every NESTO table (AUD-08 §5).
 *
 * Kept apart from the render functions in `components/data/data-table.tsx`:
 * this part is plain data, so the server can hand it to the client's Columns
 * control and the preference store can validate against it. A column here is
 * presentation only — it never decides what a DTO or an export carries; the
 * server redacts before anything reaches a column (AUD-08 §5, DT-09).
 */

export type ColumnValueType = "text" | "number" | "money" | "date" | "datetime" | "status";

export type ColumnMeta = {
  /** Stable id: the preference store and the manifest name columns by it. */
  id: string;
  label: string;
  /** Cannot be hidden. The primary (identity) column is always mandatory. */
  mandatory: boolean;
  /** Optional and off until the person turns it on. */
  defaultHidden: boolean;
  valueType?: ColumnValueType;
  /** A server-approved sort stem (`name` for `name-asc` / `name-desc`). */
  sortKey?: string;
};

/**
 * Column ids are written into a CSS attribute selector and a storage value, so
 * they are restricted to a safe alphabet. A column with an unusable id simply
 * cannot be hidden — it stays visible — rather than breaking the table.
 */
const COLUMN_ID = /^[A-Za-z0-9_.-]{1,64}$/;

export function isColumnId(value: unknown): value is string {
  return typeof value === "string" && COLUMN_ID.test(value);
}

/** List ids look like `<module>.<list>` (`finance.invoices`, `projects.units`). */
const LIST_ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function isListId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 96 && LIST_ID.test(value);
}

/**
 * The columns the Columns control may offer: those with a usable id that are
 * not mandatory. A table with none of them shows no Columns control at all.
 */
export function optionalColumns(columns: readonly ColumnMeta[]): ColumnMeta[] {
  return columns.filter((column) => !column.mandatory && isColumnId(column.id));
}
