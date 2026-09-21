import { apiOk, withContext } from "@/lib/api/respond";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { listApprovalsForWorkspace } from "@/lib/modules/approvals/approvals.group";

/**
 * GET /api/approvals — the aggregated queue (PRD #41 §114).
 *
 * `tab`, `provider`, `status`, `priority`, `projectId`, `requesterId`, `from`,
 * `to`, `dueState`, `amountMin`, `amountMax`, `q`, `sort`, `cursor`, `limit`.
 * Every item is one the reader can open; counts come from the same providers.
 *
 * In the Group workspace the answer is the merge of every company the person
 * may read approvals in, each item naming its company, and `company` narrows it
 * to one of them (Workspace Context §33, §45). Deciding is company-only: the
 * routes under this one still answer "choose a company" there.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const many = (key: string) => (params.getAll(key).length > 0 ? params.getAll(key) : undefined);
    const one = (key: string) => params.get(key) ?? undefined;
    const query = approvalQuerySchema.parse({
      tab: one("tab"),
      provider: many("provider"),
      status: many("status"),
      priority: many("priority"),
      dueState: many("dueState"),
      projectId: one("projectId"),
      requesterId: one("requesterId"),
      company: one("company"),
      from: one("from"),
      to: one("to"),
      amountMin: one("amountMin"),
      amountMax: one("amountMax"),
      q: one("q"),
      sort: one("sort"),
      returned: one("returned"),
      cursor: one("cursor"),
      limit: one("limit"),
    });
    return apiOk({ data: await listApprovalsForWorkspace(context, query) });
  }, { group: "read" });
}
