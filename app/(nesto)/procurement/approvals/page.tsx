import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { CheckCheck } from "lucide-react";

import { ProcurementApprovalQueue } from "@/components/procurement/approval-queue";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import * as approvals from "@/lib/modules/procurement/approvals/approval.service";

export const metadata: Metadata = { title: "Procurement approvals" };

/**
 * The approval queue (PRD #19 §152, §153).
 *
 * Requests and orders in one list, because the person deciding does not care
 * which table a thing lives in. Scoped to records the reader could open
 * directly: the queue is not a back door into another project's buying.
 */
export default async function ApprovalsPage() {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.approval.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "procurement");
  const [pending, decided] = await Promise.all([
    approvals.listApprovals(context, { status: "PENDING", limit: 50 }),
    approvals.listApprovals(context, { status: "DECIDED", limit: 20 }),
  ]);
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
            <ProcurementApprovalQueue approvals={pending.data} steps={steps} />
          )}
        </section>

        {decided.data.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Recently decided</h2>
            <ProcurementApprovalQueue approvals={decided.data} />
          </section>
        ) : null}
      </div>
    </ModulePage>
  );
}
