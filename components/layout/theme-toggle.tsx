"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { applyThemeChoice } from "@/components/settings/theme-preference";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

type Scheme = "light" | "dark";

/** The scheme in force: the explicit `data-theme` choice, else the operating system's. */
function currentScheme(): Scheme {
  const choice = document.documentElement.dataset.theme;
  if (choice === "light" || choice === "dark") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Follows the scheme after mount — the server cannot know the operating
 * system's — and whenever it changes, here, in Settings or in the OS.
 */
function useScheme(): Scheme | null {
  const [scheme, setScheme] = React.useState<Scheme | null>(null);

  React.useEffect(() => {
    const update = () => setScheme(currentScheme());
    update();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);

  return scheme;
}

/**
 * One-click sun/moon switch (Black & Gold reskin §4). Sun when dark, moon when
 * light; the name says which scheme a press switches to. It writes through the
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
        className={cn("flex min-h-12 w-full items-center gap-3 border-b border-line px-3 text-left text-body font-medium text-fg hover:bg-hover", className)}
      >
        <Icon aria-hidden="true" className="size-[18px] text-accent-strong" strokeWidth={1.6} />
        {label}
      </button>
    );
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={label} data-testid="theme-toggle" className={className}>
      <Icon aria-hidden="true" strokeWidth={1.6} className="size-[18px]" />
    </Button>
  );
}
