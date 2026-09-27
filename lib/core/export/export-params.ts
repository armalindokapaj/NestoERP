import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";

/**
 * An export's query string, checked before anything is read (AUD-08 §3, DT-03, DT-22).
 *
 * A list page may drop a value it does not understand — a stale bookmark
 * should still show the list. An export must not: `status=CLOSDE` silently
 * dropped turns "the closed ones" into "all of them", and a file leaves the
 * building. So every parameter an export is given must be one it supports,
 * with a value its list would apply exactly as written; anything else refuses
 * the request (422) naming the parameter, before a row is read.
 *
 * The rules mirror the list parsers' own vocabularies (the same exported enum
 * lists), so a filter the screen applies is always accepted here, and the
 * normalised query itself still comes from the list's parser — this only
 * proves nothing was dropped on the way (DT-02).
 *
 * `page`, `limit` and `pageSize` are presentation, ignored by every export (an
 * export is every match). An empty value (`status=`) is "no filter", exactly as
 * on the list.
 */

export type ParamRule =
  /** A comma-separated list; every entry must be allowed. `caseInsensitive` where the list parser upper-cases. */
  | { kind: "enumList"; allowed: readonly string[]; caseInsensitive?: boolean }
  /** One value from a fixed set: a sort key, a view, a type. */
  | { kind: "enum"; allowed: readonly string[] }
  /** A record id: one token, no spaces or commas. */
  | { kind: "id" }
  /** Free text, such as a search. */
  | { kind: "text"; max?: number }
  /** `YYYY-MM-DD`, or an ISO 8601 instant with its zone. */
  | { kind: "date" }
  /** A plain decimal, such as an amount bound. */
  | { kind: "decimal" }
  /** A whole number in a range, such as a day window. */
  | { kind: "int"; min: number; max: number }
  /** `1`/`true` or `0`/`false`. */
  | { kind: "flag" };

export type ParamRules = Record<string, ParamRule>;

/** Read by no export: an export is every match, never one page of them. */
const PRESENTATION = new Set(["page", "limit", "pageSize"]);

const ID = /^[A-Za-z0-9_.:-]{1,191}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const FLAG = new Set(["1", "true", "0", "false"]);

function refuse(param: string, message: string): AccessError {
  return new AccessError("VALIDATION_ERROR", message, { code: "EXPORT_FILTER_INVALID", field: param });
}

function validDate(value: string): boolean {
  if (DATE.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
  }
  return INSTANT.test(value) && !Number.isNaN(new Date(value).getTime());
}

function check(param: string, value: string, rule: ParamRule): void {
  switch (rule.kind) {
    case "enumList": {
      const allowed = new Set(rule.caseInsensitive ? rule.allowed.map((entry) => entry.toUpperCase()) : rule.allowed);
      const entries = value.split(",").map((entry) => entry.trim());
      const bad = entries.find((entry) => entry === "" || !allowed.has(rule.caseInsensitive ? entry.toUpperCase() : entry));
      if (bad !== undefined) throw refuse(param, `The ${param} filter "${bad}" is not one this export supports. Clear it and try again.`);
      return;
    }
    case "enum":
      if (!rule.allowed.includes(value)) throw refuse(param, `"${value}" is not a valid ${param} for this export.`);
      return;
    case "id":
      if (!ID.test(value)) throw refuse(param, `The ${param} filter is not a valid id.`);
      return;
    case "text":
      if (value.length > (rule.max ?? 200)) throw refuse(param, `The ${param} filter is too long.`);
      return;
    case "date":
      if (!validDate(value)) throw refuse(param, `The ${param} filter is not a valid date.`);
      return;
    case "decimal":
      if (!DECIMAL.test(value)) throw refuse(param, `The ${param} filter is not a number.`);
      return;
    case "int": {
      const number = /^\d+$/.test(value) ? Number(value) : Number.NaN;
      if (!(number >= rule.min && number <= rule.max)) throw refuse(param, `The ${param} filter must be a whole number from ${rule.min} to ${rule.max}.`);
      return;
    }
    case "flag":
      if (!FLAG.has(value)) throw refuse(param, `The ${param} filter must be true or false.`);
      return;
  }
}

