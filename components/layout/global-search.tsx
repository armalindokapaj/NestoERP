"use client";

import * as React from "react";
import { Search } from "lucide-react";

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
const CATEGORIES = ["Projects", "Tasks", "Clients", "Documents", "People"];

export function GlobalSearch() {
  const [open, setOpen] = React.useState(false);
  const [shortcut, setShortcut] = React.useState("Ctrl K");

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
          "flex h-9 w-full items-center gap-2 rounded-md border border-line bg-surface-muted pl-3 pr-2 text-left transition-colors",
          "hover:border-line-strong hover:bg-surface",
        )}
      >
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate text-table text-fg-subtle">
          Search projects, tasks, people or documents…
        </span>
        <kbd
          aria-hidden="true"
          className="hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-micro font-medium text-fg-subtle xl:block"
        >
          {shortcut}
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[12%] max-w-xl translate-y-0 p-0">
          <div className="border-b border-line p-3">
            <DialogTitle className="sr-only">Search NESTO</DialogTitle>
            <SearchField
              autoFocus
              disabled
              placeholder="Search projects, tasks, people or documents…"
              aria-label="Search NESTO"
            />
          </div>

          <div className="p-3">
            <DialogDescription className="mt-0 px-1 pb-2 text-micro uppercase tracking-[0.1em] text-fg-subtle">
              Searchable in a later version
            </DialogDescription>
            <ul className="space-y-0.5">
              {CATEGORIES.map((category) => (
                <li
                  key={category}
                  className="flex items-center justify-between rounded-md px-2.5 py-2 text-table text-fg-muted"
                >
                  {category}
                  <span className="text-micro text-fg-subtle">Not yet indexed</span>
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
