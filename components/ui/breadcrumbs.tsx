"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { ArrowLeft, ArrowRight, Building2, ChevronDown, ChevronRight, Layers, MoreHorizontal } from "lucide-react";
import { usePathname } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useGroupEntry, useWorkspaceOptions } from "@/components/layout/shell-slots";
import { useOptionalWorkspaceSwitch } from "@/components/workspace/workspace-switch-provider";
import { useRecordNavigation } from "@/components/navigation/record-navigation-provider";
import { useRegisterBreadcrumbs, useRegisteredBreadcrumbs } from "@/components/navigation/breadcrumb-registry";
import { getIcon } from "@/components/layout/nav-icon";
import { modules as moduleRegistry } from "@/config/modules";
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

/**
 * A place switcher on a crumb (Sticky Navigation §8): the other projects, say,
 * that this person may open. Only ever filled from authorised server data.
 */
export type CrumbSwitcher = { label: string; items: { label: string; href: string; current?: boolean }[] };

export type Crumb = { label: string; href?: string; disabled?: boolean; switcher?: CrumbSwitcher };

type CrumbIcon = "group" | "company" | { module: string };

type ResolvedCrumb = Crumb & {
  key: string;
  icon?: CrumbIcon;
  /** The workspace's company crumb, which carries the company switcher. */
  companyId?: string;
  workspaceTarget?: { scopeType: "GROUP" | "COMPANY"; companyId: string | null };
};

