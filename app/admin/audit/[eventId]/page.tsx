import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getAuditLogEvent } from "@/lib/modules/platform/platform-audit.query";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Audit event" };

type Props = { params: Promise<{ eventId: string }> };

/** One audit event as recorded, with its redacted before/after (Admin Audit PRD #6 §66). */
export default async function AuditEventPage({ params }: Props) {
  const { eventId } = await params;
  const context = await requirePlatformContext();
  const event = await getAuditLogEvent(context, eventId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value, null, 2));
  const blocks = ([["Before", json(event.before)], ["After", json(event.after)], ["Changes", json(event.changes)]] as const).filter(([, text]) => text);
  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Audit Log", href: "/admin/audit" }, { label: event.action }]} />
      <header>
        <h1 className="text-page font-semibold text-fg">{event.action}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg-muted"><span>{formatDateTime(event.occurredAt)}</span><AdminStatusBadge status={event.severity} /><span className="font-mono text-meta">{event.actionKey}</span></div>
      </header>
      <section className="nesto-card p-5" aria-label="Event">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ["Actor", event.actor],
            ["Role", event.actorRole ?? "—"],
            ["Organization", event.organization],
            ["Record", event.entity],
            ["Record type", event.entityType ?? "—"],
            ["Category", event.category.toLowerCase().replaceAll("_", " ")],
            ["Reason", event.reason ?? "—"],
            ["IP address", event.ipAddress ?? "—"],
            ["Request", event.requestId ?? "—"],
          ] as const).map(([name, value]) => <div key={name}><dt className="text-meta text-fg-subtle">{name}</dt><dd className="break-words text-body text-fg">{value}</dd></div>)}
        </dl>
      </section>
      {blocks.length === 0 ? <p className="text-table text-fg-muted">No snapshot was recorded for this event.</p> : blocks.map(([title, text]) => (
        <section key={title} className="nesto-card p-5" aria-label={title}>
          <h2 className="text-card font-semibold text-fg">{title}</h2>
          <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-surface-muted p-3 font-mono text-micro text-fg">{text}</pre>
        </section>
      ))}
    </div>
  );
}
