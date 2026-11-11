"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";
import { PHONE_NAV_CHOICES, PHONE_NAV_COOKIE, type PhoneNav } from "@/lib/layout/nav-layout";
import { cn } from "@/lib/utils/cn";

/**
 * Settings › Appearance: the navigation layout for a phone
 * (docs/ui/UI-04-navigation-layouts.md). A desktop has one, the top bar's
 * Ribbon. The choice is written to its cookie and to `<html>`, and the shell
 * is drawn again by the server, so the new layout replaces the old one at
 * once and is already right on the next page.
 */
export function NavigationPreference({ phone }: { phone: PhoneNav }) {
  const t = useTranslations("settings");
  const router = useRouter();

  function save(value: PhoneNav) {
    document.cookie = `${PHONE_NAV_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.phoneNav = value;
    router.refresh();
  }

  return (
    <LayoutChoice
      title={t("appearance.phoneNav")}
      hint={t("appearance.phoneNavHint")}
      choices={PHONE_NAV_CHOICES}
      initial={phone}
      testId="phone-nav"
      labelOf={(value) => t(`appearance.phoneNavs.${value}.label`)}
      hintOf={(value) => t(`appearance.phoneNavs.${value}.hint`)}
      defaultLabel={t("appearance.defaultChoice")}
      preview={(value) => <PhonePreview value={value} />}
      onSelect={save}
    />
  );
}

/**
 * One choice as a radio group of cards. A radio group behaves like one
 * (AUD-11 §3): one Tab stop, the checked card, and the arrow keys move and
 * select, wrapping at the ends. The first choice is the default.
 */
function LayoutChoice<T extends string>({
  title,
  hint,
  choices,
  initial,
  testId,
  labelOf,
  hintOf,
  defaultLabel,
  preview,
  onSelect,
}: {
  title: string;
  hint: string;
  choices: readonly T[];
  initial: T;
  testId: string;
  labelOf: (value: T) => string;
  hintOf: (value: T) => string;
  defaultLabel: string;
  preview: (value: T) => React.ReactNode;
  onSelect: (value: T) => void;
}) {
  const [choice, setChoice] = React.useState<T>(initial);
  const group = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  function select(next: T) {
    if (next === choice) return;
    setChoice(next);
    onSelect(next);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (choices.indexOf(choice) + step + choices.length) % choices.length;
    select(choices[next]!);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }

  return (
    <div>
      <p id={titleId} className="text-card text-fg font-display">{title}</p>
      <p className="mt-1 text-table text-fg-muted">{hint}</p>
      <div
        ref={group}
        role="radiogroup"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        data-testid={testId}
        className="mt-4 grid gap-3 sm:grid-cols-2"
      >
        {choices.map((value, index) => {
          const active = choice === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => select(value)}
              data-testid={`${testId}-${value}`}
              className={cn(
                "flex items-start gap-4 rounded-[10px] border bg-surface p-3 text-left transition-colors",
                active ? "border-accent ring-1 ring-accent" : "border-line hover:bg-hover",
              )}
            >
              <span aria-hidden="true" className="shrink-0">{preview(value)}</span>
              <span className="min-w-0 pt-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-body font-semibold text-fg">{labelOf(value)}</span>
                  {index === 0 ? <span className="nesto-eyebrow text-fg-subtle">{defaultLabel}</span> : null}
                </span>
                <span className="mt-1 block text-table text-fg-muted">{hintOf(value)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* A small drawing of each layout: the shape of the screen, not a screenshot. */

function PhonePreview({ value }: { value: PhoneNav }) {
  return (
    <span className="relative block h-16 w-10 overflow-hidden rounded-lg border border-line-strong bg-canvas">
      <span className="absolute left-1.5 right-1.5 top-2 space-y-1">
        <span className="block h-1 w-2/3 rounded-full bg-fg-subtle/40" />
        <span className="block h-1 w-full rounded-full bg-fg-subtle/25" />
      </span>
      {value === "pocket" ? (
        <>
          {/* The strip: This page, Units, Create. */}
          <span className="absolute inset-x-1 bottom-[0.9rem] flex h-2.5 items-center gap-0.5 rounded-[3px] border border-line bg-surface p-px">
            <span className="h-full flex-1 rounded-[2px] bg-accent/60" />
            <span className="h-full w-1.5 rounded-[2px] bg-fg-subtle/40" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          {/* The bar: five tabs. */}
          <span className="absolute inset-x-0 bottom-0 flex h-3 items-center justify-around border-t border-line bg-surface">
            <span className="h-1 w-1 rounded-full bg-accent" />
            <span className="h-1 w-1 rounded-full bg-fg-subtle/60" />
            <span className="h-1 w-1 rounded-full bg-fg-subtle/60" />
            <span className="h-1 w-1 rounded-full bg-fg-subtle/60" />
            <span className="h-1 w-1 rounded-full bg-fg-subtle/60" />
          </span>
        </>
      ) : (
        // One bar: Ribbon, the page's action, Units, Create.
        <span className="absolute inset-x-0 bottom-0 flex h-3.5 items-center gap-0.5 border-t border-line bg-surface px-0.5">
          <span className="h-1.5 w-1.5 rounded-[2px] bg-fg-subtle/60" />
          <span className="h-2 flex-1 rounded-[2px] bg-primary" />
          <span className="h-1.5 w-1.5 rounded-[2px] bg-fg-subtle/60" />
          <span className="h-1.5 w-1.5 rounded-full border border-fg-subtle/70" />
        </span>
      )}
    </span>
  );
}