function HistoryButton({ direction, disabled, onClick, fallbackLabel }: { direction: "back" | "forward"; disabled: boolean; onClick: () => void; fallbackLabel?: string }) {
  const t = useTranslations("ui");
  // With no history in this tab, Back leads to the nearest parent and says which (AUD-05 §3, UX-04).
  const label = fallbackLabel ? t("backTo", { label: fallbackLabel }) : direction === "back" ? t("goBack") : t("goForward");
  const Icon = direction === "back" ? ArrowLeft : ArrowRight;
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      title={disabled ? undefined : fallbackLabel ? label : direction === "back" ? t("back") : t("forward")}
      onClick={onClick}
      className={cn(
        // 44px under touch: Back is the record's way home on a phone (AUD-04 §4, MW-04, MW-19).
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors touch:size-10",
        "hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "disabled:cursor-not-allowed disabled:opacity-35",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </button>
  );
}

function CrumbGlyph({ icon }: { icon?: CrumbIcon }) {
  if (!icon) return null;
  const Icon = icon === "group" ? Layers : icon === "company" ? Building2 : getIcon(moduleRegistry[icon.module as keyof typeof moduleRegistry]?.icon ?? "Folder");
  return <Icon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />;
}

/** The current place, with its switcher when it has one (§8). */
function CurrentCrumb({ item }: { item: ResolvedCrumb }) {
  const t = useTranslations("ui");
  const label = (
    <>
      <CrumbGlyph icon={item.icon} />
      <span className="truncate">{item.label}</span>
    </>
  );
  if (!item.switcher || item.switcher.items.length < 2) {
    return (
      <span aria-current="page" title={item.label} className="flex min-w-0 max-w-80 items-center gap-1.5 font-semibold text-fg">
        {label}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-current="page"
          aria-label={`${item.label} — ${item.switcher.label}`}
          title={t("switchTo", { label: item.switcher.label })}
          className="flex min-w-0 max-w-80 items-center gap-1.5 rounded-md px-1 font-semibold text-fg hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {label}
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
        {item.switcher.items.map((option) => (
          <DropdownMenuItem key={option.href} asChild>
            <Link href={option.href} aria-current={option.current ? "page" : undefined} className={cn(option.current && "font-semibold")}>
              {option.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The company crumb's switcher (§8): the other companies of this group the person
 * may enter — the sidebar chooser's own list, entered through its own switch, so
 * the breadcrumb can never offer a company the server did not (§27). Shown only
 * with more than one company.
 */
function CompanySwitcher({ companyId }: { companyId: string }) {
  const t = useTranslations("ui");
  const switcher = useOptionalWorkspaceSwitch();
  const { state } = useWorkspaceOptions();
  if (!switcher || state.status !== "ready") return null;
  const companies = state.workspaces.companies;
  if (companies.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={t("switchTo", { label: "company" })} className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent touch:size-9">
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
        {companies.map((company) => (
          <DropdownMenuItem
            key={company.id}
            aria-current={company.id === companyId ? "true" : undefined}
            className={cn(company.id === companyId && "font-semibold")}
            onSelect={() => {
              if (company.id !== companyId) switcher.switchTo({ scopeType: "COMPANY", companyId: company.id, name: company.name });
            }}
          >
            {company.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CrumbLink({ item, current = false }: { item: ResolvedCrumb; current?: boolean }) {
  const navigation = useRecordNavigation();
  if (current) return <CurrentCrumb item={item} />;
  if (item.companyId) {
    return (
      <span className="flex min-w-0 items-center gap-0.5">
        <CrumbLink item={{ ...item, companyId: undefined }} />
        <CompanySwitcher companyId={item.companyId} />
      </span>
    );
  }
  if (!item.href || item.disabled) {
    return (
      <span title={item.label} className="flex min-w-0 max-w-56 items-center gap-1.5">
        <CrumbGlyph icon={item.icon} />
        <span className="truncate">{item.label}</span>
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
      className="flex min-w-0 max-w-56 items-center gap-1.5 rounded-sm transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <CrumbGlyph icon={item.icon} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

/** The "…" that opens the collapsed levels: 44px under touch (AUD-04 §4, MW-19). */
const collapsedTrigger =
  "inline-flex h-6 items-center justify-center rounded-md px-1.5 hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent touch:h-11 touch:min-w-11";

function Separator() {
  return <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />;
}

/**
 * A page names where it is (Sticky Navigation §23-§25). It draws nothing itself:
 * the trail is handed to the shell's one sticky bar under the top bar, so every
 * page has the same breadcrumb, in the same place, whatever its layout.
 * `className` and `maxVisible` are kept for existing callers and ignored.
 */
export function Breadcrumbs({ items, level = "page" }: { items: Crumb[]; className?: string; maxVisible?: number; level?: "layout" | "page" }) {
  useRegisterBreadcrumbs(items, level);
  return null;
}

/**
 * The sticky breadcrumb bar (Sticky Navigation §3-§8, §19-§22): directly under
 * the top bar, smaller than it, on every signed-in page. Group and company come
 * from the session's workspace, the module from the route; the rest is the trail
 * the page registered. A page that names none still says where it is.
 */
export function BreadcrumbBar({ root }: { root?: Crumb } = {}) {
  const registered = useRegisteredBreadcrumbs();
  const items = React.useMemo(() => registered ?? [], [registered]);
  const maxVisible = 6;
  const navigation = useRecordNavigation();
  const groupEntry = useGroupEntry();
  const pathname = usePathname();
  const moduleNames = useTranslations("modules");
  // Read after mount: storage is the browser's, and the first render matches the server's.
  const [history, setHistory] = React.useState<ReturnHistoryEntry[]>([]);
  React.useEffect(() => setHistory(readReturnHistory()), [pathname]);
  const workspaceKey = navigation?.workspace.key ?? null;
  const trail = React.useMemo<ResolvedCrumb[]>(() => {
    // The Admin Console is its own context (§33): its root, never a company's operational trail.
    const roots: ResolvedCrumb[] = root ? [{ ...root, key: "root" }] : [];
    const workspace = root ? undefined : navigation?.workspace;
    if (workspace) {
      roots.push({
        key: `group-${workspace.key}`,
        icon: "group",
        label: workspace.group.name,
        // A link only once the Group view is known to be open to them: pending
        // and failed are not denials, just not yet a way in (NAV-02 COMPAT-01).
        href: groupEntry?.status === "ready" && groupEntry.canEnter ? "/dashboard" : undefined,
        workspaceTarget: workspace.scopeType === "GROUP" ? undefined : { scopeType: "GROUP", companyId: null },
      });
      if (workspace.scopeType === "COMPANY" && workspace.company) {
        roots.push({ key: `company-${workspace.company.id}`, icon: "company", companyId: workspace.company.id, label: workspace.company.name, href: "/dashboard" });
      }
    }
    const rootLabels = new Set(roots.map((root) => root.label));
    const authorizedItems: (Crumb & { icon?: CrumbIcon })[] = items.filter((item) => !rootLabels.has(item.label));
    const metadata = root ? null : breadcrumbRouteMetadata(pathname);
    if (metadata) {
      // The module is named as the sidebar names it, in the reader's language (AUD-05 §3, UX-07).
      const moduleLabel = moduleNames(`${metadata.moduleKey}.label`);
      const first = authorizedItems[0];
      if (first && (first.label === metadata.moduleLabel || first.label === moduleLabel)) {
        authorizedItems[0] = { ...first, label: moduleLabel, icon: { module: metadata.moduleKey } } as ResolvedCrumb;
      } else {
        authorizedItems.unshift({ label: moduleLabel, href: metadata.moduleHref, icon: { module: metadata.moduleKey } } as ResolvedCrumb);
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
  }, [items, root, navigation?.workspace, pathname, groupEntry, moduleNames, history, workspaceKey]);
  // No history in this tab (a deep link): Back goes to the nearest parent instead of doing nothing (UX-04).
  const fallback = navigation?.canGoBack ? null : fallbackParent(trail);

  const collapseAt = Math.max(4, maxVisible);
  const collapsed = trail.length > collapseAt;
  const hidden = collapsed ? trail.slice(1, trail.length - 3) : [];
  const visible = collapsed ? [trail[0], ...trail.slice(-3)] : trail;

  return (
    <div
      data-testid="record-navigation-header"
      data-shell-breadcrumb
      className="max-sm:hidden sticky top-[var(--nesto-shell-header-h)] z-[var(--nesto-z-shell-breadcrumb)] flex h-[var(--nesto-shell-breadcrumb-h)] items-center gap-2 border-b border-line bg-canvas pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] xl:px-8"
    >
      <div role="group" className="flex shrink-0 items-center" aria-label="History navigation">
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
        <ol className="flex min-w-0 items-center gap-1 text-meta text-fg-muted">
          {visible.map((item, index) => {
            const originalIndex = collapsed && index > 0 ? trail.length - (visible.length - index) : index;
            const isCurrent = originalIndex === trail.length - 1;
            return (
              <React.Fragment key={item.key}>
                {index === 1 && collapsed ? (
                  <li className="flex shrink-0 items-center gap-1">
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
                {/* Earlier levels give way first on a tablet; the current place keeps its room (§19, §21). */}
                <li className={cn("flex items-center gap-1", isCurrent ? "min-w-0 shrink-0" : "min-w-0 shrink")}>
                  <CrumbLink item={item} current={isCurrent} />
                  {isCurrent ? null : <Separator />}
                </li>
              </React.Fragment>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
