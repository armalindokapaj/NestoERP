import { adminRoleName } from "@/components/platform/admin-roles";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getAuditLogEvent } from "@/lib/modules/platform/platform-audit.query";
import { getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import { formatDateTime } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAccess");
  return { title: t("audit.event.metaTitle") };
}

type Props = { params: Promise<{ eventId: string }> };

/** One audit event as recorded, with its redacted before/after (Admin Audit PRD #6 §66). */
export default async function AuditEventPage({ params }: Props) {
  const { eventId } = await params;
  const tr = await getTranslations("roles");
  const t = await getTranslations("adminAccess");
  const ta = await getTranslations("admin");
  const context = await requirePlatformContext();
  const event = await getAuditLogEvent(context, eventId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value, null, 2));
  const blocks = ([[t("audit.event.before"), json(event.before)], [t("audit.event.after"), json(event.after)], [t("audit.event.changes"), json(event.changes)]] as const).filter(([, text]) => text);
  const action = enumLabel(ta, "actions", event.actionKey.replace(/^PLATFORM_/, ""), event.action);
  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: t("audit.event.breadcrumbRoot"), href: "/admin/audit" }, { label: action }]} />
      <header>
        <h1 className="text-page font-semibold text-fg">{action}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg-muted"><span>{formatDateTime(event.occurredAt)}</span><AdminStatusBadge status={event.severity} /><span className="font-mono text-meta">{event.actionKey}</span></div>
      </header>
      <section className="nesto-card p-5" aria-label={t("audit.event.sectionLabel")}>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            [t("audit.event.actor"), event.actor],
            [t("audit.event.role"), event.actorRole ? adminRoleName(tr, event.actorRole) : "—"],
            [t("audit.event.organization"), event.organization],
            [t("audit.event.record"), event.entity],
            [t("audit.event.recordType"), event.entityType ?? "—"],
            [t("audit.event.category"), enumLabel(t, "enums.category", event.category, event.category.toLowerCase().replaceAll("_", " "))],
            [t("audit.event.reason"), event.reason ?? "—"],
            [t("audit.event.ipAddress"), event.ipAddress ?? "—"],
            [t("audit.event.request"), event.requestId ?? "—"],
          ] as const).map(([name, value]) => <div key={name}><dt className="text-meta text-fg-subtle">{name}</dt><dd className="break-words text-body text-fg">{value}</dd></div>)}
        </dl>
      </section>
      {blocks.length === 0 ? <p className="text-table text-fg-muted">{t("audit.event.noSnapshot")}</p> : blocks.map(([title, text]) => (
        <section key={title} className="nesto-card p-5" aria-label={title}>
          <h2 className="text-card font-semibold text-fg">{title}</h2>
          <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-surface-muted p-3 font-mono text-micro text-fg">{text}</pre>
        </section>
      ))}
    </div>
  );
}
