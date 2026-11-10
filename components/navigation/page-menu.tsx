"use client";

import * as React from "react";
import { BookOpen, CircleHelp, MoreHorizontal } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { BELOW_LG_QUERY } from "@/components/layout/use-phone";
import Link from "@/components/navigation/nav-link";
import { isOrphan, offeredEntries, PageMenuStore, slotShows, type PageMenuEntry, type PageMenuSlotWidth, type PageMenuState } from "@/components/navigation/page-menu-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils/cn";

/**
 * The page's ⋯ menu, at every width: one ⋯ right after the page's title or
 * status (below `lg` at the end of the title row), holding its "What is
 * this?" tips and its Help link, which are not drawn where they sit. Below
 * `lg` it also holds the page's secondary actions; from `lg` those stay
 * visible buttons where the page put them. The API — how a page adds an item,
 * and how its primary action stays a button — is described at the top of
 * page-menu-store.ts.
 *
 * - `WhatIsThis` registers itself; `HelpEntry` and secondary actions through
 *   `FoldIntoPageMenu`.
 * - A page's own record menu (a project's, a task's, a client's…) claims them
 *   with `useClaimPageMenu` and lists them with `PageMenuItems`.
 * - Otherwise the page header's `PageMenuSlot` draws a ⋯ for them, the first
 *   one in the document drawn at this width where there are several.
 * - A tip opens as a dialog (`PageHelpDialog`, one for the shell), with the
 *   same heading, words and link as inline.
 * - Where nothing can hold them (a page without a header slot, or outside the
 *   shell), each is drawn where it sits.
 */

type Node = React.ReactNode;
export type PageMenuItem = PageMenuEntry<Node>;

const PageMenuContext = React.createContext<PageMenuStore<Node> | null>(null);

/** Outside the shell nothing collects the entries: they are drawn where they sit (`isOrphan`), on the server as in the browser. */
const NO_SHELL: PageMenuState<Node> = Object.freeze({ ready: true, wide: false, entries: Object.freeze([]), claimed: false, slot: null, openTip: null });
const noSubscribe = () => () => undefined;
const noShell = () => NO_SHELL;

