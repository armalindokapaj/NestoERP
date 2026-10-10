"use client";

import * as React from "react";
import { Building2, FolderKanban, Loader2, Search, User, Users, X } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { GlassPanel, type GlassPanelControl } from "@/components/ui/glass-panel";
import { useRouter } from "@/components/navigation/guarded-router";
import { cn } from "@/lib/utils/cn";

type Result = { type: string; id: string; title: string; subtitle: string; href: string };

const SECTIONS: { key: "organizations" | "projects" | "users"; types: string[] }[] = [
  { key: "organizations", types: ["Group", "Company"] },
  { key: "projects", types: ["Project"] },
  { key: "users", types: ["User", "Person"] },
];
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { Group: Building2, Company: Building2, Project: FolderKanban, User, Person: Users };

function readRecent(key: string): Result[] {
  try { return (JSON.parse(window.localStorage.getItem(key) ?? "[]") as Result[]).slice(0, 5); } catch { return []; }
}
function remember(key: string, result: Result) {
  try { window.localStorage.setItem(key, JSON.stringify([result, ...readRecent(key).filter((row) => row.href !== result.href)].slice(0, 5))); } catch { /* per-browser convenience only */ }
}

/**
 * Platform Admin global search (Admin IA §16-§18): a command dialog opened by
 * the top bar or ⌘K / Ctrl+K. Requests are debounced and the obsolete one is
 * aborted; results are grouped, reachable by arrow keys, and Enter opens the
 * entity's own page. Recent picks are kept in this browser only.
 *
 * It opens as the shell's glass panel, the same as search in a company: out of
 * the search icon, on the breadcrumb bar's top line, the page left in view.
 */
export function PlatformSearch({ endpoint = "/api/platform-admin/search", recentKey = "platformAdmin.search.recent" }: { endpoint?: string; recentKey?: string } = {}) {
  const t = useTranslations("admin");
  const tu = useTranslations("ui");
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const controlRef = React.useRef<GlassPanelControl | null>(null);
  const openRef = React.useRef(open);
  openRef.current = open;
  /** By the person's own hand: the panel travels back into the icon first. */
  const close = React.useCallback(() => (controlRef.current ? controlRef.current.close() : setOpen(false)), []);
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
        if (openRef.current) close();
        else setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  React.useEffect(() => {
    if (open) { setRecent(readRecent(recentKey)); setActive(0); } else { setQuery(""); setResults([]); setState("idle"); }
  }, [open, recentKey]);

  const term = query.trim();
  React.useEffect(() => {
    if (term.length < 2) { setResults([]); setState("idle"); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState("loading");
      try {
        const response = await fetch(`${endpoint}?q=${encodeURIComponent(term)}`, { signal: controller.signal });
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
  }, [term, endpoint]);

  const typeLabel = (type: string) => (type === "Group" ? t("search.typeGroup") : type === "Company" ? t("search.typeCompany") : type === "Project" ? t("search.typeProject") : type === "User" ? t("search.typeUser") : type === "Person" ? t("search.typePerson") : type);
  const showing = term.length >= 2 ? results : recent;
  const groups = term.length >= 2
    ? SECTIONS.map((section) => ({ label: t(`search.${section.key}`), rows: results.filter((row) => section.types.includes(row.type)) })).filter((group) => group.rows.length)
    : recent.length ? [{ label: t("search.recent"), rows: recent }] : [];
  const ordered = groups.flatMap((group) => group.rows);

  function choose(result: Result) {
    remember(recentKey, result);
    setOpen(false);
    router.push(result.href);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("search.ariaTrigger")}
        aria-keyshortcuts="Meta+K Control+K"
        title={`${t("search.ariaTrigger")} (${mac ? "⌘K" : "Ctrl+K"})`}
        data-testid="admin-search-trigger"
      >
        <Search className="size-5" strokeWidth={1.6} aria-hidden="true" />
      </button>
      <GlassPanel
        open={open}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
        controlRef={controlRef}
        title={t("search.dialogTitle")}
        testId="admin-search"
        header={
          <div className="flex items-center gap-2 border-b border-line/70 px-3">
            <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <input
              data-autofocus
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
              className="h-12 w-full min-w-0 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle"
            />
            {state === "loading" ? <Loader2 className="size-4 shrink-0 animate-spin text-fg-subtle" aria-label={t("search.searching")} /> : null}
            <button type="button" onClick={close} className="grid size-9 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg touch:size-11" aria-label={tu("close")}>
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        }
      >
          <div id="admin-search-results" role="listbox" aria-label={t("search.results")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
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
      </GlassPanel>
    </>
  );
}
