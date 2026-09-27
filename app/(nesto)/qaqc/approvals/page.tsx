import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCheck } from "lucide-react";

import { ApprovalQueue } from "@/components/qaqc/approval-queue";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import * as approvals from "@/lib/modules/qaqc/approvals/approval.service";
import { approvalListQuerySchema } from "@/lib/modules/qaqc/qaqc.schema";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

export const metadata: Metadata = { title: "Quality approvals" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The quality approval queue (PRD #21 §164, §165).
 *
 * Scoped twice: to the records the reader can open, and to the types they hold
 * a decision permission for. Whatever they submitted themselves shows without
 * decision controls — nobody signs off their own work.
 *
 * The count is the number of cycles on records the reader can open, and a
 * page past the end moves once to the last real page (AUD-08 §4, DT-05).
 */
export default async function QaqcApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("qaqc");
  if (!can(context, "qaqc.approval.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "qaqc");
  const params = await searchParams;

  const read = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;

  const query = approvalListQuerySchema.parse({
    view: read("view"),
    recordType: read("recordType"),
    page: read("page"),
  });

  const result = await approvals.listApprovals(context, query);
  if (result.pagination.page !== query.page) {
    redirect(listPageRedirect("/qaqc/approvals", params, result.pagination.page));
  }

  const buildHref = (page: number) => pageHref("/qaqc/approvals", params, page);

  return (
    <ModulePage
      experience={experience}
      activeSection="approvals"
      description="Inspections and NCRs waiting on a decision. You will not see decision controls on anything you submitted yourself."
    >
      <div className="space-y-4">
        <ListToolbar
          filters={[
            {
              param: "view",
              label: "View",
              options: [
                { value: "pending", label: "Waiting" },
                { value: "decided", label: "Decided" },
                { value: "all", label: "Everything" },
              ],
            },
            {
              param: "recordType",
              label: "Kind",
              options: [
                { value: "INSPECTION", label: "Inspections" },
                { value: "NCR", label: "NCRs" },
              ],
            },
          ]}
          applied={{ view: query.view, recordType: query.recordType }}
        />

        {result.data.length === 0 ? (
          <EmptyState
            icon={<CheckCheck />}
            title={
              query.view === "pending" ? "Nothing is waiting." : "Nothing matches this view."
            }
            description={
              query.view === "pending"
                ? "Inspections and NCRs appear here when somebody submits them for a decision."
                : "Adjust the filters to see more."
            }
          />
        ) : (
          <>
            <ApprovalQueue approvals={result.data} />
            <Pagination meta={result.pagination} buildHref={buildHref} />
          </>
        )}
      </div>
    </ModulePage>
  );
}
