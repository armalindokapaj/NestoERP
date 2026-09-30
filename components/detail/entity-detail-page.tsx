import * as React from "react";

import { RecordHeader } from "@/components/modules/record-header";
import type { Crumb } from "@/components/ui/breadcrumbs";
import { StickyActions } from "@/components/ui/sticky";
import { cn } from "@/lib/utils/cn";

/**
 * The one record detail page (MOB-04 §6, §7).
 *
 * Header (back context, title, status, the `...` menu), then the primary
 * information, then sections, then related records — the same order on every
 * width. On a phone that is one column with hierarchy; from `lg` the sections
 * may sit in two columns (`aside`) without reordering what a screen reader or
 * keyboard reaches. It renders semantic fields, never a disabled form, so a
 * reader without edit permission gets a proper page (§57).
 *
 *   <EntityDetailPage breadcrumbs title status actions={<EntityActionSheet …/>} primaryAction={<Button>Edit</Button>}>
 *     <DetailSection title="General"><DetailFieldList fields={[…]} /></DetailSection>
 *   </EntityDetailPage>
 *
 * `actions` is the header slot (the `...` menu and any header button);
 * `primaryAction` is the one frequent action (Edit, Approve) — it is pinned to
 * the bottom of a phone screen (StickyActions, clear of the safe area, and the
 * bottom navigation yields to it) and stays in the header on desktop. Pass only
 * actions this person may take.
 */
export function EntityDetailPage({
  breadcrumbs,
  title,
  subtitle,
  status,
  badges,
  meta,
  actions,
  primaryAction,
  aside,
  className,
  children,
}: {
  breadcrumbs: Crumb[];
  title: string;
  subtitle?: string;
  status?: string;
  badges?: React.ReactNode;
  meta?: { label: string; value: React.ReactNode }[];
  actions?: React.ReactNode;
  primaryAction?: React.ReactNode;
  /** Secondary sections shown beside the main column from `lg`. */
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-5", className)} data-entity-detail>
      <RecordHeader
        breadcrumbs={breadcrumbs}
        title={title}
        subtitle={subtitle}
        status={status}
        badges={badges}
        meta={meta}
        actions={
          <>
            {primaryAction ? <div className="hidden md:block">{primaryAction}</div> : null}
            {actions}
          </>
        }
      />

      {aside ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">{children}</div>
          <div className="min-w-0 space-y-5">{aside}</div>
        </div>
      ) : (
        <div className="space-y-5">{children}</div>
      )}

      {primaryAction ? (
        <StickyActions className="md:hidden" data-testid="detail-primary-action">
          {primaryAction}
        </StickyActions>
      ) : null}
    </div>
  );
}