export function PageMenuProvider({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(() => new PageMenuStore<Node>());
  // Which slots are drawn and what the ⋯ offers follow the width: set before the first paint, and on every change.
  React.useLayoutEffect(() => {
    const media = window.matchMedia(BELOW_LG_QUERY);
    const sync = () => store.setWide(!media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [store]);
  return (
    <PageMenuContext.Provider value={store}>
      {children}
      <PageHelpDialog />
    </PageMenuContext.Provider>
  );
}

function usePageMenuState(): PageMenuState<Node> {
  const store = React.useContext(PageMenuContext);
  return React.useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getSnapshot ?? noShell, store?.getServerSnapshot ?? noShell);
}

/** What identifies an item: its plain fields. React nodes (labels, icons, a tip's body) and `onSelect` are read from the latest render instead. */
function itemKey(item: PageMenuItem | null): string | null {
  if (!item) return null;
  const label = typeof item.label === "string" ? item.label : null;
  if (item.kind === "tip") return JSON.stringify([item.kind, label, item.title, item.link?.label ?? null, item.link?.href ?? null]);
  if (item.kind === "link") return JSON.stringify([item.kind, label, item.href]);
  return JSON.stringify([item.kind, label, item.href ?? null, Boolean(item.onSelect), Boolean(item.destructive), Boolean(item.disabled)]);
}

/**
 * Hands an item to the page's ⋯ menu while mounted; `null` hands nothing.
 * Matched by its plain fields, so an inline object, a new label element and a
 * new `onSelect` each render all cost nothing: the menu runs the latest
 * `onSelect` and shows the labels the item had when its fields last changed.
 */
export function useRegisterPageMenuItem(item: PageMenuItem | null) {
  const store = React.useContext(PageMenuContext);
  const id = React.useId();
  const latest = React.useRef(item);
  // Declared first, so the registration below always reads this render's item.
  React.useLayoutEffect(() => {
    latest.current = item;
  });
  const key = itemKey(item);
  React.useLayoutEffect(() => {
    const current = latest.current;
    if (!store || key === null || !current) return;
    const entry: PageMenuItem =
      current.kind === "action" && current.onSelect
        ? {
            ...current,
            onSelect: () => {
              const now = latest.current;
              if (now?.kind === "action") now.onSelect?.();
            },
          }
        : current;
    store.setEntry(id, entry);
    return () => store.removeEntry(id);
  }, [store, id, key]);
}

/** The earlier name of `useRegisterPageMenuItem`. */
export const useRegisterPageHelp = useRegisterPageMenuItem;

/** Whether the page's folded controls are drawn where they sit at this width, for want of a menu to hold them. */
export function usePageMenuInline(): boolean {
  return isOrphan(usePageMenuState());
}

/** The earlier name of `usePageMenuInline`. */
export const usePageHelpInline = usePageMenuInline;

/** A page's own ⋯ menu takes the folded items while `active` (while its ⋯ is drawn, at every width); it lists them with `PageMenuItems`. */
export function useClaimPageMenu(active: boolean) {
  const store = React.useContext(PageMenuContext);
  const id = React.useId();
  React.useLayoutEffect(() => {
    if (!store || !active) return;
    store.claim(id);
    return () => store.release(id);
  }, [store, id, active]);
}

/** How many items there are to offer at this width: a claiming menu shows its ⋯ for them even when it has nothing else. */
export function usePageMenuCount(): number {
  return offeredEntries(usePageMenuState()).length;
}

/** The earlier name of `usePageMenuCount`. */
export const usePageHelpCount = usePageMenuCount;

/**
 * The folded items as menu items: below `lg` the secondary actions, then (set
 * off by a separator) the tips and Help; from `lg` the tips and Help only, the
 * actions being buttons on the page there. In a record's own menu,
 * `separator` puts one before them, against its own items
 * (`separatorClassName` says where those are shown, so no separator is left
 * hanging at the top of a menu whose own items are hidden at this width).
 */
export function PageMenuItems({ separator = false, separatorClassName }: { separator?: boolean; separatorClassName?: string }) {
  const store = React.useContext(PageMenuContext);
  const entries = offeredEntries(usePageMenuState());
  if (!store || entries.length === 0) return null;
  const tips = entries.filter((entry) => entry.kind === "tip").length;
  const firstHelp = entries.findIndex((entry) => entry.kind !== "action");
  return (
    <>
      {separator ? <DropdownMenuSeparator className={separatorClassName} /> : null}
      {entries.map((entry, index) => (
        <React.Fragment key={entry.id}>
          {index === firstHelp && index > 0 ? <DropdownMenuSeparator /> : null}
          {entry.kind === "action" ? (
            entry.href ? (
              <DropdownMenuItem asChild disabled={entry.disabled} variant={entry.destructive ? "destructive" : "default"} data-testid="page-menu-action">
                <Link href={entry.href}>
                  {entry.icon}
                  {entry.label}
                </Link>
              </DropdownMenuItem>
            ) : (
              // Run once the menu has closed, so an action may open a dialog of its own.
              <DropdownMenuItem
                disabled={entry.disabled}
                variant={entry.destructive ? "destructive" : "default"}
                onSelect={() => requestAnimationFrame(() => entry.onSelect?.())}
                data-testid="page-menu-action"
              >
                {entry.icon}
                {entry.label}
              </DropdownMenuItem>
            )
          ) : entry.kind === "tip" ? (
            // The menu has closed by the next frame; the dialog then opens over the page, not over the menu.
            <DropdownMenuItem onSelect={() => requestAnimationFrame(() => store.openTip(entry.id))} data-testid="page-menu-tip">
              <CircleHelp aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span>{entry.label}</span>
                {/* Two tips on one page are told apart by what they explain. */}
                {tips > 1 ? <span className="text-micro text-fg-muted">{entry.title}</span> : null}
              </span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem asChild data-testid="page-menu-help">
              <Link href={entry.href}>
                <BookOpen aria-hidden="true" />
                {entry.label}
              </Link>
            </DropdownMenuItem>
          )}
        </React.Fragment>
      ))}
    </>
  );
}

/** The earlier name of `PageMenuItems`. */
export const PageHelpMenuItems = PageMenuItems;

/**
 * Where a page header offers the ⋯: right after its title or status, or below
 * `lg` at the end of its title row (`data-page-menu`;
 * components/ui/page-header.tsx orders it there). Drawn only while it is the
 * first slot on the page drawn at this width, there is something to offer and
 * no record menu took it. `at` limits it to one width: `belowLg` (a project's
 * compact header, a page header's row) or `lg` (a page header's title or
 * status line). `reserve`: the header knows it will hold something (a module
 * page's Help), so the ⋯ is drawn from the first paint and nothing moves when
 * the page has hydrated.
 */
export function PageMenuSlot({ reserve = false, at = "all", className }: { reserve?: boolean; at?: PageMenuSlotWidth; className?: string }) {
  const store = React.useContext(PageMenuContext);
  const state = usePageMenuState();
  const t = useTranslations("ui");
  const anchor = React.useRef<HTMLSpanElement>(null);
  const id = React.useId();
  React.useLayoutEffect(() => {
    if (!store) return;
    store.addSlot(id, anchor.current, at);
    return () => store.removeSlot(id);
  }, [store, id, at]);
  if (!store) return null;
  // Before the width is known a reserved slot is drawn in each of a header's places, CSS showing the one for this width; the test id is the drawn one's alone.
  const testId = at === "all" || state.ready ? "page-menu" : undefined;
  return (
    <>
      <span ref={anchor} hidden />
      {slotShows(state, id, reserve) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("pageMenu")}
              className={cn("shrink-0", at === "belowLg" && "lg:hidden", at === "lg" && "max-lg:hidden", className)}
              data-page-menu
              data-testid={testId}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <PageMenuItems />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}

/**
 * A control that folds into the page's ⋯: `item` is what stands for it in the
 * menu, and `children` is the control as drawn on the page. An action's
 * children are drawn from `lg` and not below it; a link's (Help) at no width.
 * Either is drawn where it sits when nothing on the page can hold the item.
 */
export function FoldIntoPageMenu({ item, children }: { item: PageMenuItem; children: React.ReactNode }) {
  useRegisterPageMenuItem(item);
  const inline = usePageMenuInline();
  return <div className={inline ? "contents" : item.kind === "action" ? "contents max-lg:hidden" : "hidden"}>{children}</div>;
}

/** The open tip, as a dialog: a bottom sheet on a phone, centred from 640px. */
function PageHelpDialog() {
  const store = React.useContext(PageMenuContext);
  const { entries, openTip } = usePageMenuState();
  const tip = entries.find((entry) => entry.id === openTip);
  const open = tip?.kind === "tip";
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : store?.closeTip())}>
      {tip?.kind === "tip" ? (
        <DialogContent presentation="sheet-phone" aria-describedby={undefined} data-testid="page-help-dialog">
          <DialogTitle className="pr-8">{tip.title}</DialogTitle>
          <div className="mt-2 space-y-1.5 text-table text-fg-muted">{tip.body}</div>
          {tip.link ? (
            <p className="mt-4 text-table">
              <Link href={tip.link.href} onClick={() => store?.closeTip()} className="inline-flex min-h-11 items-center font-medium text-accent-strong hover:underline">
                {tip.link.label}
              </Link>
            </p>
          ) : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
