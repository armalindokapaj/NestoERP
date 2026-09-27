import { parseDateOnly, type DateOnlyRule } from "./dates";
import { parseDecimalInput, type DecimalRule } from "./decimal";

/**
 * One reading of a submitted form (AUD-09 §4, FV-05).
 *
 * A browser form and a JSON body say three different things that a careless
 * reader merges into one:
 *
 * - **omitted** — the key is not there. On an update that means "leave the
 *   saved value alone"; on a create it means "use the create default".
 * - **empty** — the key is there with `""` (or, in JSON, `null`). That is the
 *   person clearing the field: `null` on an update, never a default.
 * - **a value** — parsed by the field's kind: trimmed text, a canonical
 *   decimal string, a `YYYY-MM-DD` calendar date, a boolean, a list.
 *
 * Two things an HTML form cannot say by itself need a marker. An unchecked
 * checkbox and an empty multi-select submit nothing at all, exactly like a
 * control that was never rendered; a form that renders one lists its name in
 * a hidden `__present` input (`PRESENT_FIELD`), and then its absence is an
 * explicit `false` or `[]`. Without the marker the field is omitted — so a
 * hidden or permission-locked control can never erase what is saved.
 *
 * Create defaults apply only on create (§4): an update never resets an
 * untouched enum, boolean or date because its control was absent.
 * Server-owned keys (company, actor, generated numbers, computed totals) are
 * never read from the input; unknown keys are ignored or refused, as the
 * endpoint's contract says — never spread into a database write.
 *
 * Normalize once, before domain validation. Client-safe: it imports only the
 * pure parsers beside it.
 */

export const PRESENT_FIELD = "__present";

type Common = {
  /** As the error sentence names the field. Defaults to the key. */
  label?: string;
  /** Required on create; on update an omitted required field is simply untouched. */
  required?: boolean;
  /** Applied on create when the key is omitted. Never on update. */
  createDefault?: unknown;
  /** Derived by the server: whatever the input says is ignored (or refused under `unknownKeys: "reject"`). */
  serverOwned?: boolean;
};

export type FieldSpec = Common &
  (
    | { kind: "text"; max?: number; min?: number; /** Keep leading/trailing whitespace (preformatted text). */ keepWhitespace?: boolean }
    | { kind: "id" }
    | { kind: "enum"; values: readonly string[] }
    | { kind: "boolean" }
    | { kind: "decimal"; rule: DecimalRule }
    | { kind: "date"; rule?: DateOnlyRule }
    | { kind: "list"; max?: number }
  );

export type FieldSpecs = Record<string, FieldSpec>;

export type NormalizeMode = "create" | "update";

export type NormalizeOptions = {
  mode: NormalizeMode;
  /** Keys outside the specs: dropped (default) or refused with a field error. */
  unknownKeys?: "ignore" | "reject";
};

export type NormalizeResult =
  | { ok: true; data: Record<string, unknown>; omitted: string[]; ignored: string[] }
  | { ok: false; fieldErrors: Record<string, string[]>; ignored: string[] };

/** What one key said, before its kind reads it. */
type Raw = { state: "omitted" } | { state: "null" } | { state: "value"; values: unknown[] };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TRUE = new Set(["on", "true", "1", "yes"]);
const FALSE = new Set(["off", "false", "0", "no", ""]);

function labelOf(key: string, spec: FieldSpec): string {
  return spec.label ?? key;
}

function requiredMessage(key: string, spec: FieldSpec): string {
  const label = labelOf(key, spec);
  return spec.kind === "enum" || spec.kind === "id" || spec.kind === "list" ? `Choose ${label.toLowerCase()}.` : `Enter ${label.toLowerCase()}.`;
}

