"use client";

import * as React from "react";

import { parseOptionalDateOnly, type DateOnlyRule } from "@/lib/forms/dates";
import { parseOptionalDecimal, type DecimalRule } from "@/lib/forms/decimal";

/**
 * The field and submission contract every form shares (AUD-09 §3, §6;
 * FV-02, FV-03, FV-12).
 *
 * `useFormContract` is what RecordForm is built on, exported so a form that
 * owns its markup (Clients with its duplicate warning, a workflow form) keeps
 * the same behaviour:
 *
 * - **Timing.** Nothing is shown on load. A field is checked when the person
 *   leaves it; everything is checked on submit. Once a field shows an error it
 *   is re-checked as it is corrected — the message beside it changes or goes,
 *   but nothing is announced per keystroke (the messages are not live regions;
 *   only the summary, which appears on submit, is).
 * - **One rule.** The browser's own constraints (`required`, `min`, `maxLength`,
 *   `type`) plus a field's `validate` — which runs the same `lib/forms` parser
 *   the server schema runs — set the control's validity, so the native
 *   `checkValidity()` that AUD-03's Save and continue calls sees the same
 *   verdict as the button does.
 * - **Summary and focus.** An invalid submit shows a summary linking every
 *   invalid field, opens any collapsed section (`<details>`) holding one, and
 *   focuses the first invalid field. The browser's own bubbles are suppressed:
 *   the messages are ours, beside the fields.
 * - **Server errors.** Field errors the server returned sit beside their
 *   fields and in the summary; an error for a path no field renders (a row, a
 *   rule over the whole form) is listed in the summary as text. Editing a field
 *   retires the server's verdict on its old value.
 * - **Enter.** Never submits from a textarea (native) or while an input method
 *   is composing; buttons inside the form that do not say `type` are made
 *   `type="button"`, so only the form's own submit button submits.
 *
 * The contract validates; it never decides. The server validates again and is
 * the authority (§3): a valid-looking form is not an accepted one.
 */

export type FieldValidator = (value: string, control: FormControl) => string | null;

export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

type Registration = { label: string; validate?: FieldValidator };

export type SummaryEntry = { name: string; label: string; message: string; controlId: string | null };

export type FormContract = {
  /** A per-instance id prefix (`useId`): a page form and a dialog never share an id. */
  prefix: string;
  /** Always prefix ids (dialogs, repeated editors). Otherwise a bare id is kept unless it collides. */
  scoped: boolean;
  register: (name: string, registration: Registration) => () => void;
  /** The message a field shows now, if any. */
  errorFor: (name: string) => string | undefined;
  /** The summary: shown after a submit attempt while anything is invalid. */
  summary: { visible: boolean; entries: SummaryEntry[] };
  summaryRef: React.RefObject<HTMLDivElement | null>;
  formProps: {
    noValidate: true;
    onBlur: React.FocusEventHandler<HTMLFormElement>;
    onInput: React.FormEventHandler<HTMLFormElement>;
    onChange: React.FormEventHandler<HTMLFormElement>;
    onInvalidCapture: React.FormEventHandler<HTMLFormElement>;
    onKeyDown: React.KeyboardEventHandler<HTMLFormElement>;
  };
  /**
   * Checks everything before a submit. `true`: go on and send. `false`: the
   * form showed why (summary, open sections, focus) and nothing is sent.
   */
  checkBeforeSubmit: () => boolean;
  /** After a server refusal: show its field errors and open sections holding them. */
  showServerRefusal: () => void;
  focusFirstInvalid: () => void;
};

const ContractContext = React.createContext<FormContract | null>(null);

export function FormContractProvider({ value, children }: { value: FormContract; children: React.ReactNode }) {
  return <ContractContext.Provider value={value}>{children}</ContractContext.Provider>;
}

export function useFormContractContext(): FormContract | null {
  return React.useContext(ContractContext);
}

function isControl(element: unknown): element is FormControl {
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;
}

/** Whether a control takes part in validation: named, enabled, and not a hidden input or a button. */
function validatable(control: FormControl): boolean {
  if (!control.name || control.disabled) return false;
  if (control instanceof HTMLInputElement && ["hidden", "submit", "button", "reset", "image"].includes(control.type)) return false;
  return control.willValidate;
}

function controlsNamed(form: HTMLFormElement, name: string): FormControl[] {
  return [...form.elements].filter((element): element is FormControl => isControl(element) && element.name === name);
}

