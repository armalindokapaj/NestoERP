"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { ArrowLeft, ArrowRight, ChevronRight, MoreHorizontal } from "lucide-react";
import { usePathname } from "next/navigation";

import { useRecordNavigation } from "@/components/navigation/record-navigation-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils/cn";
import { breadcrumbRouteMetadata } from "@/config/breadcrumb-routes";

export type Crumb = { label: string; href?: string; disabled?: boolean };

type ResolvedCrumb = Crumb & {
  key: string;
  workspaceTarget?: { scopeType: "GROUP" | "COMPANY"; companyId: string | null };
};

function HistoryButton({ direction, disabled, onClick }: { direction: "back" | "forward"; disabled: boolean; onClick: () => void }) {
  const label = direction === "back" ? "Go back" : "Go forward";
  const Icon = direction === "back" ? ArrowLeft : ArrowRight;
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      title={disabled ? undefined : direction === "back" ? "Back" : "Forward"}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-fg-muted transition-colors",
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

function Separator() {
  return <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />;
}

/** Unified record navigation, shared by every tenant record page. */
export function Breadcrumbs({ items, className, maxVisible = 6 }: { items: Crumb[]; className?: string; maxVisible?: number }) {
  const navigation = useRecordNavigation();
  const pathname = usePathname();
  const trail = React.useMemo<ResolvedCrumb[]>(() => {
    const roots: ResolvedCrumb[] = [];
    const workspace = navigation?.workspace;
    if (workspace) {
      roots.push({
        key: `group-${workspace.key}`,
        label: workspace.group.name,
        href: workspace.group.canEnter ? "/dashboard" : undefined,
        workspaceTarget: workspace.scopeType === "GROUP" ? undefined : { scopeType: "GROUP", companyId: null },
      });
      if (workspace.scopeType === "COMPANY" && workspace.company) {
        roots.push({ key: `company-${workspace.company.id}`, label: workspace.company.name, href: "/dashboard" });
      }
    }
    const rootLabels = new Set(roots.map((root) => root.label));
    const authorizedItems = items.filter((item) => !rootLabels.has(item.label));
    const metadata = breadcrumbRouteMetadata(pathname);
    if (metadata && authorizedItems[0]?.label !== metadata.moduleLabel) {
      authorizedItems.unshift({ label: metadata.moduleLabel, href: metadata.moduleHref });
    }
    const supplied = authorizedItems.map((item, index) => ({ ...item, key: `crumb-${index}-${item.label}` }));
    return [...roots, ...supplied].filter((item, index, all) => {
      const previous = all[index - 1];
      return !previous || previous.label !== item.label || previous.href !== item.href;
    });
  }, [items, navigation?.workspace, pathname]);

  const collapseAt = Math.max(4, maxVisible);
  const collapsed = trail.length > collapseAt;
  const hidden = collapsed ? trail.slice(1, trail.length - 3) : [];
  const visible = collapsed ? [trail[0], ...trail.slice(-3)] : trail;
  const mobileHidden = trail.slice(0, -1);

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)} data-testid="record-navigation-header">
      <div className="flex shrink-0 items-center gap-1" aria-label="History navigation">
        <HistoryButton direction="back" disabled={!navigation?.canGoBack} onClick={() => navigation?.goBack()} />
        <HistoryButton direction="forward" disabled={!navigation?.canGoForward} onClick={() => navigation?.goForward()} />
      </div>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1 overflow-hidden">
        <ol className="flex min-w-0 items-center gap-1 text-table text-fg-muted">
          {mobileHidden.length ? (
            <li className="order-1 flex shrink-0 items-center gap-1 sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Show hidden breadcrumb levels" className="inline-flex h-7 items-center rounded-md px-1.5 hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
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
                        <button type="button" aria-label="Show hidden breadcrumb levels" className="inline-flex h-7 items-center rounded-md px-1.5 hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
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