/** Reads one key's value by its kind. `undefined` in `value` means "omit". */
function readField(key: string, spec: FieldSpec, raw: Raw, mode: NormalizeMode): { value?: unknown; omit?: boolean; error?: string } {
  if (raw.state === "omitted") {
    if (mode === "create" && spec.createDefault !== undefined) return { value: spec.createDefault };
    if (mode === "create" && spec.required) return { error: requiredMessage(key, spec) };
    return { omit: true };
  }

  if (spec.kind === "boolean") {
    if (raw.state === "null") return { error: `${labelOf(key, spec)} must be yes or no.` };
    const last = raw.values[raw.values.length - 1];
    if (typeof last === "boolean") return { value: last };
    const text = String(last ?? "").trim().toLowerCase();
    if (TRUE.has(text)) return { value: true };
    if (FALSE.has(text)) return { value: false };
    return { error: `${labelOf(key, spec)} must be yes or no.` };
  }

  if (spec.kind === "list") {
    if (raw.state === "null") return spec.required ? { error: requiredMessage(key, spec) } : { value: [] };
    const items = raw.values.flatMap((item) => (Array.isArray(item) ? item : [item])).map((item) => String(item ?? "").trim()).filter((item) => item !== "");
    if (items.some((item) => !ID.test(item))) return { error: "Unknown record." };
    if (spec.max !== undefined && items.length > spec.max) return { error: `Choose at most ${spec.max}.` };
    if (spec.required && items.length === 0) return { error: requiredMessage(key, spec) };
    return { value: [...new Set(items)] };
  }

  // Scalars: the last value wins, as `FormData.get` would read it.
  const last = raw.state === "null" ? null : raw.values[raw.values.length - 1];
  if (last !== null && typeof last !== "string" && typeof last !== "number") return { error: `${labelOf(key, spec)} is not valid.` };
  const text = last === null ? "" : String(last);
  const trimmed = text.trim();
  if (trimmed === "") {
    // Empty is the person clearing the field (or never filling it): null, not a default, not zero.
    if (spec.required) return { error: requiredMessage(key, spec) };
    return { value: null };
  }

  switch (spec.kind) {
    case "text": {
      const value = spec.keepWhitespace ? text : trimmed;
      if (spec.min !== undefined && value.length < spec.min) return { error: `${labelOf(key, spec)} must be at least ${spec.min} character${spec.min === 1 ? "" : "s"}.` };
      if (spec.max !== undefined && value.length > spec.max) return { error: `${labelOf(key, spec)} must be ${spec.max.toLocaleString("en")} characters or fewer.` };
      return { value };
    }
    case "id":
      return ID.test(trimmed) ? { value: trimmed } : { error: "Unknown record." };
    case "enum":
      return spec.values.includes(trimmed) ? { value: trimmed } : { error: `Choose a valid ${labelOf(key, spec).toLowerCase()}.` };
    case "decimal": {
      // A number from a JSON client is read through the same rule as typed text.
      const parsed = parseDecimalInput(typeof last === "number" ? numberText(last) : trimmed, spec.rule);
      return parsed.ok ? { value: parsed.value } : { error: parsed.message };
    }
    case "date": {
      const parsed = parseDateOnly(trimmed, { label: labelOf(key, spec), ...spec.rule });
      return parsed.ok ? { value: parsed.value } : { error: parsed.message };
    }
  }
}

/**
 * A JSON number as the text the decimal rule reads. NaN and Infinity print as
 * words, and 1e21 or 1e-7 in exponent form: the rule refuses all of them.
 */
function numberText(value: number): string {
  return String(value);
}

function normalize(specs: FieldSpecs, read: (key: string) => Raw, keys: Iterable<string>, options: NormalizeOptions): NormalizeResult {
  const data: Record<string, unknown> = {};
  const omitted: string[] = [];
  const ignored: string[] = [];
  const fieldErrors: Record<string, string[]> = {};

  for (const key of new Set(keys)) {
    if (key === PRESENT_FIELD) continue;
    const spec = specs[key];
    if (spec && !spec.serverOwned) continue;
    ignored.push(key);
    if (options.unknownKeys === "reject") fieldErrors[key] = ["This field can't be set here."];
  }

  for (const [key, spec] of Object.entries(specs)) {
    if (spec.serverOwned) continue;
    const result = readField(key, spec, read(key), options.mode);
    if (result.error) fieldErrors[key] = [result.error];
    else if (result.omit) omitted.push(key);
    else data[key] = result.value;
  }

  return Object.keys(fieldErrors).length ? { ok: false, fieldErrors, ignored } : { ok: true, data, omitted, ignored };
}

/** The keys a form marked as rendered (`<input type="hidden" name="__present" value="isBillable">`). */
function presentKeys(formData: Pick<FormData, "getAll">): Set<string> {
  return new Set(
    formData
      .getAll(PRESENT_FIELD)
      .flatMap((value) => (typeof value === "string" ? value.split(",") : []))
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

/**
 * A browser form's entries as a payload. Files are not read here: an upload
 * has its own contract (§8).
 */
export function normalizeFormData(formData: Pick<FormData, "getAll" | "keys">, specs: FieldSpecs, options: NormalizeOptions): NormalizeResult {
  const present = presentKeys(formData);
  const read = (key: string): Raw => {
    const values = formData.getAll(key).filter((value) => typeof value === "string");
    if (values.length > 0) return { state: "value", values };
    // Rendered but submitted nothing: an unchecked box, an empty multi-select.
    if (present.has(key)) {
      const spec = specs[key];
      if (spec?.kind === "boolean") return { state: "value", values: [false] };
      if (spec?.kind === "list") return { state: "value", values: [] };
      return { state: "value", values: [""] };
    }
    return { state: "omitted" };
  };
  return normalize(specs, read, formData.keys(), options);
}

/**
 * A JSON body as a payload, by the same rules: a missing key (or `undefined`)
 * is omitted, `null` or `""` is a clear, anything else is read by its kind.
 */
export function normalizePayload(body: Record<string, unknown>, specs: FieldSpecs, options: NormalizeOptions): NormalizeResult {
  const read = (key: string): Raw => {
    if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] === undefined) return { state: "omitted" };
    const value = body[key];
    if (value === null) return { state: "null" };
    return { state: "value", values: [value] };
  };
  return normalize(specs, read, Object.keys(body), options);
}