function labelText(control: FormControl): string {
  const label = control.labels?.[0]?.textContent ?? control.getAttribute("aria-label") ?? control.name;
  return label.replace(/\s*\*\s*$/, "").replace(/\s*\(optional\)\s*$/i, "").trim() || control.name;
}

function decimalsOf(step: string): number | null {
  if (!step || step === "any") return null;
  const fraction = step.split(".")[1];
  return fraction ? fraction.length : 0;
}

/**
 * The sentence for a control's native validity, in the product's words
 * rather than the browser's (which follow the browser's language, not the
 * app's, and differ between browsers).
 */
export function messageForValidity(control: FormControl, label: string): string | null {
  const validity = control.validity;
  if (validity.valid) return null;
  if (validity.customError) return control.validationMessage;
  const choice = control instanceof HTMLSelectElement || (control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type));
  if (validity.valueMissing) return choice ? `Choose ${label.toLowerCase()}.` : `Enter ${label.toLowerCase()}.`;
  if (control instanceof HTMLInputElement) {
    if (validity.badInput) {
      if (control.type === "number") return `${label} must be a number, e.g. 1234.50.`;
      if (control.type.startsWith("date") || control.type === "time" || control.type === "month") return `${label} must be a real date.`;
      return `${label} is not valid.`;
    }
    if (validity.typeMismatch) {
      if (control.type === "email") return "Enter an email address like name@example.com.";
      if (control.type === "url") return "Enter a web address like https://example.com.";
    }
    const dated = control.type.startsWith("date") || control.type === "time" || control.type === "month";
    if (validity.rangeUnderflow) return dated ? `${label} must be on or after ${control.min}.` : `${label} must be ${control.min} or more.`;
    if (validity.rangeOverflow) return dated ? `${label} must be on or before ${control.max}.` : `${label} must be ${control.max} or less.`;
    if (validity.stepMismatch) {
      const decimals = decimalsOf(control.step);
      if (decimals === 0) return `${label} must be a whole number.`;
      if (decimals !== null) return `${label} can have at most ${decimals} decimal place${decimals === 1 ? "" : "s"}.`;
    }
    if (validity.patternMismatch) return control.title || `${label} is not in the expected format.`;
  }
  if (validity.tooShort) return `${label} must be at least ${(control as HTMLInputElement).minLength} characters.`;
  if (validity.tooLong) return `${label} must be ${(control as HTMLInputElement).maxLength} characters or fewer.`;
  return control.validationMessage || `${label} is not valid.`;
}

/** A field validator from a `lib/forms` decimal rule: the same parse the server schema runs. Empty is left to `required`. */
export function decimalValidator(rule: DecimalRule): FieldValidator {
  return (value) => {
    const parsed = parseOptionalDecimal(value, rule);
    return parsed.ok ? null : parsed.message;
  };
}

/** A field validator for a date-only value (`lib/forms/dates`). Empty is left to `required`. */
export function dateValidator(rule: DateOnlyRule = {}): FieldValidator {
  return (value) => {
    const parsed = parseOptionalDateOnly(value, rule);
    return parsed.ok ? null : parsed.message;
  };
}

/**
 * Enter while an input method is composing confirms a word; it is not the
 * person submitting (AUD-09 §6, FV-12). A textarea's Enter is a new line
 * natively and never reaches the form's submit.
 */
export function guardComposingEnter(event: React.KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter") return;
  if (event.nativeEvent.isComposing || event.keyCode === 229) event.preventDefault();
}

/**
 * Buttons that do not say what they are default to "submit" inside a form:
 * a row's "Add", a picker's "Clear" would save the form. Only the form's own
 * submit button may submit (§6, FV-12), so an untyped button becomes
 * `type="button"` — now and whenever one is added.
 */
export function useSubmitOnlyButton(formRef: React.RefObject<HTMLFormElement | null>) {
  React.useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const fix = () => form.querySelectorAll("button:not([type])").forEach((button) => button.setAttribute("type", "button"));
    fix();
    const observer = new MutationObserver(fix);
    observer.observe(form, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [formRef]);
}

/** Opens every collapsed section (`<details>`) around an element. */
export function reveal(element: Element) {
  let details = element.closest("details");
  while (details) {
    details.open = true;
    details = details.parentElement?.closest("details") ?? null;
  }
}

const NO_ERRORS: Record<string, string[] | undefined> = {};

