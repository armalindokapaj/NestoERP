import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { AccessError, type ApiErrorCode } from "@/lib/access/guards";
import { StaleWorkspaceError } from "@/lib/context/tab-workspace";
import { isContention } from "@/lib/core/transactions/contention";
import { detailsFieldErrors, errorCategory, issuesToFieldErrors, type FieldErrors, type FormErrorCategory } from "@/lib/forms/errors";

/**
 * One reading of a failure for both transports (AUD-09 §3, §6, FV-04).
 *
 * A route handler answers `{ error: { code, message, details, … } }`
 * (`lib/api/respond.ts`); a server action answers `{ ok: false, code, error,
 * fieldErrors }`. Both are drawn from `describeFailure`, so the same thrown
 * error carries the same code, the same category and the same field errors
 * whichever way the form sent it — the action's `code` is the business code
 * when there is one (`details.code`) and the API code otherwise, exactly as
 * the route's `details.code ?? code`.
 *
 * Nothing internal reaches a person: a database uniqueness violation becomes
 * a sentence naming the field (never the SQL, the constraint or a stack), and
 * an unexpected error becomes a generic sentence plus a reference that leads
 * to the log line (PRD #7 §149, PRD #32 §29).
 *
 * Lives beside the route envelope so both `respond.ts` and
 * `lib/actions/result.ts` read it without a circle between the two.
 */

export type DescribedFailure = {
  /** The API code: it decides the HTTP status. */
  code: ApiErrorCode;
  /** The business code a service named (`details.code`), when it named one. */
  businessCode?: string;
  category: FormErrorCategory;
  /** Safe to show. */
  message: string;
  /** Keyed by canonical payload path: `title`, `lineItems.2.unitPrice`. */
  fieldErrors?: FieldErrors;
  /** What the route has always sent as `details` (backward compatible). */
  details?: unknown;
  /** False for a failure nobody anticipated: it is logged, and the person gets a reference. */
  expected: boolean;
};

export const GENERIC_FAILURE = "We couldn't save your changes. Please try again.";
export const VALIDATION_MESSAGE = "Please review the highlighted fields.";

/** Columns that scope a unique index rather than name what collided. */
const SCOPE_COLUMNS = new Set(["id", "companyId", "company_id", "parentGroupId", "parent_group_id", "groupId", "group_id", "tenantId", "deletedAt", "deleted_at", "archivedAt", "archived_at"]);

/** A column as a person would name it: `contractNumber` → "contract number", `normalizedName` → "name". */
export function fieldLabel(column: string): string {
  const base = column.replace(/^normali[sz]ed_?/i, "").replace(/Id$/, "").replace(/_id$/, "");
  const words = base
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
  return words || "value";
}

/** The field a Prisma unique violation is about, from its target: the last column that is not a scope. */
export function uniqueViolationField(error: Prisma.PrismaClientKnownRequestError): string | null {
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  let columns: string[] = [];
  if (Array.isArray(target)) columns = target.map(String);
  else if (typeof target === "string") {
    // A constraint name: `projects_companyId_code_key` → [companyId, code].
    columns = target.split("_").slice(1, -1).filter(Boolean);
  }
  const meaningful = columns.filter((column) => !SCOPE_COLUMNS.has(column));
  return (meaningful[meaningful.length - 1] ?? columns[columns.length - 1] ?? null) || null;
}

function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2002") return true;
  // A raw query's violation arrives as P2010 carrying Postgres's own code.
  return error.code === "P2010" && (error.meta as { code?: unknown } | undefined)?.code === "23505";
}

/** Reads any thrown value into the one failure description both transports answer from. */
export function describeFailure(error: unknown): DescribedFailure {
  if (error instanceof AccessError) {
    const details = error.details as { code?: unknown } | undefined;
    const businessCode = typeof details?.code === "string" ? details.code : undefined;
    const fieldErrors = detailsFieldErrors(error.details, error.message);
    return {
      code: error.code,
      businessCode,
      category: errorCategory(error.code, businessCode),
      message: error.message,
      ...(fieldErrors ? { fieldErrors } : {}),
      ...(error.details === undefined ? {} : { details: error.details }),
      expected: true,
    };
  }

  if (error instanceof StaleWorkspaceError) {
    return { code: "CONFLICT", businessCode: "WORKSPACE_CHANGED", category: "session", message: error.message, details: { code: "WORKSPACE_CHANGED" }, expected: true };
  }

  if (error instanceof ZodError) {
    const { fieldErrors, formErrors } = issuesToFieldErrors(error.issues);
    return {
      code: "VALIDATION_ERROR",
      category: "validation",
      // A rule over the whole payload says itself; otherwise the envelope's usual sentence.
      message: formErrors[0] ?? new AccessError("VALIDATION_ERROR").message,
      ...(Object.keys(fieldErrors).length ? { fieldErrors } : {}),
      // Top-level keys, as the envelope has always carried them.
      details: error.flatten().fieldErrors,
      expected: true,
    };
  }

  if (isUniqueViolation(error)) {
    const field = uniqueViolationField(error);
    const label = field ? fieldLabel(field) : null;
    const message = label ? `Another record already uses this ${label}. Choose a different ${label}.` : "That conflicts with an existing record. Change the values that must be unique and try again.";
    return {
      code: "CONFLICT",
      businessCode: "UNIQUE_VIOLATION",
      category: "conflict",
      message,
      ...(field ? { fieldErrors: { [field]: [message] } } : {}),
      details: field ? { code: "UNIQUE_VIOLATION", field } : { code: "UNIQUE_VIOLATION" },
      expected: true,
    };
  }

  // The database was too busy: the transaction rolled back, so nothing was
  // saved and trying again is safe (AUD-07 PS-17). Logged as expected, not as a defect.
  if (isContention(error)) {
    return { code: "TEMPORARILY_UNAVAILABLE", businessCode: "CONTENTION", category: errorCategory("TEMPORARILY_UNAVAILABLE", "CONTENTION"), message: new AccessError("TEMPORARILY_UNAVAILABLE").message, details: { code: "CONTENTION" }, expected: true };
  }

  return { code: "INTERNAL_ERROR", category: "failure", message: GENERIC_FAILURE, expected: false };
}

