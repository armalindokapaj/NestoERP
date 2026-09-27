import type { ZodError } from "zod";

import { describeFailure, VALIDATION_MESSAGE } from "@/lib/api/failure";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { currentRequestContext, newRequestId } from "@/lib/core/observability/request-context";
import { issuesToFieldErrors, type FieldErrors, type FormErrorCategory } from "@/lib/forms/errors";
import { isNextControlFlow } from "@/lib/unsaved/outcome";

/**
 * What a server action answers for a thrown error (AUD-09 §3, §6, FV-04).
 * The reading itself is `describeFailure` in `lib/api/failure.ts`, shared
 * with the route envelope; re-exported here for the action modules.
 *
 * Not a "use server" module: it exports plain helpers the action modules call.
 */
export { describeFailure, fieldLabel, GENERIC_FAILURE, uniqueViolationField, VALIDATION_MESSAGE, type DescribedFailure } from "@/lib/api/failure";

/* -------------------------------------------------------------------------- */
/* Server actions                                                              */
/* -------------------------------------------------------------------------- */

export type ActionFailure = {
  ok: false;
  /** The business code when there is one, the API code otherwise. */
  code: string;
  /** The form-level sentence. */
  error: string;
  category: FormErrorCategory;
  fieldErrors?: FieldErrors;
  /** Quotable, leads to the log line; only for failures nobody anticipated. */
  reference?: string;
};

/**
 * What a server action answers for a thrown error — the shared `toResult`.
 * Next's own control flow (a redirect, a not-found) is not a failure and is
 * thrown on. An unexpected error is logged under `scope` with a reference the
 * person can quote.
 */
export function actionFailure(error: unknown, scope = "action"): ActionFailure {
  if (isNextControlFlow(error)) throw error;
  const failure = describeFailure(error);
  let reference: string | undefined;
  if (!failure.expected) {
    reference = currentRequestContext()?.requestId ?? newRequestId();
    logger.error(`${scope}.action_failed`, { ...serialiseError(error), reference });
  }
  return {
    ok: false,
    code: failure.businessCode ?? failure.code,
    error: failure.message,
    category: failure.category,
    ...(failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {}),
    ...(reference ? { reference } : {}),
  };
}

/**
 * A schema refusal as an action answers it: every issue under its full path
 * (`lineItems.2.unitPrice`, not just `lineItems`), and a rule over the whole
 * payload as the form-level sentence.
 */
export function validationFailure(error: ZodError, message = VALIDATION_MESSAGE): ActionFailure {
  const { fieldErrors, formErrors } = issuesToFieldErrors(error.issues);
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    error: formErrors[0] ?? message,
    category: "validation",
    ...(Object.keys(fieldErrors).length ? { fieldErrors } : {}),
  };
}