export function useFormContract(
  formRef: React.RefObject<HTMLFormElement | null>,
  { serverErrors = NO_ERRORS, scoped = false }: { serverErrors?: Record<string, string[] | undefined>; scoped?: boolean } = {},
): FormContract {
  const prefix = `f${React.useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const registrations = React.useRef(new Map<string, Registration>());
  const touched = React.useRef(new Set<string>());
  const [clientErrors, setClientErrors] = React.useState<Record<string, string>>({});
  const [attempted, setAttempted] = React.useState(false);
  // Fields edited since the server answered: its verdict was about their old values.
  const [retired, setRetired] = React.useState<Set<string>>(() => new Set());
  const summaryRef = React.useRef<HTMLDivElement>(null);
  const invalidBatch = React.useRef<Record<string, string> | null>(null);
  const serverErrorsRef = React.useRef(serverErrors);
  serverErrorsRef.current = serverErrors;

  React.useEffect(() => setRetired(new Set()), [serverErrors]);

  const labelFor = React.useCallback((name: string, control?: FormControl) => registrations.current.get(name)?.label ?? (control ? labelText(control) : name), []);

  /** Sets the field's own rule on its controls, so native validity is the whole verdict. */
  const applyRule = React.useCallback((name: string) => {
    const form = formRef.current;
    const validate = registrations.current.get(name)?.validate;
    if (!form || !validate) return;
    for (const control of controlsNamed(form, name)) {
      control.setCustomValidity(control.disabled || control.value.trim() === "" ? "" : (validate(control.value, control) ?? ""));
    }
  }, [formRef]);

  const errorOf = React.useCallback((name: string): string | null => {
    const form = formRef.current;
    if (!form) return null;
    applyRule(name);
    for (const control of controlsNamed(form, name)) {
      if (!validatable(control)) continue;
      const message = messageForValidity(control, labelFor(name, control));
      if (message) return message;
    }
    return null;
  }, [formRef, applyRule, labelFor]);

  const setOne = React.useCallback((name: string, message: string | null) => {
    setClientErrors((current) => {
      if ((current[name] ?? null) === message) return current;
      const next = { ...current };
      if (message) next[name] = message;
      else delete next[name];
      return next;
    });
  }, []);

  const register = React.useCallback((name: string, registration: Registration) => {
    registrations.current.set(name, registration);
    // The rule holds from the start, so Save and continue's native check sees it.
    queueMicrotask(() => applyRule(name));
    return () => {
      if (registrations.current.get(name) === registration) registrations.current.delete(name);
    };
  }, [applyRule]);

  const invalidNow = React.useCallback((): Record<string, string> => {
    const form = formRef.current;
    const result: Record<string, string> = {};
    if (!form) return result;
    for (const name of registrations.current.keys()) applyRule(name);
    for (const element of form.elements) {
      if (!isControl(element) || !validatable(element) || result[element.name]) continue;
      const message = messageForValidity(element, labelFor(element.name, element));
      if (message) result[element.name] = message;
    }
    return result;
  }, [formRef, applyRule, labelFor]);

  const visibleServer = React.useCallback((name: string) => (retired.has(name) ? undefined : serverErrors[name]?.[0]), [retired, serverErrors]);

  const errorFor = React.useCallback((name: string) => clientErrors[name] ?? visibleServer(name), [clientErrors, visibleServer]);

  const focusFirstInvalid = React.useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const errored = new Set([...Object.keys(clientErrors), ...Object.keys(serverErrors).filter((name) => serverErrors[name]?.length && !retired.has(name))]);
    const first = [...form.elements].find((element): element is FormControl => isControl(element) && !element.disabled && (errored.has(element.name) || (validatable(element) && !element.validity.valid)));
    if (first) {
      reveal(first);
      first.focus();
    } else summaryRef.current?.focus();
  }, [formRef, clientErrors, serverErrors, retired]);

  const checkBeforeSubmit = React.useCallback(() => {
    const invalid = invalidNow();
    for (const name of Object.keys(invalid)) touched.current.add(name);
    setClientErrors(invalid);
    if (Object.keys(invalid).length === 0) return true;
    setAttempted(true);
    const form = formRef.current;
    if (form) {
      const first = [...form.elements].find((element): element is FormControl => isControl(element) && Boolean(invalid[element.name]));
      for (const name of Object.keys(invalid)) for (const control of controlsNamed(form, name)) reveal(control);
      // After the messages render, so the field's description is attached when focus lands.
      window.setTimeout(() => (first ? first.focus() : summaryRef.current?.focus()), 0);
    }
    return false;
  }, [invalidNow, formRef]);

  const showServerRefusal = React.useCallback(() => {
    setAttempted(true);
    const form = formRef.current;
    if (!form) return;
    // Opened now; AUD-03's save focuses the first refused field once it is visible.
    for (const name of Object.keys(serverErrorsRef.current)) for (const control of controlsNamed(form, name)) reveal(control);
  }, [formRef]);
  // The refusal's errors arrive with the render after it: open their sections then too.
  React.useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    for (const name of Object.keys(serverErrors)) for (const control of controlsNamed(form, name)) reveal(control);
  }, [serverErrors, formRef]);

  const onBlur = React.useCallback<React.FocusEventHandler<HTMLFormElement>>((event) => {
    const target = event.target;
    if (!isControl(target) || !target.name) return;
    // Leaving for another control of the same group (a radio set) is not leaving the field.
    const next = event.relatedTarget;
    if (isControl(next) && next.name === target.name) return;
    touched.current.add(target.name);
    setOne(target.name, errorOf(target.name));
  }, [errorOf, setOne]);

  const onEdit = React.useCallback<React.FormEventHandler<HTMLFormElement>>((event) => {
    const target = event.target;
    if (!isControl(target) || !target.name) return;
    const name = target.name;
    applyRule(name);
    if (serverErrorsRef.current[name]?.length) setRetired((current) => (current.has(name) ? current : new Set(current).add(name)));
    // Re-checked as it is corrected once it has shown an error — or, for a
    // choice, as soon as it is made (a select or a box has no "typing").
    const choice = target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && ["checkbox", "radio", "date", "file"].includes(target.type));
    setClientErrors((current) => {
      if (!(name in current) && !(choice && touched.current.has(name))) return current;
      const message = errorOf(name);
      if ((current[name] ?? null) === message) return current;
      const next = { ...current };
      if (message) next[name] = message;
      else delete next[name];
      return next;
    });
  }, [applyRule, errorOf]);

  const onInvalidCapture = React.useCallback<React.FormEventHandler<HTMLFormElement>>((event) => {
    // A native check (AUD-03's Save and continue, `reportValidity`) found this
    // field invalid: show our message, not the browser's bubble.
    event.preventDefault();
    const target = event.target;
    if (!isControl(target) || !target.name) return;
    touched.current.add(target.name);
    const message = messageForValidity(target, labelFor(target.name, target));
    if (!message) return;
    if (!invalidBatch.current) {
      invalidBatch.current = {};
      queueMicrotask(() => {
        const batch = invalidBatch.current ?? {};
        invalidBatch.current = null;
        setClientErrors((current) => ({ ...current, ...batch }));
        setAttempted(true);
        const form = formRef.current;
        if (form) for (const name of Object.keys(batch)) for (const control of controlsNamed(form, name)) reveal(control);
      });
    }
    invalidBatch.current[target.name] ??= message;
  }, [labelFor, formRef]);

  useSubmitOnlyButton(formRef);

  const entries = React.useMemo<SummaryEntry[]>(() => {
    const form = formRef.current;
    const names = [...new Set([...Object.keys(clientErrors), ...Object.keys(serverErrors).filter((name) => serverErrors[name]?.length && !retired.has(name))])];
    const order = form ? [...form.elements].filter(isControl).map((element) => element.name) : [];
    const position = (name: string) => {
      const index = order.indexOf(name);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    return names
      .sort((a, b) => position(a) - position(b))
      .map((name) => {
        const control = form ? controlsNamed(form, name).find((item) => !(item instanceof HTMLInputElement && item.type === "hidden")) : undefined;
        return { name, label: labelFor(name, control), message: clientErrors[name] ?? serverErrors[name]?.[0] ?? "", controlId: control?.id || null };
      })
      .filter((entry) => entry.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the DOM order is read when the errors change
  }, [clientErrors, serverErrors, retired, labelFor]);

  return {
    prefix,
    scoped,
    register,
    errorFor,
    summary: { visible: attempted && entries.length > 0, entries },
    summaryRef,
    formProps: { noValidate: true, onBlur, onInput: onEdit, onChange: onEdit, onInvalidCapture, onKeyDown: guardComposingEnter },
    checkBeforeSubmit,
    showServerRefusal,
    focusFirstInvalid,
  };
}

/**
 * The summary an invalid submit shows (§6): how many things to fix, each a
 * link that focuses its field. An error for something no field renders (a
 * row, a rule over the whole form) is listed as text. A live region, because
 * it appears on submit — never per keystroke.
 */
export function FormErrorSummary({ contract, title = "Check the highlighted fields" }: { contract: Pick<FormContract, "summary" | "summaryRef">; title?: string }) {
  const { visible, entries } = contract.summary;
  if (!visible) return null;
  return (
    <div
      ref={contract.summaryRef}
      role="alert"
      tabIndex={-1}
      data-testid="form-error-summary"
      className="space-y-1.5 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong outline-none"
    >
      <p className="font-medium">
        {title} ({entries.length})
      </p>
      <ul className="list-disc space-y-0.5 pl-5">
        {entries.map((entry) => (
          <li key={entry.name} data-field={entry.name}>
            {entry.controlId ? (
              <a
                href={`#${entry.controlId}`}
                className="underline underline-offset-2"
                onClick={(event) => {
                  const control = document.getElementById(entry.controlId!);
                  if (!control) return;
                  event.preventDefault();
                  reveal(control);
                  control.focus();
                }}
              >
                {entry.label}: {entry.message}
              </a>
            ) : (
              <span>{entry.message}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Wires a Field's control once it is in the DOM (FV-02): a unique id, the
 * label pointing at it, hint and error through `aria-describedby`,
 * `aria-invalid` while an error shows, and `required`/`aria-required` from the
 * same rule the label shows. Works whatever the control is wrapped in, so the
 * module forms that pass `id={name}` keep working: that bare id is kept on a
 * page while it is unique — the existing selectors and links rely on it — and
 * replaced by a per-instance id inside a dialog or wherever it would collide.
 */
export function useFieldWiring({
  name,
  required,
  hint,
  error,
  wrapperRef,
}: {
  name: string;
  required?: boolean;
  hint?: string;
  error?: string;
  wrapperRef: React.RefObject<HTMLElement | null>;
}): { controlId: string; nativeRequired: boolean } {
  const contract = useFormContractContext();
  const ownId = `f${React.useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [controlId, setControlId] = React.useState(name);
  const [nativeRequired, setNativeRequired] = React.useState(false);

  React.useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(name) : name;
    // The control that submits this name, else the one carrying it as its id.
    // A picker whose value travels in a hidden input has neither: its visible
    // part is labelled and described, but only the module decides whether an
    // empty search box is "missing" — it is never made natively required here.
    const submitting =
      [...wrapper.querySelectorAll<HTMLElement>(`[name="${escaped}"]`)].find((element) => !(element instanceof HTMLInputElement && element.type === "hidden")) ??
      wrapper.querySelector<HTMLElement>(`#${escaped}`);
    const control = submitting ?? wrapper.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, [role=combobox]");
    if (!control) return;

    const scoped = Boolean(contract?.scoped) || Boolean(wrapper.closest('[role="dialog"]'));
    const instanceId = `${contract?.prefix ?? ownId}-${name.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    const collides = (candidate: string) => [...document.querySelectorAll(`[id="${candidate.replace(/["\\]/g, "\\$&")}"]`)].some((other) => other !== control);
    let id = control.id;
    if (scoped) {
      // Inside a dialog the bare name would repeat the page's own field.
      if (!id || id === name) id = instanceId;
    } else {
      if (!id) id = name;
      // Kept bare while it is unique on the page; the later form yields.
      if (collides(id)) id = instanceId;
    }
    if (control.id !== id) control.id = id;
    if (id !== controlId) setControlId(id);

    // Our descriptions, merged with whatever the control carries of its own.
    const previous = (control.dataset.fieldDescribed ?? "").split(" ").filter(Boolean);
    const kept = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((token) => token && !previous.includes(token));
    const ours = error ? [`${id}-error`] : hint ? [`${id}-hint`] : [];
    const described = [...new Set([...kept, ...ours])];
    if (described.length) control.setAttribute("aria-describedby", described.join(" "));
    else control.removeAttribute("aria-describedby");
    if (ours.length) control.dataset.fieldDescribed = ours.join(" ");
    else delete control.dataset.fieldDescribed;

    if (error) {
      control.setAttribute("aria-invalid", "true");
      control.dataset.fieldInvalid = "true";
    } else if (control.dataset.fieldInvalid) {
      control.removeAttribute("aria-invalid");
      delete control.dataset.fieldInvalid;
    }

    const native = Boolean(submitting) && isControl(control) && !(control instanceof HTMLInputElement && control.type === "hidden") && !control.hasAttribute("readonly");
    if (required) {
      if (native && !(control as FormControl).required) (control as FormControl).required = true;
      control.setAttribute("aria-required", "true");
    }
    const isRequired = Boolean(required) || (native && (control as FormControl).required);
    if (isRequired !== nativeRequired) setNativeRequired(isRequired);
  }, [wrapperRef, name, contract?.scoped, contract?.prefix, ownId, controlId, error, hint, required, nativeRequired]);

  return { controlId, nativeRequired };
}
