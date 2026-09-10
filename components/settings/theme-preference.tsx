"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { THEME_COOKIE, type ThemeChoice } from "@/lib/layout/theme-state";
import { cn } from "@/lib/utils/cn";

const OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

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

  function select(next: ThemeChoice) {
    setChoice(next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;

    const root = document.documentElement;
    if (next === "system") delete root.dataset.theme;
    else root.dataset.theme = next;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour scheme"
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
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
