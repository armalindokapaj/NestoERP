/**
 * The error half of the form contract (AUD-09 §3, §6), shared by the server
 * that answers and the form that reads the answer. Client-safe: no imports.
 *
 * Every refusal carries a stable category besides its code, so a form can
 * tell apart what the PRD keeps distinct — a value to correct, a newer
 * version, a permission or session that no longer holds, a failure that
 * saved nothing, and an answer that never came — without parsing sentences.
 *
 * Field errors are keyed by canonical paths: `title`, `lineItems.2.unitPrice`
 * — the path of the value in the submitted payload, the row index being the
 * row's position in *that* snapshot. A form that keeps stable local row ids
 * maps the index back through the snapshot it sent (`rowPathFor`), so an error
 * never slides onto another row after a remove or reorder (§3).
 */

export type FormErrorCategory =
  /** A value to correct: field errors, or a rule the form explained. */
  | "validation"
  /** A newer version or a state that moved on: the module's conflict workflow takes over. */
  | "conflict"
  /** This person may not do this here, or the record is out of their sight. */
  | "permission"
  /** Not signed in any more, or the workspace changed in another tab. */
  | "session"
  /** The server answered that nothing was saved (an error or a transient failure). */
  | "failure"
  /** No answer: it may or may not have saved. Never retried automatically. */
  | "unknown";

export type FieldErrors = Record<string, string[]>;

const PERMISSION = new Set(["FORBIDDEN", "NOT_FOUND", "MODULE_UNAVAILABLE", "MEMBERSHIP_INACTIVE", "COMPANY_INACTIVE", "COMPANY_REQUIRED", "WORKSPACE_COMPANY_REQUIRED"]);
const SESSION = new Set(["UNAUTHENTICATED", "SESSION_EXPIRED", "WORKSPACE_CHANGED"]);
const FAILURE = new Set(["INTERNAL_ERROR", "TEMPORARILY_UNAVAILABLE"]);
const UNKNOWN = new Set(["UNCONFIRMED", "NETWORK", "TIMEOUT"]);
/** The same reading of a business code as `lib/unsaved/outcome.ts`: a newer version exists. */
const CONFLICT_CODE = /(^|_)CONFLICT$|^STALE_|VERSION_CONFLICT|_STALE$|_CHANGED$/;

/**
 * The category of a refusal from its API code and, when there is one, its
 * business code (`details.code`). The business code is the sharper of the two:
 * a `CONFLICT` whose business code is `WORKSPACE_CHANGED` is a session matter.
 */
export function errorCategory(code: string | undefined, businessCode?: string): FormErrorCategory {
  for (const candidate of [businessCode, code]) {
    if (!candidate) continue;
    if (UNKNOWN.has(candidate)) return "unknown";
    if (SESSION.has(candidate)) return "session";
    if (PERMISSION.has(candidate)) return "permission";
    if (FAILURE.has(candidate)) return "failure";
    if (candidate === "PRECONDITION_REQUIRED" || CONFLICT_CODE.test(candidate)) return "conflict";
  }
  if (code === "VALIDATION_ERROR" || businessCode) return "validation";
  return code ? "validation" : "unknown";
}

/** A payload path as its canonical key: `["lineItems", 2, "unitPrice"]` → `lineItems.2.unitPrice`. */
export function fieldPath(path: ReadonlyArray<PropertyKey>): string {
  return path.map((segment) => (typeof segment === "symbol" ? segment.description ?? "" : String(segment))).join(".");
}

/** Just enough of a zod issue to map it; a type, so this module imports no zod. */
export type IssueLike = { path: ReadonlyArray<PropertyKey>; message: string };

/**
 * Validation issues as field errors keyed by their full path, and the issues
 * that name no field (a refinement over the whole object) as form errors.
 * Every message of a path is kept, in order, once.
 */
export function issuesToFieldErrors(issues: ReadonlyArray<IssueLike>): { fieldErrors: FieldErrors; formErrors: string[] } {
  const fieldErrors: FieldErrors = {};
  const formErrors: string[] = [];
  for (const issue of issues) {
    if (issue.path.length === 0) {
      if (!formErrors.includes(issue.message)) formErrors.push(issue.message);
      continue;
    }
    const key = fieldPath(issue.path);
    const list = (fieldErrors[key] ??= []);
    if (!list.includes(issue.message)) list.push(issue.message);
  }
  return { fieldErrors, formErrors };
}

/**
 * Field errors from a refusal's `details`, as the services have always put
 * them: `{ field: [messages] }`, or `{ field: "name" }` naming the one field
 * the message is about. Anything else in details (a business `code`, lists of
 * candidates, ids or field names such as `{ fields: ["submittalType"] }`) is
 * not a field error: a message is a sentence, so a list counts only when
 * every item has a space in it.
 */
export function detailsFieldErrors(details: unknown, message?: string): FieldErrors | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const result: FieldErrors = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (key === "code" || key === "field") continue;
    if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && /\s/.test(item.trim()))) result[key] = value as string[];
  }
  const field = (details as { field?: unknown }).field;
  if (typeof field === "string" && field && message && !result[field]) result[field] = [message];
  return Object.keys(result).length ? result : undefined;
}

/**
 * Maps an error path that indexes a submitted row back to that row's stable
 * local id: `lineItems.2.unitPrice` with the snapshot's ids `[a, b, c]` →
 * `{ rowId: "c", field: "unitPrice" }`. `null` when the path is not a row's.
 */
export function rowPathFor(path: string, collection: string, submittedRowIds: ReadonlyArray<string>): { rowId: string; field: string } | null {
  const prefix = `${collection}.`;
  if (!path.startsWith(prefix)) return null;
  const [index, ...rest] = path.slice(prefix.length).split(".");
  if (!/^\d+$/.test(index)) return null;
  const rowId = submittedRowIds[Number(index)];
  return rowId === undefined ? null : { rowId, field: rest.join(".") };
}

/** The first message of each field, for components that show one line per field. */
export function firstErrors(fieldErrors: FieldErrors | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) if (messages?.[0]) result[key] = messages[0];
  return result;
}
