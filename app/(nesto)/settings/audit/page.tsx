import type { Metadata } from "next";
import { ScrollText } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { auditQuerySchema, listAuditEvents } from "@/lib/core/audit/audit-query.service";
import { formatDateTime } from "@/lib/utils/format";
import { requireSettingsSection } from "../settings-access";

export const metadata: Metadata = { title: "Audit" };

const SEVERITY_TONE: Record<string, "default" | "warning" | "danger"> = {
  INFO: "default",
  IMPORTANT: "warning",
  CRITICAL: "danger",
};

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

  const { data, pagination } = await listAuditEvents(context, query);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Audit"
        description="Who did what, when, and what changed. Append-only: nothing here can be edited or removed."
      />

      {data.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title="No audit events match these filters."
          description="Audited actions from the last 30 days appear here."
        />
      ) : (
        <>
          <div className="nesto-card overflow-x-auto">
            <table className="w-full min-w-[52rem]">
              <thead>
                <tr className="border-b border-line text-meta text-fg-subtle">
                  <th scope="col" className="px-5 py-2 text-left font-medium">When</th>
                  <th scope="col" className="px-5 py-2 text-left font-medium">Actor</th>
                  <th scope="col" className="px-5 py-2 text-left font-medium">Action</th>
                  <th scope="col" className="px-5 py-2 text-left font-medium">Record</th>
                  <th scope="col" className="px-5 py-2 text-left font-medium">Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-5 py-3 text-meta text-fg-muted">
                      {formatDateTime(event.occurredAt)}
                    </td>
                    <td className="px-5 py-3 text-table text-fg">
                      <span className="font-medium">{event.actor.displayName}</span>
                      {event.actor.roleSnapshot ? (
                        <span className="ml-1.5 text-meta text-fg-subtle">{event.actor.roleSnapshot}</span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-table text-fg">{humanise(event.actionKey)}</td>
                    <td className="px-5 py-3 text-meta text-fg-muted">
                      {event.entity?.label ?? event.entity?.type ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={SEVERITY_TONE[event.severity] ?? "default"}>
                        {event.severity.charAt(0) + event.severity.slice(1).toLowerCase()}
                      </Badge>
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
