"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils/cn";

/**
 * Global search (design spec §16, §63).
 *
 * The shell, the shortcut and the results surface are real; the search itself
 * is not built in V0.1, so the panel says so plainly rather than returning an
 * empty list that reads like a bug. Categories are already in place for when
 * the index lands.
 */
const CATEGORIES = ["projects", "tasks", "clients", "documents", "people"] as const;

export function GlobalSearch() {
  const [open, setOpen] = React.useState(false);
  const [shortcut, setShortcut] = React.useState("Ctrl K");
  const t = useTranslations("search");

  React.useEffect(() => {
    if (navigator.platform.toLowerCase().includes("mac")) setShortcut("⌘ K");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-10 w-full items-center gap-2.5 rounded-lg border border-line bg-surface-muted pl-3.5 pr-2 text-left transition-colors",
          "hover:border-line-strong hover:bg-surface",
        )}
      >
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate text-table text-fg-subtle">
          {t("placeholder")}
        </span>
        <kbd
          aria-hidden="true"
          className="hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-micro font-medium text-fg-subtle lg:block"
        >
          {shortcut}
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[12%] max-w-xl translate-y-0 p-0">
          <div className="border-b border-line p-3">
            <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>
            <SearchField
              autoFocus
              disabled
              placeholder={t("placeholder")}
              aria-label={t("dialogTitle")}
            />
          </div>

          <div className="p-3">
            <DialogDescription className="mt-0 px-1 pb-2 text-micro uppercase tracking-[0.1em] text-fg-subtle">
              {t("later")}
            </DialogDescription>
            <ul className="space-y-0.5">
              {CATEGORIES.map((category) => (
                <li
                  key={category}
                  className="flex items-center justify-between rounded-md px-2.5 py-2 text-table text-fg-muted"
                >
                  {t(`categories.${category}`)}
                  <span className="text-micro text-fg-subtle">{t("notIndexed")}</span>
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
