import type { ZodError } from "zod";

import { issuesToFieldErrors, type FieldErrors } from "@/lib/forms/errors";

/**
 * Reading a submitted form and answering its refusal (AUD-09 §3, §7, FV-04,
 * FV-16).
 *
 * AUD-09: candidate for lib/forms — the Finance, Procurement, Sales, Contracts
 * and Inventory actions all read repeated line fields and answer field errors
 * the same way, so they share this rather than five copies of a regex.
 *
 * ## Canonical paths
 *
 * A field error is keyed by its canonical path: `clientId`, `lineItems`,
 * `lineItems.2.quantity`. The index is the row's position **in the submitted
 * form** — the browser names row inputs by that position at submit
 * (`lineItems.2.quantity`, or the older `lineItems[2].quantity`), and a line
 * editor maps the answer back onto the rows exactly as they were submitted, so
 * removing or reordering rows afterwards cannot move an error onto another row.
 *
 * `error.flatten()` — what the actions answered before — keeps only the first
 * path segment, which put every line's error under `lineItems` with no row at
 * all.
 */

/** A document may carry at most this many lines (AUD-09 §7, FV-16). */
export const MAX_LINE_ITEMS = 200;

export type SubmittedLines = {
  /** The rows the schema validates, in submitted order. */
  lines: Record<string, string>[];
  /** `lines[i]` was submitted as row `submitted[i]`. */
  submitted: number[];
};

/** `lineItems.2.quantity`, `lineItems[2].quantity` or `items[2][quantity]`. */
const LINE_KEY = /^([A-Za-z]\w*)(?:\[(\d+)\]|\.(\d+))(?:\.(\w+)|\[(\w+)\])$/;

/**
 * Collects `prefix.<index>.<field>` (or the older `prefix[<index>].<field>` /
 * `prefix[<index>][<field>]`) inputs by index. A row with every field blank is dropped — a row somebody added and
 * left empty is not a line — but the remaining rows keep their submitted index
 * in `submitted`, so an error on a later row still names that row.
 */
export function readSubmittedLines(
  formData: FormData,
  prefix: string,
  fields: readonly string[],
  /** Whether a row counts as filled in; by default, any field not blank. */
  kept: (line: Record<string, string>) => boolean = (line) => fields.some((field) => (line[field] ?? "").trim() !== ""),
): SubmittedLines {
  const byIndex = new Map<number, Record<string, string>>();

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    const match = key.match(LINE_KEY);
    if (!match || match[1] !== prefix) continue;
    const index = Number.parseInt(match[2] ?? match[3], 10);
    const field = match[4] ?? match[5];
    if (!fields.includes(field) || !Number.isSafeInteger(index)) continue;

    const line = byIndex.get(index) ?? {};
    line[field] = value;
    byIndex.set(index, line);
  }

  const rows = [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, line]) => kept(line));

  return { lines: rows.map(([, line]) => line), submitted: rows.map(([index]) => index) };
}

/** Plain (non-row) fields of a form: everything whose name is not a row path. */
export function scalarFormValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.includes("[") && !LINE_KEY.test(key)) values[key] = value;
  }
  return values;
}

/**
 * Every issue under its full dotted path (`lib/forms/errors`), with a row's
 * validated index turned back into the index it was submitted as (see
 * `readSubmittedLines`) — `remap` names, per collection, the submitted index of
 * each validated row.
 */
export function canonicalFieldErrors(
  error: Pick<ZodError, "issues">,
  remap: Record<string, number[]> = {},
): { fieldErrors: FieldErrors; formErrors: string[] } {
  const issues = error.issues.map((issue) => {
    const [head, index, ...rest] = issue.path;
    const rows = typeof head === "string" ? remap[head] : undefined;
    if (!rows || typeof index !== "number") return issue;
    const submitted = rows[index];
    return submitted === undefined ? issue : { ...issue, path: [head, submitted, ...rest] };
  });
  return issuesToFieldErrors(issues);
}

/**
 * The refusal an action answers for invalid input — `validationFailure`'s
 * shape (lib/actions/result), with row indices as submitted (AUD-09 §3, FV-16).
 */
export function invalidInput(
  error: Pick<ZodError, "issues">,
  remap: Record<string, number[]> = {},
): { ok: false; error: string; code: "VALIDATION_ERROR"; category: "validation"; fieldErrors: FieldErrors } {
  const { fieldErrors, formErrors } = canonicalFieldErrors(error, remap);
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    category: "validation",
    error: formErrors[0] ?? "Please review the highlighted fields.",
    fieldErrors,
  };
}
