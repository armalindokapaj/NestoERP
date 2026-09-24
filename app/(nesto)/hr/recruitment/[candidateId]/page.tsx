import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound, redirect } from "next/navigation";

import { CandidateActions } from "@/components/hr/recruitment/candidate-actions";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { recruitmentFormOptions } from "@/lib/modules/hr/recruitment/candidate.options";
import { getCandidate } from "@/lib/modules/hr/recruitment/candidate.service";
import { statusLabel } from "@/lib/utils/status";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Candidate" };

type Props = { params: Promise<{ candidateId: string }> };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 py-1.5">
      <dt className="text-meta text-fg-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-table text-fg">{value ?? "—"}</dd>
    </div>
  );
}

/**
 * A candidate (E-06 §23, §62, §63): the person, where they are being recruited
 * to, their employment once hired, and where their NESTO account stands.
 */
export default async function CandidatePage({ params }: Props) {
  const { candidateId } = await params;
  const context = await requireModule("hr");
  if (!can(context, "candidate.view")) redirect("/access-denied");

  const candidate = await getCandidate(context, candidateId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const choices = candidate.actions.canEdit ? await recruitmentFormOptions(context) : null;

  const account = candidate.person.hasAccount
    ? "Active"
    : candidate.provisioning && !["REJECTED", "CANCELLED"].includes(candidate.provisioning.status)
      ? "Provisioning requested"
      : "Not requested";

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "HR", href: "/hr" }, { label: "Recruitment", href: "/hr/recruitment" }, { label: candidate.name }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-fg">{candidate.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={candidate.status} />
            {candidate.targetJobTitle ? <span className="text-body text-fg-muted">{candidate.targetJobTitle}</span> : null}
          </div>
        </div>
        <CandidateActions candidate={candidate} choices={choices} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="nesto-card p-5" aria-labelledby="candidate-identity">
          <h2 id="candidate-identity" className="text-card font-semibold text-fg">
            Identity
          </h2>
          <dl className="mt-3">
            <Row label="Work email" value={candidate.person.workEmail} />
            <Row label="Work phone" value={candidate.person.workPhone} />
            <Row label="Personal email" value={candidate.person.personalEmail} />
            <Row label="Personal phone" value={candidate.person.personalPhone} />
            <Row label="City" value={[candidate.person.city, candidate.person.country].filter(Boolean).join(", ") || null} />
            <Row label="Person" value={statusLabel(candidate.person.lifecycleStatus)} />
          </dl>
        </section>

        <section className="nesto-card p-5" aria-labelledby="candidate-position">
          <h2 id="candidate-position" className="text-card font-semibold text-fg">
            Company / Department
          </h2>
          <dl className="mt-3">
            <Row label="Company" value={candidate.targetCompany?.name} />
            <Row label="Department" value={candidate.targetDepartment?.name} />
            <Row label="Role" value={candidate.targetRole?.label} />
            <Row label="Job title" value={candidate.targetJobTitle} />
            <Row label="Hiring manager" value={candidate.hiringManager ? <PersonLink userId={candidate.hiringManager.userId} name={candidate.hiringManager.name} /> : null} />
            <Row label="Interview stage" value={candidate.interviewStage} />
            {candidate.decidedAt ? <Row label="Decided" value={formatDate(candidate.decidedAt)} /> : null}
          </dl>
        </section>

        <section className="nesto-card p-5" aria-labelledby="candidate-employment">
          <h2 id="candidate-employment" className="text-card font-semibold text-fg">
            Employment
          </h2>
          {candidate.employment ? (
            <dl className="mt-3" data-testid="candidate-employment">
              <Row label="Company" value={candidate.employment.companyName} />
              <Row label="Status" value={<StatusBadge status={candidate.employment.status} />} />
              <Row label="Employee number" value={candidate.employment.employeeNumber} />
            </dl>
          ) : (
            <p className="mt-3 text-table text-fg-muted">No employment yet. It is created when the candidate is hired.</p>
          )}
        </section>

        <section className="nesto-card p-5" aria-labelledby="candidate-account">
          <h2 id="candidate-account" className="text-card font-semibold text-fg">
            NESTO account
          </h2>
          <dl className="mt-3" data-testid="candidate-account">
            <Row label="Account" value={account} />
            {candidate.provisioning ? (
              <Row
                label="Request"
                value={
                  can(context, "organization.provisioning_request.view") ? (
                    <Link href={`/organization/provisioning/${candidate.provisioning.id}`} className="text-accent-strong hover:underline">
                      {statusLabel(candidate.provisioning.status)}
                    </Link>
                  ) : (
                    statusLabel(candidate.provisioning.status)
                  )
                }
              />
            ) : null}
          </dl>
        </section>

        {candidate.notes ? (
          <section className="nesto-card p-5 lg:col-span-2" aria-labelledby="candidate-notes">
            <h2 id="candidate-notes" className="text-card font-semibold text-fg">
              Notes
            </h2>
            <p className="mt-3 whitespace-pre-line text-table text-fg">{candidate.notes}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
