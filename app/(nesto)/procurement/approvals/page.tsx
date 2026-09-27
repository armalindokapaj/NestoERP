import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { CheckCheck } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { ProcurementApprovalQueue } from "@/components/procurement/approval-queue";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import * as approvals from "@/lib/modules/procurement/approvals/approval.service";
import { firstValue, listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

export const metadata: Metadata = { title: "Procurement approvals" };

/**
 * The approval queue (PRD #19 §152, §153).
 *
 * Requests and orders in one list, because the person deciding does not care
 * which table a thing lives in. Scoped to records the reader could open
 * directly: the queue is not a back door into another project's buying.
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.approval.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "procurement");
  const params = await searchParams;
  const requested = Number.parseInt(firstValue(params.page) ?? "1", 10);
  const page = Number.isFinite(requested) && requested > 0 ? requested : 1;
  // Everything waiting is reachable page by page — never a silent first 50 (AUD-08 §4). The decided
  // list is a stated "most recent" slice with its full count beside it.
  const [pending, decided] = await Promise.all([
    approvals.listApprovals(context, { status: "PENDING", page, limit: 50 }),
    approvals.listApprovals(context, { status: "DECIDED", limit: 20 }),
  ]);
  if (pending.pagination.page !== page) redirect(listPageRedirect("/procurement/approvals", params, pending.pagination.page));
  // The chain step each waiting row shows, which its decision names back (AUD-10 §4, CW-04).
  const steps = await approvals.currentStepNumbers(pending.data.map((row) => row.id));

  return (
    <ModulePage
      experience={experience}
      activeSection="approvals"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href="/procurement/approvals/limits">Approval limits</Link>
          </Button>
          {can(context, "approvals.view") ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/approvals?provider=procurement">Open in Approvals</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-card font-semibold text-fg">Waiting on a decision</h2>
          {pending.data.length === 0 ? (
            <EmptyState
              icon={<CheckCheck />}
              title="Nothing is waiting."
              description="Requests and orders submitted for approval appear here."
            />
          ) : (
            <>
              <ProcurementApprovalQueue approvals={pending.data} steps={steps} />
              <Pagination meta={pending.pagination} buildHref={(next) => pageHref("/procurement/approvals", params, next)} />
            </>
          )}
        </section>

        {decided.data.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Recently decided</h2>
            <p className="text-meta text-fg-subtle" data-testid="decided-scope">
              The {decided.data.length} most recent of {decided.pagination.total} decisions.
            </p>
            <ProcurementApprovalQueue approvals={decided.data} />
          </section>
        ) : null}
      </div>
    </ModulePage>
  );
}
