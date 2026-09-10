import * as React from "react";
import Link from "next/link";

import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils/cn";

/**
 * Detail page architecture (design spec §64, §65).
 *
 *   Breadcrumb → Title → Metadata → Primary Actions → Tabs → Content
 *
 * Every record page in NESTO uses this, so a project, a person and whatever
 * V0.2 adds all read the same way. Breadcrumbs live here rather than in the
 * module shell because §64 restricts them to deep pages.
 */
export type DetailTab = { slug: string; label: string };

export function DetailHeader({
  crumbs,
  title,
  meta,
  status,
  actions,
  tabs,
  activeTab,
  tabHref,
}: {
  crumbs: Crumb[];
  title: string;
  meta?: React.ReactNode;
  status?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: DetailTab[];
  activeTab?: string;
  tabHref?: (slug: string) => string;
}) {
  return (
    <div className="space-y-4">
      <Breadcrumbs items={crumbs} />

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-section font-semibold text-fg">{title}</h1>
            {status}
          </div>
          {meta ? <div className="mt-1 text-body text-fg-muted">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      {tabs && tabs.length > 0 && tabHref ? (
        <div className="-mx-1 overflow-x-auto">
          <nav
            aria-label={`${title} sections`}
            className="flex min-w-max items-center gap-1 border-b border-line px-1"
          >
            {tabs.map((tab) => {
              const active = tab.slug === activeTab;
              return (
                <Link
                  key={tab.slug}
                  href={tabHref(tab.slug)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-table font-medium transition-colors",
                    active
                      ? "border-accent text-fg"
                      : "border-transparent text-fg-muted hover:text-fg",
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
