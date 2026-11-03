import * as React from "react";

import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { PageHeaderFrame } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { cn } from "@/lib/utils/cn";

/**
 * Record detail header (PRD #7 §31, §32).
 *
 * Breadcrumb, title, status, metadata, actions — in that order, on every record
 * page in the product. Breadcrumbs appear only on record pages, never on module
 * landings (PRD #3 §69).
 *
 * On a phone the actions wrap inside the page rather than pushing it sideways
 * (AUD-04 §3, D-02-02, D-03-03, MW-01): the group was `shrink-0` with no cap,
 * so five actions at 320px scrolled the body. Long titles, codes and metadata
 * break anywhere instead of widening the header.
 *
 * Both headers here draw the block every page shares (`PageHeaderFrame`,
 * components/ui/page-header.tsx; UI-02 §7.2, §18.1).
 */
export function RecordHeader({
  breadcrumbs,
  title,
  subtitle,
  status,
  badges,
  meta,
  actions,
  className,
}: {
  breadcrumbs: Crumb[];
  title: string;
  subtitle?: string;
  status?: string;
  badges?: React.ReactNode;
  /** Short key/value pairs shown under the title. */
  meta?: { label: string; value: React.ReactNode }[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <PageHeaderFrame
      kind="record"
      lead={<Breadcrumbs items={breadcrumbs} />}
      title={title}
      subtitle={subtitle || undefined}
      status={
        status || badges ? (
          <>
            {status ? <StatusBadge status={status} /> : null}
            {badges}
          </>
        ) : undefined
      }
      meta={meta}
      actions={actions || undefined}
      className={className}
    />
  );
}

/**
 * Compact context header kept on record sub-pages, so a person never loses
 * track of which record they are inside (PRD #10 §139).
 */
export function RecordContextHeader({
  breadcrumbs,
  title,
  subtitle,
  status,
  actions,
}: {
  /** Absent under the project layout, which draws them (and the tabs) above the page. */
  breadcrumbs?: Crumb[];
  title: string;
  subtitle?: string;
  status?: string;
  actions?: React.ReactNode;
}) {
  return (
    <PageHeaderFrame
      kind="context"
      lead={breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
      title={title}
      subtitle={subtitle || undefined}
      status={status ? <StatusBadge status={status} /> : undefined}
      actions={actions || undefined}
    />
  );
}

/**
 * Key/value grid used across record detail pages. One card per field would be
 * noise; a grid keeps the information dense and scannable (PRD #10 §206).
 */
export function DetailGrid({
  items,
  columns = 2,
  className,
}: {
  items: { label: string; value: React.ReactNode }[];
  columns?: 2 | 3;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-8 gap-y-4 sm:grid-cols-2",
        columns === 3 && "lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="nesto-eyebrow text-fg-subtle">{item.label}</dt>
          {/* Long codes, IBANs, e-mails and file names break instead of widening the grid (AUD-04 §3, RC-9). */}
          <dd className="mt-1 text-body text-fg [overflow-wrap:anywhere]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
