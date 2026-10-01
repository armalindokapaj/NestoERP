"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { THEME_COOKIE, type ThemeChoice } from "@/lib/layout/theme-state";
import { cn } from "@/lib/utils/cn";

const OPTIONS = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

/**
 * Stores the choice in the cookie and applies it to the document, fading slowly. Shared
 * by this setting and the top bar's one-click toggle, so both write the same way.
 */
export function applyThemeChoice(choice: ThemeChoice) {
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`;

  const root = document.documentElement;
  const apply = () => {
    if (choice === "system") delete root.dataset.theme;
    else root.dataset.theme = choice;
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
 * Colour scheme preference (design spec §85, §86).
 *
 * A real setting, like the navigation width beside it. The choice is written
 * to a cookie and applied to the document at the same moment, so the change is
 * immediate here and already correct on the server for every later page.
 *
 * "System" stores no attribute, which hands the decision back to
 * `prefers-color-scheme`.
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
    const edge = event.key === "Home" ? 0 : event.key === "End" ? OPTIONS.length - 1 : undefined;
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const current = OPTIONS.findIndex((option) => option.value === choice);
    const next = edge ?? (current + step! + OPTIONS.length) % OPTIONS.length;
    select(OPTIONS[next].value);
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
      className="inline-flex shrink-0 gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = choice === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => select(option.value)}
            /*
             * The same selected treatment as an active sidebar item, rather
             * than a raised white chip: in dark mode `surface` is *darker*
             * than the track it sits on, so a raised chip would read as
             * recessed. The accent pair works in both schemes and means one
             * selected-state pattern across the product (§97).
             */
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-table font-medium transition-colors",
              active
                ? "bg-accent-soft text-accent-strong"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <option.icon aria-hidden="true" className="size-4" />
            {t(`appearance.themes.${option.value}`)}
          </button>
        );
      })}
    </div>
  );
}
