import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ScrollText } from "@/components/icons";

import { Pagination } from "@/components/data/pagination";
import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { PersonLink } from "@/components/people/person-link";
import { AuditExportLink } from "@/components/settings/audit-export-link";
import { Badge } from "@/components/ui/badge";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { EmptyState } from "@/components/ui/empty-state";
import { auditQuerySchema, listAuditEvents } from "@/lib/core/audit/audit-query.service";
import { can } from "@/lib/access/can";
import { formatDateTime } from "@/lib/i18n/format";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { recordTypeName } from "@/lib/i18n/modules/common/labels";
import type { MessageKey, Translate } from "@/lib/i18n/translator";
import { requireSettingsSection } from "../settings-access";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { TableStackLabels } from "@/components/ui/table-stack-labels";

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

/** The action in the reader's language; a key the dictionary lacks keeps the humanised English. */
function auditActionLabel(t: Translate<"auditLog">, actionKey: string): string {
  const key = `actions.${actionKey}` as MessageKey<"auditLog">;
  const text = t(key);
  return text === key ? humanise(actionKey) : text;
}

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The audit viewer (PRD #28 §58, §66-§68).
 *
 * Dense and neutral by design: this is evidence, read after the fact, so it
 * favours precision over decoration (PRD #28 §227).
 */
export default async function AuditSettingsPage({ searchParams }: Params) {
  const locale = await getLocale();
  const context = await requireSettingsSection("audit");
  const params = await searchParams;

  const query = auditQuerySchema.parse({
    page: typeof params.page === "string" ? params.page : 1,
    pageSize: 50,
    severities: typeof params.severity === "string" ? [params.severity] : undefined,
    query: typeof params.q === "string" ? params.q : undefined,
  });

  const [{ data, pagination }, t, tAudit, tCommon, tRoles] = await Promise.all([
    listAuditEvents(context, query),
    getTranslations("settings"),
    getTranslations("auditLog"),
    getTranslations("common"),
    getTranslations("roles"),
  ]);
  // The stored role and record type are English keys; English readers keep them as stored.
  const roleName = (role: string) => {
    const key = `${role}.label` as MessageKey<"roles">;
    const text = tRoles(key);
    return locale === "en" || text === key ? role : text;
  };
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (pagination.page !== query.page) redirect(listPageRedirect("/settings/audit", params, pagination.page));

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
          {/* A labelled, keyboard-reachable scroll region (AUD-04 §5, D-07-15, MW-19). */}
          <ScrollRegion label={t("sections.audit.label")} className="nesto-card">
            {/* A card per event on a phone (mobile audit 2b). */}
            <table className="w-full min-w-[52rem]" data-stack="">
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
                      {formatDateTime(event.occurredAt, locale)}
                    </td>
                    <td className="px-5 py-3 text-table text-fg">
                      {event.actor.memberId ? (
                        <PersonLink memberId={event.actor.memberId} name={event.actor.displayName} />
                      ) : (
                        <span className="font-medium">{event.actor.displayName}</span>
                      )}
                      {event.actor.roleSnapshot ? (
                        <span className="ml-1.5 text-meta text-fg-subtle">{roleName(event.actor.roleSnapshot)}</span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-table text-fg">{auditActionLabel(tAudit, event.actionKey)}</td>
                    <td className="px-5 py-3 text-meta text-fg-muted">
                      {event.entity?.label ?? (event.entity ? (locale === "en" ? event.entity.type : recordTypeName(tCommon, event.entity.type, event.entity.type)) : "—")}
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
            <TableStackLabels />
          </ScrollRegion>
          {/* Page links keep the severity and the search: paging used to drop them (AUD-08 §3). */}
          <Pagination meta={pagination} buildHref={(next) => pageHref("/settings/audit", params, next)} />
        </>
      )}
    </div>
  );
}
