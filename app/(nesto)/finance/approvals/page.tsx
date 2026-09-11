import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { ApprovalQueue } from "@/components/finance/approval-queue";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import * as approvals from "@/lib/modules/finance/approvals/approval.service";

export const metadata: Metadata = { title: "Approvals" };

/**
 * The approval queue (PRD #15 §141, §143).
 *
 * Scoped to the records this reader can reach: a project-scoped approver sees
 * approvals for their own projects and nothing else, so the queue can never
 * become a back door onto company records.
 */
export default async function FinanceApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.approval.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "finance");
  const { status, page: pageParam } = await searchParams;
  const decided = status === "DECIDED";

  const pageValue = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const result = await approvals.listApprovals(context, {
    status: decided ? "DECIDED" : "PENDING",
    page,
    limit: 25,
  });

  return (
    <ModulePage
      experience={experience}
      activeSection="approvals"
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link href={decided ? "/finance/approvals" : "/finance/approvals?status=DECIDED"}>
            {decided ? "Waiting for a decision" : "Decided"}
          </Link>
        </Button>
      }
    >
      {result.data.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title={decided ? "Nothing decided yet." : "Nothing is waiting for a decision."}
          description={
            decided
              ? "Approvals you have decided will be listed here."
              : "Invoices, expenses, budgets and commitments submitted for approval appear here."
          }
        />
      ) : (
        <div className="space-y-4">
          <ApprovalQueue approvals={result.data} />
          <Pagination
            meta={result.pagination}
            buildHref={(next) => {
              const params = new URLSearchParams();
              if (decided) params.set("status", "DECIDED");
              if (next > 1) params.set("page", String(next));
              const search = params.toString();
              return search ? `/finance/approvals?${search}` : "/finance/approvals";
            }}
          />
        </div>
      )}
    </ModulePage>
  );
}
