"use client";

import { LocaleFlag } from "@/components/i18n/locale-flag";
import { useChangeLocale } from "@/components/i18n/use-change-locale";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/config";
import { cn } from "@/lib/utils/cn";

/**
 * The language control for the corner of a header, where Settings'
 * LanguagePreference would not fit: one button showing the language the page
 * is in, as its flag and code. Clicking it moves to the next language — with
 * two, that is simply the other one. The language it would switch to is named
 * on hover.
 *
 * On a phone the code drops away and the flag carries it alone.
 */
export function LocaleSwitch({ label, className }: { label: string; className?: string }) {
  const { choice, change, isPending } = useChangeLocale();
  const next = LOCALES[(LOCALES.indexOf(choice) + 1) % LOCALES.length];

  return (
    <button
      type="button"
      onClick={() => change(next)}
      disabled={isPending}
      aria-label={`${label}: ${LOCALE_NAMES[choice]}`}
      title={LOCALE_NAMES[next]}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-micro font-semibold uppercase tracking-wide text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-60",
        className,
      )}
    >
      <LocaleFlag locale={choice} />
      <span aria-hidden="true" className="hidden sm:inline">
        {choice}
      </span>
    </button>
  );
}
