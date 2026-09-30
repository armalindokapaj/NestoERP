"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

/**
 * Pick one record of another kind — a Project, Company, Client, Employee,
 * Supplier, Unit, Contract (MOB-04 §31-§34).
 *
 * A trigger that shows the chosen record opens a sheet with a search field and
 * the matches; it never becomes a 300-item native dropdown. The sheet is the
 * same on every width (docked on a phone, a centred panel from `sm`). The
 * chosen id is a hidden input named `name`, so it submits and is counted for
 * unsaved changes with the rest of the form.
 *
 * Where the options come from is the module's choice, and both ways keep
 * authorization on the server:
 *   - `options`: a small, already-authorized list, filtered here as you type.
 *   - `load(query, cursor)`: server search with cursor pagination for a large
 *     set (clients, employees, suppliers, units) — nothing is preloaded, and
 *     the action behind it returns only what this person may reference.
 * `readOnlyValue` (a prefilled, locked relation — context prefill, §34) renders
 * the chosen record without a trigger.
 */
export type RelationOption = { value: string; label: string; description?: string };
export type RelationPage = { options: RelationOption[]; nextCursor?: string | null };

export function RelationSelector({
  name,
  label,
  value,
  selected,
  options,
  load,
  disabled,
  locked,
  required,
  invalid,
  describedBy,
  id,
  onChange,
  placeholder,
  title,
}: {
  name: string;
  label: string;
  /** The chosen id (uncontrolled start value). */
  value?: string;
  /** The chosen record's label and description, so the trigger can show it before any search runs. */
  selected?: RelationOption | null;
  options?: RelationOption[];
  load?: (query: string, cursor: string | null) => Promise<RelationPage>;
  disabled?: boolean;
  /** A relation the context fixed (creating a Task inside a Project): shown, not changeable. */
  locked?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  id?: string;
  onChange?: (option: RelationOption | null) => void;
  placeholder?: string;
  title?: string;
}) {
  const t = useTranslations("ui");
  const [open, setOpen] = React.useState(false);
  const [chosen, setChosen] = React.useState<RelationOption | null>(selected ?? (value ? { value, label: value } : null));
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState<RelationOption[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const request = React.useRef(0);
  const trigger = React.useRef<HTMLButtonElement>(null);

  const local = React.useMemo(() => {
    if (!options) return null;
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((o) => `${o.label} ${o.description ?? ""}`.toLowerCase().includes(needle)) : options;
  }, [options, query]);

  // Server search: debounced, and a late answer to an older query is dropped.
  React.useEffect(() => {
    if (!open || !load) return;
    const ticket = ++request.current;
    setLoading(true);
    const handle = window.setTimeout(() => {
      load(query.trim(), null)
        .then((result) => {
          if (ticket !== request.current) return;
          setPage(result.options);
          setCursor(result.nextCursor ?? null);
        })
        .catch(() => ticket === request.current && setPage([]))
        .finally(() => ticket === request.current && setLoading(false));
    }, query ? 250 : 0);
    return () => window.clearTimeout(handle);
  }, [open, load, query]);

  function loadMore() {
    if (!load || !cursor || loading) return;
    const ticket = ++request.current;
    setLoading(true);
    load(query.trim(), cursor)
      .then((result) => {
        if (ticket !== request.current) return;
        setPage((current) => [...current, ...result.options]);
        setCursor(result.nextCursor ?? null);
      })
      .finally(() => ticket === request.current && setLoading(false));
  }

  function choose(option: RelationOption | null) {
    setChosen(option);
    onChange?.(option);
    setOpen(false);
  }

  const shown = local ?? page;

  if (locked) {
    return (
      <div id={id} data-relation-locked className="flex min-h-10 items-center rounded-md border border-line bg-surface-muted px-3 text-body text-fg touch:min-h-11">
        <input type="hidden" name={name} value={chosen?.value ?? ""} />
        <span className="min-w-0 [overflow-wrap:anywhere]">{chosen?.label ?? "—"}</span>
      </div>
    );
  }

  return (
    <>
      {required ? (
        // A required relation must take part in native validation, which skips hidden inputs:
        // a visually hidden, read-only text input carries the id and the constraint, and hands
        // focus to the trigger when the form focuses the first invalid field.
        <input
          type="text"
          name={name}
          value={chosen?.value ?? ""}
          required
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          data-relation-input
          onFocus={() => trigger.current?.focus()}
        />
      ) : (
        <input type="hidden" name={name} value={chosen?.value ?? ""} data-relation-input />
      )}
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-control bg-surface px-3 text-left text-body touch:h-11",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 data-[invalid=true]:border-danger",
          chosen ? "text-fg" : "text-fg-subtle",
        )}
      >
        <span className="min-w-0 truncate">{chosen?.label ?? placeholder ?? t("mob04SelectPlaceholder")}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      </button>

      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={title ?? label}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <div className="space-y-3">
          <Input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("mob04SearchOptions")}
            aria-label={t("mob04SearchOptions")}
          />
          <ul role="listbox" aria-label={label} aria-busy={loading || undefined} className="-mx-1 flex flex-col">
            {!required && chosen ? (
              <li role="option" aria-selected={false}>
                <button type="button" onClick={() => choose(null)} className="flex min-h-12 w-full items-center rounded-md px-3 text-left text-body text-fg-muted hover:bg-hover">
                  {t("clear")}
                </button>
              </li>
            ) : null}
            {shown.map((option) => {
              const active = option.value === chosen?.value;
              return (
                <li key={option.value} role="option" aria-selected={active}>
                  <button type="button" onClick={() => choose(option)} className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-hover">
                    <span className="min-w-0 flex-1">
                      <span className="block text-body text-fg [overflow-wrap:anywhere]">{option.label}</span>
                      {option.description ? <span className="block text-meta text-fg-subtle [overflow-wrap:anywhere]">{option.description}</span> : null}
                    </span>
                    {active ? <Check aria-hidden="true" className="size-4 shrink-0 text-accent-strong" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {!loading && shown.length === 0 ? <p className="px-3 text-table text-fg-subtle">{t("mob04NoOptions")}</p> : null}
          {load && cursor ? (
            <Button type="button" variant="secondary" className="w-full" onClick={loadMore} disabled={loading}>
              {loading ? t("loading") : t("mob04LoadMore")}
            </Button>
          ) : null}
        </div>
      </BottomSheet>
    </>
  );
}
