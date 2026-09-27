"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { FilePen } from "lucide-react";

import { amountLabel } from "@/components/finance/unit-finance/finance-status";
import { FieldsDialog, type Submit } from "@/components/finance/unit-finance/fields-dialog";
import { PersonLink } from "@/components/people/person-link";
import { structureApi } from "@/components/project-structure/structure-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CONTRACT_REQUEST_STATUS_LABELS, type ContractRequestDTO } from "@/lib/modules/contracts/units/unit-contract.types";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatRelativeTime } from "@/lib/utils/format";
import { contractsLabel, useContractsTranslations } from "../contracts-text";

/**
 * Legal's queue of contract requests (E-05F §12): each names the unit, its
 * project and place, the client and deal where the reader may see them, the
 * agreed price and how long the reservation holds. Drafting happens on the
 * unit's Legal section, where the contract is drafted from the request.
 */
export function ContractRequestQueue({ items, view, canCreate, canDecline }: { items: ContractRequestDTO[]; view: "open" | "closed"; canCreate: boolean; canDecline: boolean }) {
  const t = useContractsTranslations();
  const router = useRouter();
  const toast = useToast();
  const [declining, setDeclining] = React.useState<ContractRequestDTO | null>(null);
  const submit: Submit = React.useCallback(
    async (url, body, success) => {
      await structureApi(url, { method: "POST", body });
      toast({ title: success });
      router.refresh();
    },
    [router, toast],
  );

  return (
    <div className="space-y-3">
      <nav aria-label={t("requests.views")} className="flex gap-1">
        {(["open", "closed"] as const).map((key) => (
          <Link key={key} href={key === "open" ? "/contracts/requests" : "/contracts/requests?view=closed"} aria-current={view === key ? "page" : undefined} className={cn("inline-flex h-8 items-center rounded-md px-3 text-table font-medium touch:h-11", view === key ? "bg-hover text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}>
            {key === "open" ? t("requests.waiting") : t("requests.answered")}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center text-table text-fg-muted" data-testid="contract-requests-empty">
          {view === "open" ? t("requests.openEmpty") : t("requests.closedEmpty")}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="contract-requests">
          {items.map((row) => {
            const unitHref = `/projects/${row.unit.projectId}/units/${row.unit.id}/legal`;
            return (
              <li key={row.id} className="nesto-card flex flex-wrap items-start gap-3 p-4" data-testid="contract-request-row" data-unit-code={row.unit.unitCode}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={unitHref} className="text-body font-semibold text-fg hover:underline">
                      {row.unit.unitCode}
                    </Link>
                    <Badge tone={row.status === "OPEN" ? "warning" : row.status === "FULFILLED" ? "success" : "default"}>{contractsLabel(t, "requestStatus", row.status, CONTRACT_REQUEST_STATUS_LABELS[row.status])}</Badge>
                    <span className="text-meta text-fg-subtle">
                      {row.unit.projectName} · {row.unit.building} · {row.unit.floor}
                    </span>
                  </div>
                  <p className="mt-1 text-table text-fg-muted">
                    {row.client ? row.client.name : t("requests.clientHidden")}
                    {row.deal ? ` · ${row.deal.name}` : ""}{t("requests.agreed", { amount: amountLabel(row.agreedPrice, row.currency) })}
                  </p>
                  <p className="mt-0.5 text-meta text-fg-subtle">
                    {t("requests.requested", { when: formatRelativeTime(row.requestedAt) })}
                    {row.requestedBy ? (
                      <>
                        {t("requests.by")}
                        <PersonLink memberId={row.requestedByMemberId} name={row.requestedBy} />
                      </>
                    ) : null}
                    {row.status === "OPEN" && row.reservation.status === "ACTIVE" ? t("requests.reservedUntil", { date: formatDate(row.reservation.expiresAt) }) : ""}
                    {row.contract ? ` · ${row.contract.number}` : ""}
                  </p>
                  {row.notes ? <p className="mt-1 whitespace-pre-line text-table text-fg">{row.notes}</p> : null}
                  {row.closeReason && row.status !== "OPEN" ? <p className="mt-1 text-meta text-fg-muted">{row.closeReason}</p> : null}
                </div>
                {row.status === "OPEN" ? (
                  <div className="flex flex-wrap gap-2">
                    {canCreate ? (
                      <Button asChild size="sm">
                        <Link href={`${unitHref}?action=create`}>
                          <FilePen aria-hidden="true" /> {t("requests.draftContract")}
                        </Link>
                      </Button>
                    ) : null}
                    {canDecline ? (
                      <Button size="sm" variant="secondary" onClick={() => setDeclining(row)}>
                        {t("common.decline")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {declining ? (
        <FieldsDialog open onClose={() => setDeclining(null)} title={t("requests.declineTitle", { unit: declining.unit.unitCode })} description={t("requests.declineDescription")} confirmLabel={t("common.decline")} url={`/api/contracts/requests/${declining.id}/decline`} fields={[{ name: "reason", label: t("common.reason"), kind: "textarea", required: true }]} success={t("requests.declined")} submit={submit} module="contracts" />
      ) : null}
    </div>
  );
}
