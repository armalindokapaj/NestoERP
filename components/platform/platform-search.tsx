"use client";

import * as React from "react";
import { Building2, FolderKanban, Loader2, Search, User, Users } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/components/navigation/guarded-router";
import { cn } from "@/lib/utils/cn";

type Result = { type: string; id: string; title: string; subtitle: string; href: string };

const RECENT_KEY = "platformAdmin.search.recent";
const SECTIONS: { key: "organizations" | "projects" | "users"; types: string[] }[] = [
  { key: "organizations", types: ["Group", "Company"] },
  { key: "projects", types: ["Project"] },
  { key: "users", types: ["User", "Person"] },
];
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { Group: Building2, Company: Building2, Project: FolderKanban, User, Person: Users };

function readRecent(): Result[] {
  try { return (JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as Result[]).slice(0, 5); } catch { return []; }
}
function remember(result: Result) {
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify([result, ...readRecent().filter((row) => row.href !== result.href)].slice(0, 5))); } catch { /* per-browser convenience only */ }
}

/**
 * Platform Admin global search (Admin IA §16-§18): a command dialog opened by
 * the top bar or ⌘K / Ctrl+K. Requests are debounced and the obsolete one is
 * aborted; results are grouped, reachable by arrow keys, and Enter opens the
 * entity's own page. Recent picks are kept in this browser only.
 */
export function PlatformSearch() {
  const t = useTranslations("admin");
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Result[]>([]);
  const [recent, setRecent] = React.useState<Result[]>([]);
  const [state, setState] = React.useState<"idle" | "loading" | "error">("idle");
  const [active, setActive] = React.useState(0);
  const router = useRouter();
  const [mac, setMac] = React.useState(true);

  React.useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (open) { setRecent(readRecent()); setActive(0); } else { setQuery(""); setResults([]); setState("idle"); }
  }, [open]);

  const term = query.trim();
  React.useEffect(() => {
    if (term.length < 2) { setResults([]); setState("idle"); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState("loading");
      try {
        const response = await fetch(`/api/platform-admin/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const json = await response.json() as { data?: Result[] };
        setResults(json.data ?? []);
        setActive(0);
        setState("idle");
      } catch (error) {
        if (!controller.signal.aborted) setState("error");
        void error;
      }
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [term]);

  const typeLabel = (type: string) => (type === "Group" ? t("search.typeGroup") : type === "Company" ? t("search.typeCompany") : type === "Project" ? t("search.typeProject") : type === "User" ? t("search.typeUser") : type === "Person" ? t("search.typePerson") : type);
  const showing = term.length >= 2 ? results : recent;
  const groups = term.length >= 2
    ? SECTIONS.map((section) => ({ label: t(`search.${section.key}`), rows: results.filter((row) => section.types.includes(row.type)) })).filter((group) => group.rows.length)
    : recent.length ? [{ label: t("search.recent"), rows: recent }] : [];
  const ordered = groups.flatMap((group) => group.rows);

  function choose(result: Result) {
    remember(result);
    setOpen(false);
    router.push(result.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-full min-w-0 max-w-xl cursor-pointer items-center gap-2 rounded-lg border border-line bg-canvas px-3 text-left text-body text-fg-subtle transition hover:border-line-strong hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        aria-label={t("search.ariaTrigger")}
        aria-keyshortcuts="Meta+K Control+K"
        data-testid="admin-search-trigger"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate">{t("search.placeholderTrigger")}</span>
        <kbd className="hidden rounded border border-line bg-surface px-1.5 font-sans text-micro text-fg-subtle sm:inline">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[12vh] max-w-xl -translate-y-0 overflow-hidden p-0" aria-describedby={undefined} data-testid="admin-search">
          <DialogTitle className="sr-only">{t("search.dialogTitle")}</DialogTitle>
          <div className="flex items-center gap-2 border-b border-line px-4">
            <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, ordered.length - 1)); }
                if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
                if (event.key === "Enter" && ordered[active]) { event.preventDefault(); choose(ordered[active]); }
              }}
              placeholder={t("search.placeholder")}
              aria-label={t("search.ariaTrigger")}
              role="combobox"
              aria-expanded={ordered.length > 0}
              aria-controls="admin-search-results"
              aria-activedescendant={ordered[active] ? `admin-search-${active}` : undefined}
              className="h-14 w-full bg-transparent pr-8 text-body text-fg outline-none placeholder:text-fg-subtle"
            />
            {state === "loading" ? <Loader2 className="size-4 shrink-0 animate-spin text-fg-subtle" aria-label={t("search.searching")} /> : null}
          </div>
          <div id="admin-search-results" role="listbox" aria-label={t("search.results")} className="max-h-[min(420px,60dvh)] overflow-y-auto overscroll-contain p-2">
            {state === "error" ? (
              <p className="px-3 py-6 text-center text-table text-danger-strong" role="alert">{t("search.unavailable")}</p>
            ) : term.length >= 2 && state === "idle" && showing.length === 0 ? (
              <p className="px-3 py-6 text-center text-table text-fg-muted">{t("search.noResults", { term })}</p>
            ) : term.length < 2 && groups.length === 0 ? (
              <p className="px-3 py-6 text-center text-table text-fg-muted">{t("search.hint")}</p>
            ) : groups.map((group) => (
              <div key={group.label} role="group" aria-label={group.label} className="py-1">
                <p className="px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.08em] text-fg-subtle">{group.label}</p>
                {group.rows.map((row) => {
                  const index = ordered.indexOf(row);
                  const Icon = ICONS[row.type] ?? Search;
                  return (
                    <button
                      key={`${row.type}:${row.id}`}
                      id={`admin-search-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      onMouseMove={() => setActive(index)}
                      onClick={() => choose(row)}
                      className={cn("flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left", index === active ? "bg-hover" : "")}
                    >
                      <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><span className="block text-body font-medium text-fg">{row.title}</span><span className="block text-meta text-fg-subtle">{row.subtitle}</span></span>
                      <span className="rounded bg-surface-muted px-2 py-0.5 text-micro text-fg-muted">{typeLabel(row.type)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
