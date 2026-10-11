"use client";

import * as React from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";

/**
 * A drop-in for the browser's `<select>` that draws NESTO's own list instead of
 * the iOS / Android / OS picker. It takes the same `<option>` / `<optgroup>`
 * children and the same `name`, `value`, `defaultValue`, `onChange`, `disabled`,
 * `form` props, so plain GET filter forms and controlled client forms keep
 * working: the chosen value rides in a hidden input, and `onChange` receives an
 * event whose `target` is that input (`target.value`, `target.name`, `target.form`).
 */

/** Radix reserves "" for "no selection", so an empty-valued option travels under this key. */
const EMPTY = "__nesto_empty__";

type OptionEntry = { kind: "option"; value: string; label: React.ReactNode; text: string; disabled: boolean };
type GroupEntry = { kind: "group"; label: string; options: OptionEntry[] };
type Entry = OptionEntry | GroupEntry;

function textOf(node: React.ReactNode): string {
  return React.Children.toArray(node)
    .map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : React.isValidElement(child) ? textOf((child.props as { children?: React.ReactNode }).children) : ""))
    .join("");
}

function collect(children: React.ReactNode): Entry[] {
  const entries: Entry[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { value?: string | number; label?: string; disabled?: boolean; hidden?: boolean; children?: React.ReactNode };
    if (child.type === React.Fragment) {
      entries.push(...collect(props.children));
    } else if (child.type === "optgroup") {
      entries.push({ kind: "group", label: props.label ?? "", options: collect(props.children).filter((entry): entry is OptionEntry => entry.kind === "option") });
    } else if (child.type === "option") {
      if (props.hidden) return;
      const text = textOf(props.children);
      entries.push({
        kind: "option",
        value: props.value === undefined ? text : String(props.value),
        label: props.children ?? props.label ?? "",
        text,
        disabled: Boolean(props.disabled),
      });
    }
  });
  return entries;
}

function flatten(entries: Entry[]): OptionEntry[] {
  return entries.flatMap((entry) => (entry.kind === "group" ? entry.options : [entry]));
}

export type FormSelectProps = Omit<React.ComponentPropsWithoutRef<"select">, "multiple" | "size"> & {
  children?: React.ReactNode;
};

export function FormSelect({
  children,
  className,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  form,
  id,
  autoFocus,
  ...rest
}: FormSelectProps) {
  const entries = collect(children);
  const options = flatten(entries);
  const fallback = options.find((option) => !option.disabled)?.value ?? "";
  const controlled = value !== undefined;
  const [inner, setInner] = React.useState<string>(defaultValue === undefined ? fallback : String(Array.isArray(defaultValue) ? defaultValue[0] ?? "" : defaultValue));
  const current = controlled ? String(Array.isArray(value) ? value[0] ?? "" : value) : inner;
  const hidden = React.useRef<HTMLInputElement>(null);

  // A native select with no matching value shows its first option; do the same.
  const known = options.some((option) => option.value === current);
  const shown = known ? current : options.length > 0 ? fallback : "";
  const empty = options.find((option) => option.value === "");

  function choose(next: string) {
    const value = next === EMPTY ? "" : next;
    if (!controlled) setInner(value);
    const target = hidden.current;
    if (!target) return;
    // Set before notifying, so a handler that submits the form sees the new value.
    target.value = value;
    onChange?.({
      target,
      currentTarget: target,
      type: "change",
      preventDefault() {},
      stopPropagation() {},
      persist() {},
    } as unknown as React.ChangeEvent<HTMLSelectElement>);
  }

  const radixValue = shown === "" ? (required ? "" : empty ? EMPTY : "") : shown;
  // Radix writes the chosen option into the trigger only once its list has mounted in the browser, so the
  // server's HTML would show an empty control until the page hydrates. Naming the choice here puts it in that HTML.
  const chosen = radixValue === "" ? undefined : options.find((option) => option.value === shown);
  const renderOption = (option: OptionEntry, key: string) => (
    <SelectItem key={key} value={option.value === "" ? EMPTY : option.value} data-value={option.value} disabled={option.disabled}>
      {option.label}
    </SelectItem>
  );

  return (
    <>
      <input ref={hidden} type="hidden" name={name} value={shown} form={form} disabled={disabled} readOnly />
      <Select value={radixValue} onValueChange={choose} disabled={disabled}>
        <SelectTrigger id={id} aria-required={required || undefined} autoFocus={autoFocus} className={cn("w-auto min-w-0 text-left", className)} {...(rest as React.ComponentProps<typeof SelectTrigger>)}>
          <SelectValue placeholder={empty ? empty.text : undefined}>{chosen?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {entries.map((entry, index) =>
            entry.kind === "group" ? (
              <React.Fragment key={`g${index}`}>
                <div className="px-2.5 pb-1 pt-2 text-meta font-medium text-fg-subtle">{entry.label}</div>
                {entry.options.map((option, i) => renderOption(option, `g${index}-${i}`))}
              </React.Fragment>
            ) : (
              renderOption(entry, `o${index}`)
            ),
          )}
        </SelectContent>
      </Select>
    </>
  );
}
