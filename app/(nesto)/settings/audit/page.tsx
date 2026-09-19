import type { Metadata } from "next";
import { ScrollText } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { PersonLink } from "@/components/people/person-link";
import { AuditExportLink } from "@/components/settings/audit-export-link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { auditQuerySchema, listAuditEvents } from "@/lib/core/audit/audit-query.service";
import { can } from "@/lib/access/can";
import { getTranslations } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/utils/format";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.audit.label") };
}

const SEVERITY_TONE = {
  INFO: "default",
  IMPORTANT: "warning",
  CRITICAL: "danger",
} as const;

function isKnownSeverity(severity: string): severity is keyof typeof SEVERITY_TONE {
  return severity in SEVERITY_TONE;
}

/** Turns FINANCE_INVOICE_APPROVED into "Finance invoice approved". */
function humanise(actionKey: string): string {
  const words = actionKey.toLowerCase().split("_");
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + " " + words.slice(1).join(" ");
}

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The audit viewer (PRD #28 §58, §66-§68).
 *
 * Dense and neutral by design: this is evidence, read after the fact, so it
 * favours precision over decoration (PRD #28 §227).
 */
export default async function AuditSettingsPage({ searchParams }: Params) {
  const context = await requireSettingsSection("audit");
  const params = await searchParams;

  const query = auditQuerySchema.parse({
    page: typeof params.page === "string" ? params.page : 1,
    pageSize: 50,
    severities: typeof params.severity === "string" ? [params.severity] : undefined,
    query: typeof params.q === "string" ? params.q : undefined,
  });

  const [{ data, pagination }, t] = await Promise.all([
    listAuditEvents(context, query),
    getTranslations("settings"),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SettingsPageHeader
          title={t("sections.audit.label")}
          description={t("audit.description")}
        />
        {/* Taking a copy of the evidence is its own decision, and its own
            permission (PRD #28 §170). */}
        {can(context, "audit.export") ? <AuditExportLink /> : null}
      </div>

      {data.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title={t("audit.emptyTitle")}
          description={t("audit.emptyDescription")}
        />
      ) : (
        <>
          <div className="nesto-card overflow-x-auto">
            <table className="w-full min-w-[52rem]">
              <thead>
                <tr className="border-b border-line text-meta text-fg-subtle">
                  <th scope="col" className="px-5 py-2 text-left font-medium">{t("audit.when")}</th>
                  <th scope="col" className="px-5 py-2 text-left font-medium">{t("audit.actor")}</th>
                  <th scope="col" className="px-5 py-2 text-left font-medium">{t("audit.action")}</th>
                  <th scope="col" className="px-5 py-2 text-left font-medium">{t("audit.record")}</th>
                  <th scope="col" className="px-5 py-2 text-left font-medium">{t("audit.severity")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-5 py-3 text-meta text-fg-muted">
                      {formatDateTime(event.occurredAt)}
                    </td>
                    <td className="px-5 py-3 text-table text-fg">
                      {event.actor.memberId ? (
                        <PersonLink memberId={event.actor.memberId} name={event.actor.displayName} />
                      ) : (
                        <span className="font-medium">{event.actor.displayName}</span>
                      )}
                      {event.actor.roleSnapshot ? (
                        <span className="ml-1.5 text-meta text-fg-subtle">{event.actor.roleSnapshot}</span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-table text-fg">{humanise(event.actionKey)}</td>
                    <td className="px-5 py-3 text-meta text-fg-muted">
                      {event.entity?.label ?? event.entity?.type ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      {isKnownSeverity(event.severity) ? (
                        <Badge tone={SEVERITY_TONE[event.severity]}>
                          {t(`audit.severities.${event.severity}`)}
                        </Badge>
                      ) : (
                        <Badge tone="default">{event.severity}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            meta={pagination}
            buildHref={(next) => (next > 1 ? `/settings/audit?page=${next}` : "/settings/audit")}
          />
        </>
      )}
    </div>
  );
}