/**
 * Refuses an export whose query string holds a parameter it does not support,
 * a repeated parameter, or a value its list would drop. `selector` names the
 * parameters that pick the export itself (`type`, `kind`), checked by the route.
 */
export function assertExportParams(
  params: URLSearchParams,
  rules: ParamRules,
  options: { selector?: readonly string[]; repeatable?: readonly string[] } = {},
): void {
  const seen = new Set<string>();
  for (const [key, raw] of params.entries()) {
    if (PRESENTATION.has(key) || options.selector?.includes(key)) continue;
    const rule = rules[key];
    if (!rule) throw refuse(key, `This export does not support the "${key}" filter. Remove it and try again.`);
    if (seen.has(key) && !options.repeatable?.includes(key)) throw refuse(key, `The ${key} filter was given more than once.`);
    seen.add(key);
    const value = raw.trim();
    if (value === "") continue;
    check(key, value, rule);
  }
}

/** Two dates that make a range: the end may not come before the start. */
export function assertExportRange(params: URLSearchParams, from: string, to: string): void {
  const start = params.get(from)?.trim();
  const end = params.get(to)?.trim();
  if (!start || !end) return;
  if (new Date(end).getTime() < new Date(start).getTime()) {
    throw refuse(to, `The ${to} date is before the ${from} date.`);
  }
}

/**
 * A company workspace exports its own company only. A `company` parameter that
 * names another one is refused rather than ignored: ignoring it would export
 * the active company's rows to someone who asked for a different company's
 * (AUD-08 §3, DT-22).
 */
export function assertOwnCompany(context: UserContext, params: URLSearchParams, param = "company"): void {
  const requested = params.get(param)?.trim();
  if (!requested || requested === context.companyId) return;
  throw new AccessError("VALIDATION_ERROR", "This export can only include the company you are working in.", {
    code: "EXPORT_COMPANY_OUT_OF_SCOPE",
    field: param,
  });
}

/** The export's own selector (`type`, `kind`): one of its known values, or the default when absent — never a guess. */
export function exportSelector<T extends string>(params: URLSearchParams, param: string, allowed: readonly T[], fallback: T): T {
  const values = params.getAll(param);
  if (values.length > 1) throw refuse(param, `The ${param} parameter was given more than once.`);
  const raw = values[0]?.trim();
  if (!raw) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) throw refuse(param, "That export does not exist.");
  return raw as T;
}

/**
 * Proves the list's parser applied each given parameter as written (AUD-08 §3,
 * DT-03). A list schema may fall back on an unknown value — `sort=bogus`
 * becomes the default order, a status it does not know is dropped — which is
 * right for a page and wrong for an export. `fields` maps a parameter to the
 * parsed query's field; a list compares as a set of entries, one value as
 * itself. Any difference refuses the export, naming the parameter.
 */
export function assertApplied(params: URLSearchParams, parsed: object, fields: Record<string, string>): void {
  const query = parsed as Record<string, unknown>;
  for (const [param, field] of Object.entries(fields)) {
    const raw = params.get(param)?.trim();
    if (!raw) continue;
    const value = query[field];
    if (Array.isArray(value)) {
      const asked = new Set(raw.split(",").map((entry) => entry.trim().toUpperCase()).filter(Boolean));
      const applied = new Set(value.map((entry) => String(entry).toUpperCase()));
      const dropped = [...asked].find((entry) => !applied.has(entry));
      if (dropped !== undefined) throw refuse(param, `The ${param} filter "${dropped}" is not one this export supports. Clear it and try again.`);
      continue;
    }
    const applied = value instanceof Date ? value.toISOString() : value === undefined || value === null ? "" : String(value);
    if (applied !== raw && !(typeof value === "boolean" && (raw === "1" || raw === "true") === value)) {
      throw refuse(param, `"${raw}" is not a valid ${param} for this export.`);
    }
  }
}
