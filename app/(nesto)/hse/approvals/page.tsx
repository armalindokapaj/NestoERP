import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { ApprovalQueue } from "@/components/hse/approval-queue";
import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import * as approvals from "@/lib/modules/hse/approvals/approval.service";

export const metadata: Metadata = { title: "HSE approvals" };

/**
 * What is waiting for a decision (PRD #22 §181, §182).
 *
 * Only decisions on records the reader could open directly — the queue is not a
 * back door into another site's incident history. Decided rows stay, so it
 * doubles as the record of who signed what.
 */
export default async function HseApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hse");
  if (!can(context, "hse.approval.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "hse");
  const params = await searchParams;
  const includeDecided = params.view === "all";

  const result = await approvals.listApprovalQueue(context, { includeDecided, limit: 50 });

  return (
    <ModulePage
      experience={experience}
      activeSection="approvals"
      description="Inspections, risk assessments, permits and incident closures waiting on somebody."
    >
      {result.data.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title={includeDecided ? "Nothing has been decided yet." : "Nothing is waiting."}
          description="Submitted inspections, risk assessments, permits and incident closures appear here."
        />
      ) : (
        <ApprovalQueue items={result.data} />
      )}
    </ModulePage>
  );
}
