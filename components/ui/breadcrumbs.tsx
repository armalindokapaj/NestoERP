"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { ArrowLeft, ArrowRight, ChevronRight, MoreHorizontal } from "lucide-react";
import { usePathname } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useGroupEntry } from "@/components/layout/shell-slots";
import { useRecordNavigation } from "@/components/navigation/record-navigation-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils/cn";
import { breadcrumbRouteMetadata, fallbackParent, returnHref, type ReturnHistoryEntry } from "@/config/breadcrumb-routes";

/** The record navigation's own history in this tab, read only to borrow a list's last query (AUD-05 §3, UX-04). */
const RECORD_HISTORY_KEY = "nesto-record-navigation-v1";

function readReturnHistory(): ReturnHistoryEntry[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(RECORD_HISTORY_KEY) ?? "null") as { entries?: unknown; index?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.entries)) return [];
    // Nothing past the history's position: those entries are "Forward". This runs
    // before the provider records the page being opened, so the position is
    // still the page the person came from — often the list itself.
    const upTo = Number.isInteger(parsed.index) ? (parsed.index as number) : parsed.entries.length - 1;
    return parsed.entries
      .slice(0, Math.max(0, upTo + 1))
      .filter((entry): entry is ReturnHistoryEntry => !!entry && typeof entry.route === "string" && typeof entry.workspaceKey === "string");
  } catch {
    return [];
  }
}

export type Crumb = { label: string; href?: string; disabled?: boolean };

type ResolvedCrumb = Crumb & {
  key: string;
  workspaceTarget?: { scopeType: "GROUP" | "COMPANY"; companyId: string | null };
};

