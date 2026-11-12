"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Building2, Clock3, FolderKanban, Loader2, Network, Search, User, Users, type IconComponent } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import { adminText } from "@/components/platform/admin-i18n";
import { useRouter } from "@/components/navigation/guarded-router";
import { markMatch, matchScore } from "@/lib/core/search/palette";
import { DialogScrim } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";

/** What `/api/platform-admin/search` answers with. */
type Result = { type: string; id: string; title: string; subtitle: string; href: string };

/** A page the palette can go to, its name and the area it is in already in the reader's language. */
export type AdminSearchPage = { key: string; label: string; href: string; icon: string; place: string };
/** Something the palette can start: the one global Create's entries. */
export type AdminSearchCreate = { key: string; label: string; href: string; icon: IconComponent };

/** The filters under the field, in order; `types` are the search's own kinds, Pages is the palette's list. */
const SCOPES = [
  { key: "all", types: null },
  { key: "organizations", types: ["Group", "Company"] },
  { key: "projects", types: ["Project"] },
  { key: "users", types: ["User", "Person"] },
  { key: "pages", types: [] },
] as const satisfies ReadonlyArray<{ key: string; types: readonly string[] | null }>;
type Scope = (typeof SCOPES)[number]["key"];

const RECORD_ICONS: Record<string, IconComponent> = { Group: Network, Company: Building2, Project: FolderKanban, User, Person: Users };
const TYPE_KEYS: Record<string, string> = { Group: "typeGroup", Company: "typeCompany", Project: "typeProject", User: "typeUser", Person: "typePerson" };

type Option = { key: string; title: string; subtitle?: string; tag?: string; href: string; icon: IconComponent; record?: Result };
type Group = { key: string; label: string; rows: Option[] };

function readRecent(key: string): Result[] {
  try {
    return (JSON.parse(window.localStorage.getItem(key) ?? "[]") as Result[]).slice(0, 5);
  } catch {
    return [];
  }
}
function remember(key: string, result: Result) {
  try {
    window.localStorage.setItem(key, JSON.stringify([result, ...readRecent(key).filter((row) => row.href !== result.href)].slice(0, 5)));
  } catch {
    /* a per-browser convenience only */
  }
}

/**
 * The Admin Console's search (docs/ui/UI-09-admin-console.md §Search), drawn
 * as the company app's palette (docs/ui/UI-08-search.md): a centred palette
 * from 640px, the whole screen on a phone. One field finds organizations,
 * projects and people (`/api/platform-admin/search`), the console's pages and
 * what can be created, with filters by kind under it. Opened by the field in
 * the top bar, the magnifier on a phone, or Ctrl+K / ⌘K anywhere.
 */
