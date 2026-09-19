import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { StatusBadge } from "@/components/modules/status-badge";
import { ProvisioningActions } from "@/components/organization/provisioning-actions";
import { PersonLink } from "@/components/people/person-link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { getProvisioningRequest } from "@/lib/modules/organization/provisioning/provisioning.service";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { statusLabel } from "@/lib/utils/status";

export const metadata: Metadata = { title: "Account request" };

type Props = { params: Promise<{ requestId: string }> };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 py-1.5">
      <dt className="text-meta text-fg-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-table text-fg">{value ?? "—"}</dd>
    </div>
  );
}

/**
 * An account request (E-06 §29, §64): the HR truth, read-only, beside the only
 * choices that are Group IT's, and who asked, approved and created it (§115).
 */
export default async function ProvisioningRequestPage({ params }: Props) {
  const { requestId } = await params;
  const context = await requireModule("organization");
  if (!can(context, "organization.provisioning_request.view")) redirect("/access-denied");

  const request = await getProvisioningRequest(context, requestId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const when = (value: string | null) => (value ? formatDateTime(value) : null);

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Organization", href: "/organization" }, { label: "User provisioning", href: "/organization/provisioning" }, { label: request.person.name }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-fg">{request.person.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={request.status} />
            <span className="text-body text-fg-muted">
              {request.role.label} · {request.company.name}
            </span>
          </div>
        </div>
        <ProvisioningActions request={request} />
      </div>

      {request.returnReason && request.status === "DRAFT" ? (
        <p role="status" className="rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-table text-warning-strong">
          Returned to HR: {request.returnReason}
        </p>
      ) : null}
      {request.rejectionReason && request.status === "REJECTED" ? (
        <p role="status" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong">
          Rejected: {request.rejectionReason}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="nesto-card p-5" aria-labelledby="request-hr">
          <h2 id="request-hr" className="text-card font-semibold text-fg">
            From HR
          </h2>
          <p className="mt-1 text-meta text-fg-subtle">Read-only here. Anything wrong goes back to HR.</p>
          <dl className="mt-3" data-testid="request-hr-truth">
            <Row label="First name" value={request.hrTruth.firstName} />
            <Row label="Last name" value={request.hrTruth.lastName} />
            <Row label="Work email" value={request.hrTruth.workEmail} />
            <Row label="Work phone" value={request.hrTruth.workPhone} />
            <Row label="Company" value={request.company.name} />
            <Row label="Department" value={request.department.name} />
            <Row label="Role" value={request.role.label} />
            <Row label="Job title" value={request.jobTitle} />
            <Row label="Manager" value={request.hrTruth.manager ? <PersonLink userId={request.hrTruth.manager.userId} name={request.hrTruth.manager.name} /> : null} />
            <Row label="Employee number" value={request.hrTruth.employeeNumber} />
            <Row label="Employment" value={request.hrTruth.employmentStatus ? statusLabel(request.hrTruth.employmentStatus) : null} />
          </dl>
        </section>

        <section className="nesto-card p-5" aria-labelledby="request-account">
          <h2 id="request-account" className="text-card font-semibold text-fg">
            Account
          </h2>
          <dl className="mt-3" data-testid="request-account">
            {request.provisionedUser ? (
              <Row label="Username" value={<span className="font-mono">{request.provisionedUser.username}</span>} />
            ) : request.existingAccount ? (
              <Row label="Existing login" value={<span className="font-mono">{request.existingAccount.username}</span>} />
            ) : (
              <Row label="Username" value={<span className="font-mono">{request.requestedUsername ?? request.suggestedUsername}</span>} />
            )}
            <Row label="Needed from" value={request.requestedActivationDate ? formatDate(request.requestedActivationDate) : null} />
            <Row label="Notes" value={request.notes} />
          </dl>
        </section>

        <section className="nesto-card p-5 lg:col-span-2" aria-labelledby="request-history">
          <h2 id="request-history" className="text-card font-semibold text-fg">
            History
          </h2>
          <dl className="mt-3" data-testid="request-history">
            <Row
              label="Requested by"
              value={
                request.requestedBy ? (
                  <>
                    <PersonLink userId={request.requestedBy.userId} name={request.requestedBy.name} />
                    {request.submittedAt ? `, ${when(request.submittedAt)}` : ""}
                  </>
                ) : null
              }
            />
            <Row
              label="Approved by"
              value={
                request.approvedBy ? (
                  <>
                    <PersonLink userId={request.approvedBy.userId} name={request.approvedBy.name} />, {when(request.approvedAt)}
                  </>
                ) : null
              }
            />
            {request.returnedAt ? <Row label="Returned" value={when(request.returnedAt)} /> : null}
            <Row
              label="Created by"
              value={
                request.provisionedBy ? (
                  <>
                    <PersonLink userId={request.provisionedBy.userId} name={request.provisionedBy.name} />, {when(request.provisionedAt)}
                  </>
                ) : null
              }
            />
          </dl>
        </section>
      </div>
    </div>
  );
}
