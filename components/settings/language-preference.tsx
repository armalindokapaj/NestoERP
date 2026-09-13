"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { LocaleFlag } from "@/components/i18n/locale-flag";
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils/cn";

/**
 * Interface language, offered to every user on the Settings landing page.
 *
 * Built like the colour scheme control beside it in Appearance: a cookie the
 * server reads before rendering, written here and followed by a refresh, so
 * every server-rendered string on the page comes back in the new language
 * without a full reload. Personal — nobody else's language changes.
 *
 * Each option is the language's own name next to its flag, so someone who
 * cannot read the language currently showing still finds theirs.
 */
export function LanguagePreference() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("settings");
  const [choice, setChoice] = React.useState<Locale>(locale);
  const [isPending, startTransition] = React.useTransition();

  function select(next: Locale) {
    if (next === choice) return;
    setChoice(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("language.title")}
      aria-busy={isPending}
      className="inline-flex shrink-0 gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5"
    >
      {LOCALES.map((option) => {
        const active = choice === option;

        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            lang={option}
            onClick={() => select(option)}
            // The same selected treatment as ThemePreference (§97).
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-table font-medium transition-colors",
              active ? "bg-accent-soft text-accent-strong" : "text-fg-muted hover:text-fg",
            )}
          >
            <LocaleFlag locale={option} />
            {LOCALE_NAMES[option]}
          </button>
        );
      })}
    </div>
  );
}
