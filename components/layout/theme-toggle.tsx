"use client";

import * as React from "react";
import { Moon, Sun } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { applyThemeChoice } from "@/components/settings/theme-preference";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

type Scheme = "light" | "dark";

/** Day or Night, as the root layout rendered it or the last switch set it. */
function currentScheme(): Scheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Follows the scheme after mount, and whenever it changes here or in Settings. */
function useScheme(): Scheme | null {
  const [scheme, setScheme] = React.useState<Scheme | null>(null);

  React.useEffect(() => {
    const update = () => setScheme(currentScheme());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return scheme;
}

/**
 * One-click sun/moon switch between Day and Night. Sun at Night, moon by Day;
 * the name says which scheme a press switches to. It writes through the
 * same function as Settings › Appearance, so the two always agree.
 *
 * `icon` is the top bar's button; `row` is the phone's More sheet, where the bar
 * has no room and a 48px row keeps a comfortable target.
 */
export function ThemeToggle({ variant = "icon", className }: { variant?: "icon" | "row"; className?: string }) {
  const t = useTranslations("settings");
  const scheme = useScheme();
  const next: Scheme = scheme === "light" ? "dark" : "light";
  const label = t(`appearance.themes.${next}`);
  const Icon = scheme === "light" ? Moon : Sun;

  function toggle() {
    applyThemeChoice(currentScheme() === "dark" ? "light" : "dark");
  }

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={toggle}
        data-testid="theme-toggle"
        className={cn("flex min-h-12 w-full items-center gap-3 border-b border-line px-3 text-left font-medium text-fg hover:bg-hover font-mono text-table uppercase tracking-[0.08em]", className)}
      >
        <Icon aria-hidden="true" className="size-[18px] text-fg-subtle" />
        {label}
      </button>
    );
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={label} data-testid="theme-toggle" className={className}>
      <Icon aria-hidden="true" className="size-[18px]" />
    </Button>
  );
}
