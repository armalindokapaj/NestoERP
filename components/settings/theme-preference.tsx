"use client";

import * as React from "react";
import { Moon, Sun } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { THEME_CHOICES, THEME_COOKIE, type ThemeChoice } from "@/lib/layout/theme-state";
import { cn } from "@/lib/utils/cn";

const ICONS = { light: Sun, dark: Moon } as const;

/**
 * Stores Day or Night in the cookie and applies it to the document, fading
 * slowly. Shared by this setting and the one-click toggles, so all write the
 * same way.
 */
export function applyThemeChoice(choice: ThemeChoice) {
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`;

  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = choice;
  };

  // A slow cross-fade between the two schemes, never a flash (styles/globals.css
  // `theme-fading`). Reduced motion gets the instant change.
  const calm = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!calm || typeof document.startViewTransition !== "function") {
    apply();
    return;
  }
  root.classList.add("theme-fading");
  const transition = document.startViewTransition(apply);
  const done = () => root.classList.remove("theme-fading");
  transition.finished.then(done, done);
}

/**
 * The Nesto theme's one choice: Day or Night (design spec §85, §86;
 * docs/ui/UI-03-nesto-theme.md §1).
 *
 * The choice is written to a cookie and applied to the document at the same
 * moment, so the change is immediate here and already correct on the server
 * for every later page.
 */
export function ThemePreference({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = React.useState<ThemeChoice>(initial);
  const t = useTranslations("settings");
  const group = React.useRef<HTMLDivElement>(null);

  /*
   * A radio group behaves like one (AUD-11 §3): one Tab stop — the checked
   * option — and the arrow keys move and select, wrapping at the ends.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const edge = event.key === "Home" ? 0 : event.key === "End" ? THEME_CHOICES.length - 1 : undefined;
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const current = THEME_CHOICES.indexOf(choice);
    const next = edge ?? (current + step! + THEME_CHOICES.length) % THEME_CHOICES.length;
    select(THEME_CHOICES[next]);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }

  function select(next: ThemeChoice) {
    setChoice(next);
    applyThemeChoice(next);
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={t("appearance.colourScheme")}
      onKeyDown={onKeyDown}
      className="inline-flex shrink-0 gap-0.5 border rounded-full border-transparent bg-surface p-[3px] shadow-[0_0_0_1px_var(--nesto-border)]"
    >
      {THEME_CHOICES.map((value) => {
        const active = choice === value;
        const Icon = ICONS[value];

        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => select(value)}
            data-testid={`theme-${value}`}
            className={cn(
              "inline-flex items-center gap-1.5 py-1.5 text-table font-medium transition-colors rounded-full px-3.5",
              active ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {t(`appearance.themes.${value}`)}
          </button>
        );
      })}
    </div>
  );
}
