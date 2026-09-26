/**
 * Semantic dirty tracking for a native form (AUD-03 §3 "Dirty-state rules").
 *
 * A form's meaning is what it would submit, so the baseline is exactly that:
 * for every named field, the values `FormData` would carry, in order. The
 * comparison is per field — a keystroke recomputes one name, not the whole
 * form — and it is exact: nothing is trimmed, rounded or reordered, so a
 * restored value is clean again and a reordered row is not.
 *
 * Values are held in the editor's own closure, never in a shared store.
 */

export type FieldValues = readonly string[];
export type FormBaseline = Map<string, FieldValues>;

/** Fields that are plumbing, not input: Next's action ids, concurrency stamps, the tab's context. */
const IGNORED_PREFIXES = ["$ACTION_", "__"];
const IGNORED_NAMES = new Set(["expectedVersion", "versionUpdatedAt", "acceptDuplicate"]);

export function isIgnoredName(name: string, extra?: ReadonlySet<string>): boolean {
  if (!name) return true;
  if (IGNORED_NAMES.has(name) || extra?.has(name)) return true;
  return IGNORED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * One value as `FormData` would carry it. A file is its name, size and
 * modification time — never its bytes — and an empty file input is the empty
 * selection, whose placeholder `File` would otherwise differ on every read.
 */
export function serializeValue(value: FormDataEntryValue): string {
  if (typeof value === "string") return `s:${value}`;
  if (value.name === "" && value.size === 0) return "f:";
  return `f:${value.name}:${value.size}:${value.lastModified}`;
}

export function sameValues(a: FieldValues | undefined, b: FieldValues | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

/** The names whose current values differ from the baseline. */
export function diffNames(baseline: FormBaseline, current: FormBaseline): Set<string> {
  const changed = new Set<string>();
  for (const name of new Set([...baseline.keys(), ...current.keys()])) {
    if (!sameValues(baseline.get(name), current.get(name))) changed.add(name);
  }
  return changed;
}

type Submittable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isSubmittable(element: Element): element is Submittable {
  const tag = element.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}

/**
 * The values one element contributes, following the form-data set rules:
 * disabled controls, buttons and unchecked boxes contribute nothing.
 */
function elementValues(element: Submittable): string[] {
  if (element.disabled || element.matches(":disabled")) return [];
  if (element instanceof HTMLSelectElement) {
    return [...element.selectedOptions].map((option) => serializeValue(option.value));
  }
  if (element instanceof HTMLTextAreaElement) return [serializeValue(element.value)];
  const type = element.type;
  if (type === "submit" || type === "button" || type === "reset" || type === "image") return [];
  if (type === "checkbox" || type === "radio") return element.checked ? [serializeValue(element.value)] : [];
  if (type === "file") {
    const files = element.files ? [...element.files] : [];
    return files.length ? files.map(serializeValue) : ["f:"];
  }
  return [serializeValue(element.value)];
}

function controls(form: HTMLFormElement): Submittable[] {
  return [...form.elements].filter(isSubmittable);
}

/** The current values of one field. */
export function readField(form: HTMLFormElement, name: string): FieldValues {
  const values: string[] = [];
  for (const element of controls(form)) if (element.name === name) values.push(...elementValues(element));
  return values;
}

/** The whole form, for the baseline and for the full comparison before a decision. */
export function readForm(form: HTMLFormElement, ignore?: ReadonlySet<string>): FormBaseline {
  const snapshot: FormBaseline = new Map();
  for (const element of controls(form)) {
    const name = element.name;
    if (isIgnoredName(name, ignore) || element.closest("[data-unsaved-ignore]")) continue;
    const values = elementValues(element);
    const previous = snapshot.get(name);
    snapshot.set(name, previous ? [...previous, ...values] : values);
  }
  return snapshot;
}
