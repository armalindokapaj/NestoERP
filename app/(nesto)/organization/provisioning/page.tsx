import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { PROVISIONING_STATUSES, provisioningListQuerySchema } from "@/lib/modules/organization/provisioning/provisioning.schema";
import { listProvisioningRequests } from "@/lib/modules/organization/provisioning/provisioning.service";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";
import { statusLabel } from "@/lib/utils/status";
import { Pagination } from "@/components/data/pagination";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

export const metadata: Metadata = { title: "User provisioning" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/**
 * Account requests (E-06 §61, §64, §113): what HR asked for, what is approved
 * and waiting for Group IT, and what has been created. Group-wide readers see
 * every company's requests.
 */
export default async function ProvisioningPage({ searchParams }: Props) {
  const context = await requireModule("organization");
  if (!can(context, "organization.provisioning_request.view")) redirect("/access-denied");

  const params = await searchParams;
  const query = provisioningListQuerySchema.parse({ status: one(params.status), page: one(params.page) });
  const list = await listProvisioningRequests(context, query);
  // Every request is reachable page by page — the page used to show the first 25 and no way on (AUD-08 §4, DT-05).
  if (list.meta.page !== query.page) redirect(listPageRedirect("/organization/provisioning", params, list.meta.page));
  const chip = (active: boolean) =>
    cn("inline-flex items-center rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "organization")}
      activeSection="provisioning"
      title="User provisioning"
      description="NESTO accounts HR has asked for. Approved requests are created by Group IT from the HR record, without retyping it."
    >
      <div className="space-y-4">
        <nav aria-label="Request status" className="flex flex-wrap gap-2">
          <Link href="/organization/provisioning" className={chip(!query.status)}>
            All
          </Link>
          {PROVISIONING_STATUSES.map((status) => (
            <Link key={status} href={`/organization/provisioning?status=${status}`} className={chip(query.status === status)}>
              {statusLabel(status)}
            </Link>
          ))}
        </nav>

        {list.data.length === 0 ? (
          <EmptyState title="No account requests here" description="Requests HR submits appear here for approval and for Group IT." />
        ) : (
          <section className="nesto-card p-0">
            <Table flush aria-label="Account requests">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Person</TableHeaderCell>
                  <TableHeaderCell>Company</TableHeaderCell>
                  <TableHeaderCell>Department</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Submitted</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.data.map((request) => (
                  <TableRow key={request.id} data-testid="provisioning-row">
                    <TableCell className="font-medium">
                      <Link href={`/organization/provisioning/${request.id}`} className="text-fg hover:text-accent-strong hover:underline">
                        {request.person.name}
                      </Link>
                    </TableCell>
                    <TableCell>{request.company.name}</TableCell>
                    <TableCell>{request.department.name}</TableCell>
                    <TableCell>{request.role.label}</TableCell>
                    <TableCell>
                      <StatusBadge status={request.status} />
                    </TableCell>
                    <TableCell>{request.submittedAt ? formatDate(request.submittedAt) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        )}
        <Pagination meta={list.meta} buildHref={(next) => pageHref("/organization/provisioning", params, next)} />
      </div>
    </ModulePage>
  );
}
