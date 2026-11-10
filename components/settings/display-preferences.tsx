"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { LOOK_COOKIE, LOOKS, lookAttribute, type Look } from "@/lib/layout/look-state";
import { cn } from "@/lib/utils/cn";

/**
 * Theme 1 / Theme 2 (lib/layout/look-state.ts).
 *
 * Written the way the colour scheme is (theme-preference.tsx): the choice goes
 * into a cookie and onto <html> at the same moment, so the change is immediate
 * here and already correct on the server for every later page.
 */

/** Stores the look for a year and applies it, and says whether the browser kept it. */
export function applyLook(look: Look): boolean {
  document.cookie = `${LOOK_COOKIE}=${look}; path=/; max-age=31536000; samesite=lax`;
  const root = document.documentElement;
  const attribute = lookAttribute(look);
  if (attribute === undefined) delete root.dataset.look;
  else root.dataset.look = attribute;
  return document.cookie.split("; ").includes(`${LOOK_COOKIE}=${look}`);
}

const STYLES = {
  group: "inline-flex shrink-0 gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5 look2:rounded-full look2:border-transparent look2:bg-surface look2:p-[3px] look2:shadow-[0_0_0_1px_var(--nesto-border)]",
  option: "inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-table font-medium transition-colors touch:min-h-11 touch:min-w-11 look2:rounded-full look2:px-3.5",
  selected: "bg-accent-soft text-accent-strong look2:bg-primary look2:text-primary-fg",
  idle: "text-fg-muted hover:text-fg",
} as const;

/**
 * One choice among a few, as a radio group (AUD-11 §3): one Tab stop — the
 * checked option — and the arrow keys move and select, wrapping at the ends.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  /** Each option is `${testId}-${value}`. */
  testId?: string;
  className?: string;
}) {
  const styles = STYLES;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const edge = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : undefined;
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const current = options.findIndex((option) => option.value === value);
    const next = edge ?? (current + step! + options.length) % options.length;
    onChange(options[next].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn(styles.group, className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            data-testid={testId ? `${testId}-${option.value}` : undefined}
            className={cn(styles.option, selected ? styles.selected : styles.idle)}
          >
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A setting's row on the Appearance page: what it is, what it does, and the choice. */
function SettingRow({ title, hint, notSaved, children }: { title: string; hint: string; notSaved: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-card font-semibold text-fg look2:font-display">{title}</p>
        <p className="mt-1 text-table text-fg-muted">{hint}</p>
        {/* Said plainly when the browser kept nothing; the change still applies to this page. */}
        <p role="status" className="text-meta text-warning-strong [&:not(:empty)]:mt-1">{notSaved}</p>
      </div>
      {children}
    </div>
  );
}

export function LookPreference({ initial }: { initial: Look }) {
  const t = useTranslations("settings");
  const [look, setLook] = React.useState(initial);
  const [saved, setSaved] = React.useState(true);

  return (
    <SettingRow title={t("appearance.look")} hint={t("appearance.lookHint")} notSaved={saved ? null : t("appearance.notSaved")}>
      <ChoiceGroup
        label={t("appearance.look")}
        value={look}
        options={LOOKS.map((value) => ({ value, label: t(`appearance.looks.${value}`) }))}
        onChange={(next) => {
          setLook(next);
          setSaved(applyLook(next));
        }}
        testId="look"
      />
    </SettingRow>
  );
}
