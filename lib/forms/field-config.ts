import { parseOptionalDateOnly } from "./dates";
import { parseOptionalDecimal, type DecimalRule } from "./decimal";

/**
 * A configured field list — the engineering `FormDialog` kit's grammar, used
 * by some thirty dialogs across modules (PRD #46 §166) — and what it sends
 * (AUD-09 §4, §5; FV-05, FV-10).
 *
 * Pure and client-safe, so the payload rules are testable on their own and
 * the kit (`components/engineering/form-kit.tsx`) re-exports them unchanged.
 *
 * ## Hidden fields (§5)
 *
 * A field hidden by `visible` follows one explicit policy, `whenHidden`:
 *
 * - **omit** (the default) — not sent at all. On an update the saved value is
 *   the server's to keep; a hidden field is never read as the person erasing it.
 * - **clear** — sent as `null` (a checkbox as `false`): the domain says the
 *   value no longer applies once the field is hidden (a material submittal's
 *   manufacturer after the type became a method statement). Set per field,
 *   never by a generic helper.
 * - **reject** — not sent, and the dialog refuses to submit while the hidden
 *   field still holds a value: the combination is not allowed and the person
 *   must decide.
 *
 * A field the person may not edit (`restricted`, a permission decision) is
 * never shown and never sent, whatever its policy: losing a permission is
 * not the person clearing a value.
 */

export type FormValue = string | boolean;
export type FormValues = Record<string, FormValue>;

export type HiddenPolicy = "omit" | "clear" | "reject";

export type FormField = {
  name: string;
  label: string;
  type: "text" | "email" | "textarea" | "date" | "number" | "select" | "checkbox";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** The empty choice of a select; omit to make a choice required. */
  emptyLabel?: string;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  rows?: number;
  step?: string;
  visible?: (values: FormValues) => boolean;
  disabled?: boolean;
  /** What a field hidden by `visible` sends (AUD-09 §5). Default: "omit". */
  whenHidden?: HiddenPolicy;
  /** Hidden and never sent because this person may not edit it — never cleared. */
  restricted?: boolean;
  /** Characters accepted; the server schema's own limit. */
  maxLength?: number;
  /**
   * A number field's precision and bounds (`lib/forms/decimal`). Without one,
   * the precision is the `step`'s (none: whole numbers) and any sign is allowed.
   * With one, the payload carries the canonical decimal *string*, never a float.
   */
  decimal?: DecimalRule;
  /** A rule of this field's own over the current values; answers a message or null. */
  validate?: (value: FormValue, values: FormValues) => string | null;
};

export function valuesFor(fields: FormField[], initial: Partial<Record<string, unknown>> = {}): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const raw = initial[field.name];
    if (field.type === "checkbox") values[field.name] = Boolean(raw);
    else values[field.name] = raw === null || raw === undefined ? "" : String(raw);
  }
  return values;
}

/** Whether a field is on screen for these values. */
export function isShown(field: FormField, values: FormValues): boolean {
  return !field.restricted && (!field.visible || field.visible(values));
}

function decimalsOf(step: string | undefined): number {
  if (!step || step === "any") return step === "any" ? 4 : 0;
  const fraction = step.split(".")[1];
  return fraction ? fraction.length : 0;
}

/** The decimal rule a number field is read by. */
export function numberRule(field: FormField): DecimalRule {
  return field.decimal ?? { label: field.label, scale: decimalsOf(field.step), maxIntegerDigits: 14, allowNegative: true };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmpty(field: FormField, value: FormValue | undefined): boolean {
  return field.type === "checkbox" ? value !== true : typeof value !== "string" || value.trim() === "";
}

/**
 * Values as the API takes them: empty optional text is null, numbers are
 * numbers (or canonical decimal strings under a `decimal` rule), and a hidden
 * field follows its `whenHidden` policy — omitted unless it says otherwise.
 * Call only with values `validateFieldValues` accepted.
 */
export function payloadFor(fields: FormField[], values: FormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.restricted) continue;
    if (field.visible && !field.visible(values)) {
      if (field.whenHidden === "clear") payload[field.name] = field.type === "checkbox" ? false : null;
      continue;
    }
    const value = values[field.name];
    if (field.type === "checkbox") payload[field.name] = Boolean(value);
    else if (field.type === "number") {
      const parsed = parseOptionalDecimal(typeof value === "string" ? value : "", numberRule(field));
      // Empty is not zero; an invalid number never becomes null (it is refused before sending).
      payload[field.name] = !parsed.ok ? value : parsed.value === null ? null : field.decimal ? parsed.value : Number(parsed.value);
    } else payload[field.name] = typeof value === "string" && value.trim() === "" ? null : value;
  }
  return payload;
}

export type FieldCheck = {
  /** Messages beside the fields, by name. */
  fieldErrors: Record<string, string>;
  /** Refusals that belong to no visible field (a hidden field under `reject`). */
  formErrors: string[];
};

/**
 * The client's check of a field list (AUD-09 §3; FV-04): required, email,
 * date, number and length rules plus a field's own `validate` — the same rules
 * the server applies, checked sooner. `badInput` names number fields whose
 * text the browser could not read (it reports them as empty: they are not).
 */
export function validateFieldValues(fields: FormField[], values: FormValues, badInput: ReadonlySet<string> = new Set()): FieldCheck {
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];
  for (const field of fields) {
    if (field.restricted || field.disabled) continue;
    const value = values[field.name];
    if (field.visible && !field.visible(values)) {
      if (field.whenHidden === "reject" && !isEmpty(field, value)) {
        formErrors.push(`${field.label} doesn't apply to this choice. Change the choice back and clear ${field.label.toLowerCase()} first.`);
      }
      continue;
    }
    const message = checkField(field, value, values, badInput.has(field.name));
    if (message) fieldErrors[field.name] = message;
  }
  return { fieldErrors, formErrors };
}

/** One field's message for its value, or null. */
export function checkField(field: FormField, value: FormValue | undefined, values: FormValues, badInput = false): string | null {
  if (field.type === "number" && badInput) return `${field.label} must be a number, e.g. ${numberRule(field).scale ? "1234.50" : "1234"}.`;
  if (isEmpty(field, value)) {
    if (!field.required) return field.validate?.(value ?? "", values) ?? null;
    if (field.type === "checkbox") return `Confirm ${field.label.toLowerCase()}.`;
    return field.type === "select" ? `Choose ${field.label.toLowerCase()}.` : `Enter ${field.label.toLowerCase()}.`;
  }
  const text = typeof value === "string" ? value : "";
  if (field.type === "number") {
    const parsed = parseOptionalDecimal(text, numberRule(field));
    if (!parsed.ok) return parsed.message;
  } else if (field.type === "date") {
    const parsed = parseOptionalDateOnly(text, { label: field.label });
    if (!parsed.ok) return parsed.message;
  } else if (field.type === "email") {
    // The server's own pattern and sentence (engineering.fields `optionalEmail`).
    if (!EMAIL.test(text.trim())) return "Enter a valid email address.";
  }
  // A select's value outside its options (a saved value no longer offered) is
  // the server's to judge: it may keep a legacy value it would not assign anew (§5).
  if (field.maxLength !== undefined && text.trim().length > field.maxLength) return `Keep this under ${field.maxLength.toLocaleString("en")} characters.`;
  return field.validate?.(value ?? "", values) ?? null;
}
