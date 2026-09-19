"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

/**
 * Legal's queue of contract requests (E-05F §12): each names the unit, its
 * project and place, the client and deal where the reader may see them, the
 * agreed price and how long the reservation holds. Drafting happens on the
 * unit's Legal section, where the contract is drafted from the request.
 */
export function ContractRequestQueue({ items, view, canCreate, canDecline }: { items: ContractRequestDTO[]; view: "open" | "closed"; canCreate: boolean; canDecline: boolean }) {
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
      <nav aria-label="Request views" className="flex gap-1">
        {(["open", "closed"] as const).map((key) => (
          <Link key={key} href={key === "open" ? "/contracts/requests" : "/contracts/requests?view=closed"} aria-current={view === key ? "page" : undefined} className={cn("inline-flex h-8 items-center rounded-md px-3 text-table font-medium", view === key ? "bg-hover text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}>
            {key === "open" ? "Waiting" : "Answered"}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center text-table text-fg-muted" data-testid="contract-requests-empty">
          {view === "open" ? "No unit is waiting for a contract." : "No request has been answered yet."}
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
                    <Badge tone={row.status === "OPEN" ? "warning" : row.status === "FULFILLED" ? "success" : "default"}>{CONTRACT_REQUEST_STATUS_LABELS[row.status]}</Badge>
                    <span className="text-meta text-fg-subtle">
                      {row.unit.projectName} · {row.unit.building} · {row.unit.floor}
                    </span>
                  </div>
                  <p className="mt-1 text-table text-fg-muted">
                    {row.client ? row.client.name : "Client hidden"}
                    {row.deal ? ` · ${row.deal.name}` : ""} · agreed {amountLabel(row.agreedPrice, row.currency)}
                  </p>
                  <p className="mt-0.5 text-meta text-fg-subtle">
                    Requested {formatRelativeTime(row.requestedAt)}
                    {row.requestedBy ? (
                      <>
                        {" by "}
                        <PersonLink memberId={row.requestedByMemberId} name={row.requestedBy} />
                      </>
                    ) : null}
                    {row.status === "OPEN" && row.reservation.status === "ACTIVE" ? ` · reserved until ${formatDate(row.reservation.expiresAt)}` : ""}
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
                          <FilePen aria-hidden="true" /> Draft contract
                        </Link>
                      </Button>
                    ) : null}
                    {canDecline ? (
                      <Button size="sm" variant="secondary" onClick={() => setDeclining(row)}>
                        Decline
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
        <FieldsDialog open onClose={() => setDeclining(null)} title={`Decline the request for ${declining.unit.unitCode}?`} description="Sales is told, with your reason." confirmLabel="Decline" url={`/api/contracts/requests/${declining.id}/decline`} fields={[{ name: "reason", label: "Reason", kind: "textarea", required: true }]} success="The request was declined." submit={submit} />
      ) : null}
    </div>
  );
}
