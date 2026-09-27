import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { ContractApprovalQueue } from "@/components/contracts/approval-queue";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import * as approvals from "@/lib/modules/contracts/approvals/approval.service";
import { Pagination } from "@/components/data/pagination";
import { firstValue, listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

export const metadata: Metadata = { title: "Contract approvals" };

/**
 * The approval queue (PRD #18 §185–§188).
 *
 * Scoped like everything else: an approver sees the contracts they can already
 * open, and nothing else appears here because it is waiting for a decision.
 */
export default async function ContractApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("contracts");
  if (!can(context, "legal.approval.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "contracts");
  const params = await searchParams;
  const decided = params.status === "DECIDED";

  const requested = Number.parseInt(firstValue(params.page) ?? "1", 10);
  const page = Number.isFinite(requested) && requested > 0 ? requested : 1;
  const result = await approvals.listApprovals(context, {
    status: decided ? "DECIDED" : "PENDING",
    page,
    limit: 50,
  });
  // Every approval is reachable page by page — no silent first 50; a page past the end moves once (AUD-08 §4, DT-05).
  if (result.pagination.page !== page) redirect(listPageRedirect("/contracts/approvals", params, result.pagination.page));

  return (
    <ModulePage
      experience={experience}
      activeSection="approvals"
      actions={
        can(context, "approvals.view") ? (
          <Button asChild variant="secondary" size="sm">
            <Link href="/approvals?provider=legal">Open in Approvals</Link>
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <nav aria-label="Approval filter" className="flex gap-2">
          <FilterLink href="/contracts/approvals" label="Pending" active={!decided} />
          <FilterLink href="/contracts/approvals?status=DECIDED" label="Decided" active={decided} />
        </nav>

        {result.data.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck />}
            title={decided ? "Nothing decided yet." : "No contracts awaiting approval."}
            description={
              decided
                ? "Approved and rejected submissions appear here once a decision is recorded."
                : "Contracts and amendments submitted for a decision appear here."
            }
          />
        ) : (
          <>
            <ContractApprovalQueue approvals={result.data} />
            <Pagination meta={result.pagination} buildHref={(next) => pageHref("/contracts/approvals", params, next)} />
          </>
        )}
      </div>
    </ModulePage>
  );
}

function FilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-md bg-surface-2 px-3 py-1.5 text-table font-medium text-fg"
          : "rounded-md px-3 py-1.5 text-table text-fg-muted transition-colors hover:text-fg"
      }
    >
      {label}
    </a>
  );
}