function HistoryButton({ direction, disabled, onClick, fallbackLabel }: { direction: "back" | "forward"; disabled: boolean; onClick: () => void; fallbackLabel?: string }) {
  // With no history in this tab, Back leads to the nearest parent and says which (AUD-05 §3, UX-04).
  const label = fallbackLabel ? `Back to ${fallbackLabel}` : direction === "back" ? "Go back" : "Go forward";
  const Icon = direction === "back" ? ArrowLeft : ArrowRight;
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      title={disabled ? undefined : fallbackLabel ? label : direction === "back" ? "Back" : "Forward"}
      onClick={onClick}
      className={cn(
        // 44px under touch: Back is the record's way home on a phone (AUD-04 §4, MW-04, MW-19).
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-fg-muted transition-colors touch:size-11",
        "hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "disabled:cursor-not-allowed disabled:opacity-35",
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}

function CrumbLink({ item, current = false }: { item: ResolvedCrumb; current?: boolean }) {
  const navigation = useRecordNavigation();
  if (current || !item.href || item.disabled) {
    return (
      <span
        aria-current={current ? "page" : undefined}
        title={item.label}
        className={cn("block max-w-64 truncate", current && "font-medium text-fg")}
      >
        {item.label}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      title={item.label}
      prefetch={!item.workspaceTarget}
      onClick={(event) => {
        if (!navigation) return;
        event.preventDefault();
        if (item.workspaceTarget) navigation.navigateWorkspace(item.workspaceTarget.scopeType, item.workspaceTarget.companyId, item.href!);
        else navigation.navigate(item.href!);
      }}
      className="block max-w-56 truncate rounded-sm transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {item.label}
    </Link>
  );
}

/** The "…" that opens the collapsed levels: 44px under touch (AUD-04 §4, MW-19). */
const collapsedTrigger =
  "inline-flex h-7 items-center justify-center rounded-md px-1.5 hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent touch:h-11 touch:min-w-11";

function Separator() {
  return <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />;
}

/** Unified record navigation, shared by every tenant record page. */
export function Breadcrumbs({ items, className, maxVisible = 6 }: { items: Crumb[]; className?: string; maxVisible?: number }) {
  const navigation = useRecordNavigation();
  const groupEntry = useGroupEntry();
  const pathname = usePathname();
  const moduleNames = useTranslations("modules");
  // Read after mount: storage is the browser's, and the first render matches the server's.
  const [history, setHistory] = React.useState<ReturnHistoryEntry[]>([]);
  React.useEffect(() => setHistory(readReturnHistory()), [pathname]);
  const workspaceKey = navigation?.workspace.key ?? null;
  const trail = React.useMemo<ResolvedCrumb[]>(() => {
    const roots: ResolvedCrumb[] = [];
    const workspace = navigation?.workspace;
    if (workspace) {
      roots.push({
        key: `group-${workspace.key}`,
        label: workspace.group.name,
        // A link only once the Group view is known to be open to them: pending
        // and failed are not denials, just not yet a way in (NAV-02 COMPAT-01).
        href: groupEntry?.status === "ready" && groupEntry.canEnter ? "/dashboard" : undefined,
        workspaceTarget: workspace.scopeType === "GROUP" ? undefined : { scopeType: "GROUP", companyId: null },
      });
      if (workspace.scopeType === "COMPANY" && workspace.company) {
        roots.push({ key: `company-${workspace.company.id}`, label: workspace.company.name, href: "/dashboard" });
      }
    }
    const rootLabels = new Set(roots.map((root) => root.label));
    const authorizedItems = items.filter((item) => !rootLabels.has(item.label));
    const metadata = breadcrumbRouteMetadata(pathname);
    if (metadata) {
      // The module is named as the sidebar names it, in the reader's language (AUD-05 §3, UX-07).
      const moduleLabel = moduleNames(`${metadata.moduleKey}.label`);
      const first = authorizedItems[0];
      if (first && (first.label === metadata.moduleLabel || first.label === moduleLabel)) {
        authorizedItems[0] = { ...first, label: moduleLabel };
      } else {
        authorizedItems.unshift({ label: moduleLabel, href: metadata.moduleHref });
      }
    }
    const supplied = authorizedItems.map((item, index) => ({
      ...item,
      // A list crumb returns to the list as it was left: search, filters and page (UX-04).
      href: item.href && !item.disabled ? returnHref(item.href, history, workspaceKey) : item.href,
      key: `crumb-${index}-${item.label}`,
    }));
    return [...roots, ...supplied].filter((item, index, all) => {
      const previous = all[index - 1];
      return !previous || previous.label !== item.label || previous.href !== item.href;
    });
  }, [items, navigation?.workspace, pathname, groupEntry, moduleNames, history, workspaceKey]);
  // No history in this tab (a deep link): Back goes to the nearest parent instead of doing nothing (UX-04).
  const fallback = navigation?.canGoBack ? null : fallbackParent(trail);

  const collapseAt = Math.max(4, maxVisible);
  const collapsed = trail.length > collapseAt;
  const hidden = collapsed ? trail.slice(1, trail.length - 3) : [];
  const visible = collapsed ? [trail[0], ...trail.slice(-3)] : trail;
  const mobileHidden = trail.slice(0, -1);

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)} data-testid="record-navigation-header">
      <div className="flex shrink-0 items-center gap-1" aria-label="History navigation">
        <HistoryButton
          direction="back"
          disabled={!navigation?.canGoBack && !fallback}
          fallbackLabel={fallback?.label}
          onClick={() => {
            if (!navigation) return;
            if (navigation.canGoBack) navigation.goBack();
            else if (fallback?.href) {
              if (fallback.workspaceTarget) navigation.navigateWorkspace(fallback.workspaceTarget.scopeType, fallback.workspaceTarget.companyId, fallback.href);
              else navigation.navigate(fallback.href);
            }
          }}
        />
        <HistoryButton direction="forward" disabled={!navigation?.canGoForward} onClick={() => navigation?.goForward()} />
      </div>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1 overflow-hidden">
        <ol className="flex min-w-0 items-center gap-1 text-table text-fg-muted">
          {mobileHidden.length ? (
            <li className="order-1 flex shrink-0 items-center gap-1 sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Show hidden breadcrumb levels" className={collapsedTrigger}>
                    <MoreHorizontal aria-hidden="true" className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-48">
                  {mobileHidden.map((hiddenItem) => (
                    <DropdownMenuItem key={`mobile-${hiddenItem.key}`} asChild disabled={hiddenItem.disabled || !hiddenItem.href}>
                      {hiddenItem.href ? <CrumbLink item={hiddenItem} /> : <span>{hiddenItem.label}</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Separator />
            </li>
          ) : null}
          {visible.map((item, index) => {
            const originalIndex = collapsed && index > 0 ? trail.length - (visible.length - index) : index;
            const current = originalIndex === trail.length - 1;
            return (
              <React.Fragment key={item.key}>
                {index === 1 && collapsed ? (
                  <li className="hidden shrink-0 items-center gap-1 sm:flex">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" aria-label="Show hidden breadcrumb levels" className={collapsedTrigger}>
                          <MoreHorizontal aria-hidden="true" className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-48">
                        {hidden.map((hiddenItem) => (
                          <DropdownMenuItem key={hiddenItem.key} asChild disabled={hiddenItem.disabled || !hiddenItem.href}>
                            {hiddenItem.href ? <CrumbLink item={hiddenItem} /> : <span>{hiddenItem.label}</span>}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Separator />
                  </li>
                ) : null}
                <li className={cn("flex min-w-0 items-center gap-1", current ? "order-2 flex-1 sm:order-none" : "shrink-0", !current && mobileHidden.length && "hidden sm:flex")}>
                  <CrumbLink item={item} current={current} />
                  {current ? null : <Separator />}
                </li>
              </React.Fragment>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
