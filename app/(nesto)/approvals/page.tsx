import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ApprovalsShell } from "@/components/approvals/approvals-shell";
import type { ApprovalFilters } from "@/components/approvals/approval-filters";
import { inGroupWorkspace } from "@/config/workspace";
import { AccessError } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { loadRecord } from "@/lib/core/records/record.registry";
import { approvalQuerySchema, parseApprovalRef, providerKeySchema } from "@/lib/modules/approvals/approvals.schema";
import { listApprovalsForWorkspace } from "@/lib/modules/approvals/approvals.group";
import { findApprovalForRecord, getApprovalDetail } from "@/lib/modules/approvals/approvals.service";
import type { UnifiedApprovalDetail } from "@/lib/modules/approvals/approvals.types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("approvals");
  return { title: t("title") };
}

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * /approvals (PRD #41 §6, §42, §197, §198).
 *
 * The first list and, from a link, the first review are read on the server
 * through the same service the API uses, so the page paints with its content.
 * A link that names a record rather than an approval is resolved here to the
 * approval this reader may open on it — or to the record itself when there is
 * none. Nothing in the URL grants anything: every id is authorised again.
 *
 * In the Group workspace this is the read view across the companies the person
 * works in (Workspace Context §33, §45): the list is the merge of each company's
 * own queue, and an approval, a record link or the delegation panel is opened
 * inside its company, so none of those parameters is read here. Who may see
 * approvals at all is each company's own answer, not the home company's: a
 * person with none anywhere gets the empty state rather than an access error (§76).
 */
export default async function ApprovalsPage({ searchParams }: Params) {
  const context = await requireModule("approvals");
  const group = inGroupWorkspace(context);
  if (!group && !can(context, "approvals.view")) redirect("/access-denied");
  const params = await searchParams;

  const record = group ? undefined : one(params.record);
  if (record) {
    const [type, id] = record.split(":");
    const ref = type && id ? await findApprovalForRecord(context, type, id, { providerKey: providerKeySchema.safeParse(one(params.provider)).data ?? null }) : null;
    if (ref) redirect(`/approvals?approval=${encodeURIComponent(ref)}`);
    const readable = type && id ? await loadRecord(context, type, id) : null;
    redirect(readable?.href ?? "/approvals");
  }

  const query = approvalQuerySchema.parse({
    tab: one(params.tab),
    provider: params.provider,
    status: params.status,
    priority: params.priority,
    dueState: params.dueState,
    projectId: one(params.projectId),
    requesterId: one(params.requesterId),
    company: group ? one(params.company) : undefined,
    from: one(params.from),
    to: one(params.to),
    amountMin: one(params.amountMin),
    amountMax: one(params.amountMax),
    q: one(params.q),
    sort: one(params.sort),
    returned: one(params.returned),
  });

  const ref = group ? null : parseApprovalRef(one(params.approval));
  let detail: UnifiedApprovalDetail | null = null;
  let detailError: string | null = null;
  if (ref) {
    try {
      detail = await getApprovalDetail(context, ref.providerKey, ref.approvalId);
    } catch (error) {
      detailError = error instanceof AccessError ? error.message : "This approval could not be opened.";
    }
  }

  const initial = await listApprovalsForWorkspace(context, query);
  const filters: ApprovalFilters = {
    provider: query.provider,
    status: query.status,
    priority: query.priority,
    dueState: query.dueState,
    projectId: query.projectId ?? null,
    requesterId: query.requesterId ?? null,
    company: query.company ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
    amountMin: query.amountMin !== undefined ? String(query.amountMin) : null,
    amountMax: query.amountMax !== undefined ? String(query.amountMax) : null,
  };

  return (
    <ApprovalsShell
      initialState={{ tab: query.tab, q: query.q ?? "", sort: query.sort, filters, returned: query.returned }}
      initial={initial}
      initialSelection={ref ? `${ref.providerKey}:${ref.approvalId}` : null}
      initialDetail={detail}
      initialDetailError={detailError}
      openDelegation={!group && one(params.panel) === "delegation"}
      group={group}
    />
  );
}
