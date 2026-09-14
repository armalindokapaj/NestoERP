import type { Metadata } from "next";
import Link from "next/link";

import { EmptyNote, Facts, Panel, ReviewBadge } from "@/components/engineering/engineering-ui";
import { counted, orNotFound } from "@/components/engineering/page-helpers";
import { requireModule } from "@/lib/context/current-user";
import { listContractorAssignments } from "@/lib/modules/contractors/contractor.assignments";
import { listContractorCompliance } from "@/lib/modules/contractors/contractor.compliance";
import { getContractor } from "@/lib/modules/contractors/contractor.service";
import { ASSIGNMENT_STATUS_LABELS, COMPLIANCE_ALERT_STATUSES, COMPLIANCE_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";
import { dateLabel } from "@/lib/modules/project-planning/planning.dates";

type Params = { params: Promise<{ contractorId: string }> };

export const metadata: Metadata = { title: "Contractor" };

/** The contractor at a glance (PRD #46 §160): who they are, where they work, what is out of date. */
export default async function ContractorOverviewPage({ params }: Params) {
  const { contractorId } = await params;
  const context = await requireModule("contractors");
  const contractor = await orNotFound(getContractor(context, contractorId));
  const caps = contractor.capabilities;
  const [assignments, compliance] = await Promise.all([listContractorAssignments(context, contractor.id).catch(() => []), caps.canViewCompliance ? listContractorCompliance(context, contractor.id) : Promise.resolve([])]);
  const alerts = compliance.filter((item) => COMPLIANCE_ALERT_STATUSES.includes(item.status));
  const address = [contractor.addressLine1, contractor.addressLine2, [contractor.postalCode, contractor.city].filter(Boolean).join(" "), contractor.region, contractor.countryCode].filter(Boolean).join(", ");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5">
        <Panel title="Projects" description="Where this contractor is assigned, as far as you can see." actions={<Link href={`/contractors/${contractor.id}/projects`} className="text-table text-fg-muted hover:text-fg">All projects</Link>}>
          {assignments.length === 0 ? (
            <EmptyNote>Not assigned to any project you can open.</EmptyNote>
          ) : (
            <ul className="divide-y divide-line">
              {assignments.slice(0, 6).map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-4 py-3" data-testid="assignment-row">
                  <div className="min-w-0">
                    <Link href={`/projects/${row.project.id}/contractors`} className="text-table font-medium text-fg hover:underline">
                      {row.project.label}
                    </Link>
                    {row.scopeSummary ? <p className="mt-0.5 line-clamp-1 text-meta text-fg-muted" title={row.scopeSummary}>{row.scopeSummary}</p> : null}
                    <p className="mt-1 text-meta tabular-nums text-fg-muted">
                      {row.workPackages} {counted(row.workPackages, "work package")} · {row.openRfis} open {counted(row.openRfis, "RFI")} · {row.openSubmittals} {counted(row.openSubmittals, "submittal")}
                    </p>
                  </div>
                  <ReviewBadge status={row.status} label={ASSIGNMENT_STATUS_LABELS[row.status]} testId="assignment-status" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {caps.canViewCompliance ? (
          <Panel title="Compliance alerts" testId="contractor-compliance-alerts" actions={<Link href={`/contractors/${contractor.id}/compliance`} className="text-table text-fg-muted hover:text-fg">All compliance</Link>}>
            {alerts.length === 0 ? (
              <EmptyNote>Everything on file is in date.</EmptyNote>
            ) : (
              <ul className="divide-y divide-line">
                {alerts.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/contractors/${contractor.id}/compliance?item=${item.id}`} className="text-table font-medium text-fg hover:underline">
                        {item.title}
                      </Link>
                      <p className="text-meta text-fg-muted">{item.expiresAt ? `${item.status === "EXPIRED" ? "Expired" : "Expires"} ${dateLabel(item.expiresAt)}` : "Not on file"}</p>
                    </div>
                    <ReviewBadge status={item.status} label={COMPLIANCE_STATUS_LABELS[item.status]} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>
      <aside className="min-w-0 space-y-5">
        <Panel title="Organisation">
          <Facts
            columns={2}
            items={[
              { label: "Trading name", value: contractor.tradingName },
              { label: "Registration", value: contractor.registrationNumber },
              { label: "VAT", value: contractor.vatNumber },
              { label: "Country", value: contractor.countryCode },
              { label: "Email", value: contractor.email ? <a href={`mailto:${contractor.email}`} className="underline-offset-4 hover:underline">{contractor.email}</a> : null },
              { label: "Phone", value: contractor.phone },
              { label: "Website", value: contractor.website },
              { label: "Supplier", value: contractor.supplier ? <Link href={contractor.supplier.href} className="underline-offset-4 hover:underline">{contractor.supplier.label}</Link> : null },
            ]}
          />
          {address ? <p className="mt-4 border-t border-line pt-4 text-table text-fg-muted">{address}</p> : null}
        </Panel>
        <Panel title="Primary contact">
          <Facts columns={2} items={[{ label: "Name", value: contractor.primaryContactName }, { label: "Email", value: contractor.primaryContactEmail }, { label: "Phone", value: contractor.primaryContactPhone }]} />
        </Panel>
        {contractor.notes || contractor.statusReason ? (
          <Panel title="Notes">
            {contractor.statusReason ? <p className="text-table text-fg-muted">Status: {contractor.statusReason}</p> : null}
            {contractor.notes ? <p className="mt-2 whitespace-pre-wrap text-table text-fg">{contractor.notes}</p> : null}
          </Panel>
        ) : null}
      </aside>
    </div>
  );
}