export function AdminSearch({ pages, create, recentKey }: { pages: AdminSearchPage[]; create: AdminSearchCreate[]; recentKey: string }) {
  const t = useTranslations("admin");
  const tu = useTranslations("ui");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<Scope>("all");
  const [results, setResults] = React.useState<Result[]>([]);
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">("idle");
  const [recent, setRecent] = React.useState<Result[]>([]);
  const [active, setActive] = React.useState(0);
  const [mac, setMac] = React.useState(true);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

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
    if (open) setRecent(readRecent(recentKey));
    else {
      setQuery("");
      setScope("all");
      setResults([]);
      setStatus("idle");
    }
  }, [open, recentKey]);

  const term = query.trim();
  const asks = term.length >= 2 && scope !== "pages";
  React.useEffect(() => {
    if (!asks) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const response = await fetch(`/api/platform-admin/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        setResults(((await response.json()) as { data?: Result[] }).data ?? []);
        setStatus("idle");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [term, asks]);

  React.useEffect(() => setActive(0), [term, scope, results]);

  const recordOption = (row: Result): Option => ({
    key: `record:${row.type}:${row.id}`,
    title: row.title,
    subtitle: row.subtitle,
    tag: adminText(t, `search.${TYPE_KEYS[row.type] ?? ""}`, row.type),
    href: row.href,
    icon: RECORD_ICONS[row.type] ?? Search,
    record: row,
  });
  const pageOption = (page: AdminSearchPage): Option => ({ key: `page:${page.key}`, title: page.label, subtitle: page.place, href: page.href, icon: getIcon(page.icon) });
  const createOption = (item: AdminSearchCreate): Option => ({ key: `create:${item.key}`, title: t("shell.createNamed", { name: item.label }), href: item.href, icon: item.icon });

  const groups: Group[] = [];
  if (term) {
    const records = SCOPES.filter((entry) => entry.types?.length && (scope === "all" || scope === entry.key)).map((entry) => ({
      key: entry.key,
      label: t(`search.${entry.key}`),
      rows: results.filter((row) => (entry.types as readonly string[]).includes(row.type)).map(recordOption),
    }));
    const scored = <T,>(items: T[], label: (item: T) => string, keywords: (item: T) => string[]) =>
      items.map((item) => ({ item, score: matchScore(term, label(item), keywords(item)) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
    const pageHits = scope === "all" || scope === "pages" ? scored(pages, (page) => page.label, (page) => [page.place]) : [];
    const createHits = scope === "all" ? scored(create, (item) => item.label, () => []) : [];
    const go = { key: "pages", label: t("search.goTo"), rows: pageHits.slice(0, scope === "pages" ? undefined : 4).map((entry) => pageOption(entry.item)) };
    const make = { key: "create", label: t("search.createGroup"), rows: createHits.slice(0, 3).map((entry) => createOption(entry.item)) };
    // A page or an action named by what was typed comes first; otherwise after the records.
    const first = pageHits[0]?.score === 3 || createHits[0]?.score === 3;
    groups.push(...(first ? [go, make, ...records] : [...records, go, make]));
  } else if (scope === "all") {
    groups.push({ key: "recent", label: t("search.recent"), rows: recent.map((row) => ({ ...recordOption(row), key: `recent:${row.type}:${row.id}`, icon: RECORD_ICONS[row.type] ?? Clock3 })) });
    groups.push({ key: "create", label: t("search.createGroup"), rows: create.map(createOption) });
  } else if (scope === "pages") {
    for (const page of pages) {
      const last = groups[groups.length - 1];
      if (last && last.label === page.place) last.rows.push(pageOption(page));
      else groups.push({ key: `area:${page.place}`, label: page.place, rows: [pageOption(page)] });
    }
  }
  const shown = groups.filter((group) => group.rows.length > 0);
  const ordered = shown.flatMap((group) => group.rows);

  function choose(option: Option) {
    if (option.record) remember(recentKey, option.record);
    setOpen(false);
    router.push(option.href);
  }

  function step(by: 1 | -1) {
    const index = SCOPES.findIndex((entry) => entry.key === scope);
    setScope(SCOPES[(index + by + SCOPES.length) % SCOPES.length]!.key);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, ordered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && ordered[active]) {
      event.preventDefault();
      choose(ordered[active]);
    } else if (event.key === "Tab") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    }
  }

  const scopeLabel = t(scope === "all" ? "search.all" : `search.${scope}`);
  const loading = status === "loading";
  let message: string | null = null;
  if (status === "error") message = t("search.unavailable");
  else if (!ordered.length && term && (asks ? !loading : true)) message = term.length < 2 && scope !== "pages" ? t("search.hint") : scope === "all" ? t("search.noResults", { term }) : t("search.noResultsIn", { scope: scopeLabel, term });
  else if (!ordered.length && !term) message = scope === "pages" ? null : t("search.hint");

  let index = -1;
  return (
    <>
      {/* An icon, and from lg a field-shaped button that takes what the bar's right side leaves, with its shortcut from xl. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("search.ariaTrigger")}
        aria-keyshortcuts="Meta+K Control+K"
        title={`${t("search.ariaTrigger")} (${mac ? "⌘K" : "Ctrl+K"})`}
        data-testid="admin-search-trigger"
        className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-none text-fg-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:size-11 lg:flex lg:h-10 lg:w-auto lg:min-w-0 lg:flex-1 lg:justify-start lg:gap-2 lg:border lg:border-line lg:bg-surface lg:pl-3.5 lg:pr-2 lg:hover:border-line-strong lg:hover:bg-surface"
      >
        <Search aria-hidden="true" className="size-[18px] shrink-0 lg:size-4" />
        <span aria-hidden="true" className="hidden min-w-0 flex-1 truncate text-left text-body text-fg-subtle lg:inline">{t("search.trigger")}</span>
        <kbd aria-hidden="true" className="hidden shrink-0 rounded-none border border-line px-1.5 py-px font-mono text-[0.625rem] tracking-[0.06em] text-fg-subtle xl:inline">{mac ? "⌘K" : "Ctrl+K"}</kbd>
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogScrim className="max-sm:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (triggerRef.current?.isConnected && triggerRef.current.getClientRects().length > 0) triggerRef.current.focus({ preventScroll: true });
            }}
            className={cn(
              "fixed z-[60] flex flex-col bg-surface text-fg outline-none data-[state=open]:animate-[nesto-fade-in_140ms_var(--nesto-ease)]",
              "max-sm:inset-0 max-sm:pt-[var(--nesto-safe-top)]",
              "sm:left-1/2 sm:top-[max(4.5rem,12vh)] sm:max-h-[min(40rem,calc(100dvh-max(4.5rem,12vh)-2rem))] sm:w-[min(45rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:border sm:border-line-strong sm:shadow-dialog",
            )}
            data-testid="admin-search"
          >
            <DialogPrimitive.Title className="sr-only">{t("search.dialogTitle")}</DialogPrimitive.Title>

            <div className="flex items-center gap-3 border-b border-line px-4 max-sm:gap-2 max-sm:py-2 max-sm:pr-2 sm:h-14">
              <div className="relative flex min-w-0 flex-1 items-center max-sm:h-11 max-sm:border max-sm:border-line-strong max-sm:bg-surface-muted max-sm:pl-3">
                {loading ? <Loader2 aria-label={t("search.searching")} className="size-[18px] shrink-0 animate-spin text-fg-subtle" /> : <Search aria-hidden="true" className="size-[18px] shrink-0 text-fg-subtle" />}
                <input
                  ref={inputRef}
                  type="search"
                  role="combobox"
                  aria-expanded={ordered.length > 0}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={ordered[active] ? `${listId}-option-${active}` : undefined}
                  aria-label={t("search.dialogTitle")}
                  placeholder={t("search.placeholderTrigger")}
                  value={query}
                  maxLength={200}
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onKeyDown}
                  className="h-full w-full min-w-0 bg-transparent pl-3 pr-2 text-[1.0625rem] text-fg outline-none placeholder:text-fg-subtle sm:h-14 [&::-webkit-search-cancel-button]:hidden"
                  data-testid="admin-search-input"
                />
              </div>
              <DialogPrimitive.Close className="grid h-9 shrink-0 place-items-center border border-line px-2 font-mono text-micro font-medium uppercase tracking-[0.1em] text-fg-subtle transition-colors hover:border-line-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:hidden touch:h-11" aria-label={tu("close")}>
                <span aria-hidden="true">Esc</span>
              </DialogPrimitive.Close>
              <DialogPrimitive.Close className="h-11 shrink-0 px-2 text-body font-medium text-accent-strong sm:hidden">{tu("cancel")}</DialogPrimitive.Close>
            </div>

            <div role="radiogroup" aria-label={t("search.filtersLabel")} className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {SCOPES.map((entry) => {
                const on = entry.key === scope;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={-1}
                    onClick={() => {
                      setScope(entry.key);
                      inputRef.current?.focus();
                    }}
                    className={cn(
                      "h-7 shrink-0 border px-2.5 font-mono text-micro font-medium uppercase tracking-[0.1em] transition-colors touch:h-9",
                      on ? "border-fg bg-fg text-canvas" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                    )}
                    data-testid={`admin-search-scope-${entry.key}`}
                  >
                    {t(entry.key === "all" ? "search.all" : `search.${entry.key}`)}
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(0.5rem,var(--nesto-safe-bottom))] sm:pb-2" aria-live="polite">
              {message ? (
                <p role={status === "error" ? "alert" : "status"} className={cn("px-4 py-8 text-center text-table", status === "error" ? "text-danger-strong" : "text-fg-muted")}>
                  {message}
                </p>
              ) : null}
              {scope === "pages" && !term ? <p className="px-4 pt-3 text-meta text-fg-subtle">{t("search.pagesHint")}</p> : null}
              <div id={listId} role="listbox" aria-label={t("search.results")}>
                {shown.map((group) => (
                  <div key={group.key} role="group" aria-label={group.label} data-testid={`admin-search-${group.key}`}>
                    <p className="flex items-center justify-between px-4 pb-1.5 pt-3 font-mono text-micro font-medium uppercase tracking-[0.1em] text-fg-subtle">
                      <span>{group.label}</span>
                      <span className="tabular-nums">{group.rows.length}</span>
                    </p>
                    <div className="max-sm:border-y max-sm:border-line">
                      {group.rows.map((option) => {
                        index += 1;
                        const position = index;
                        const selected = position === active;
                        const marked = term ? markMatch(option.title, term) : [option.title];
                        const Icon = option.icon;
                        return (
                          <button
                            type="button"
                            key={option.key}
                            id={`${listId}-option-${position}`}
                            role="option"
                            aria-selected={selected}
                            tabIndex={-1}
                            onMouseMove={() => setActive(position)}
                            onClick={() => choose(option)}
                            className={cn(
                              "flex min-h-13 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left max-sm:min-h-14 max-sm:border-b max-sm:border-line max-sm:last:border-b-0",
                              selected ? "bg-hover shadow-[inset_2px_0_0_var(--nesto-accent)]" : "hover:bg-hover",
                            )}
                          >
                            <span className={cn("grid size-8 shrink-0 place-items-center border bg-surface", selected ? "border-line-strong text-fg" : "border-line text-fg-muted")}>
                              <Icon aria-hidden="true" className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-body font-medium text-fg">
                                {marked.length === 3 ? (
                                  <>
                                    {marked[0]}
                                    <mark className="bg-transparent text-fg underline decoration-accent decoration-2 underline-offset-[3px]">{marked[1]}</mark>
                                    {marked[2]}
                                  </>
                                ) : (
                                  marked[0]
                                )}
                              </span>
                              {option.subtitle ? <span className="block truncate text-meta text-fg-subtle">{option.subtitle}</span> : null}
                            </span>
                            {option.tag ? <span className="shrink-0 border border-line px-1.5 py-px font-mono text-micro uppercase tracking-[0.08em] text-fg-muted">{option.tag}</span> : null}
                            {selected ? <kbd aria-hidden="true" className="grid min-w-5 shrink-0 place-items-center border border-line px-1 py-px font-mono text-[0.625rem] text-fg-muted max-sm:hidden">↵</kbd> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="hidden shrink-0 items-center gap-x-4 border-t border-line px-4 py-2 font-mono text-micro uppercase tracking-[0.08em] text-fg-subtle sm:flex">
              <span><Key>↑</Key><Key>↓</Key> {t("search.keysMove")}</span>
              <span><Key>↵</Key> {t("search.keysOpen")}</span>
              <span><Key>Tab</Key> {t("search.keysFilter")}</span>
              <span><Key>Esc</Key> {t("search.keysClose")}</span>
            </p>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="mr-1 inline-grid min-w-5 place-items-center border border-line px-1 py-px font-mono text-[0.625rem] normal-case tracking-normal text-fg-muted">{children}</kbd>;
}
