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
import { StatusText } from "@/components/i18n/common-text";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.candidate") };
}

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

  const t = await getTranslations("hr");
  const account = candidate.person.hasAccount
    ? t("recruitment.accountActive")
    : candidate.provisioning && !["REJECTED", "CANCELLED"].includes(candidate.provisioning.status)
      ? t("recruitment.provisioningRequested")
      : t("recruitment.notRequested");

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: t("meta.hr"), href: "/hr" }, { label: t("meta.recruitment"), href: "/hr/recruitment" }, { label: candidate.name }]} />
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
            {t("recruitment.identity")}
          </h2>
          <dl className="mt-3">
            <Row label={t("employee.workEmail")} value={candidate.person.workEmail} />
            <Row label={t("recruitment.workPhone")} value={candidate.person.workPhone} />
            <Row label={t("recruitment.personalEmail")} value={candidate.person.personalEmail} />
            <Row label={t("recruitment.personalPhone")} value={candidate.person.personalPhone} />
            <Row label={t("recruitment.city")} value={[candidate.person.city, candidate.person.country].filter(Boolean).join(", ") || null} />
            <Row label={t("recruitment.person")} value={<StatusText status={candidate.person.lifecycleStatus} />} />
          </dl>
        </section>

        <section className="nesto-card p-5" aria-labelledby="candidate-position">
          <h2 id="candidate-position" className="text-card font-semibold text-fg">
            {t("recruitment.companyDepartment")}
          </h2>
          <dl className="mt-3">
            <Row label={t("recruitment.company")} value={candidate.targetCompany?.name} />
            <Row label={t("columns.department")} value={candidate.targetDepartment?.name} />
            <Row label={t("employee.role")} value={candidate.targetRole?.label} />
            <Row label={t("fields.jobTitle")} value={candidate.targetJobTitle} />
            <Row label={t("recruitment.hiringManager")} value={candidate.hiringManager ? <PersonLink userId={candidate.hiringManager.userId} name={candidate.hiringManager.name} /> : null} />
            <Row label={t("recruitment.interviewStage")} value={candidate.interviewStage} />
            {candidate.decidedAt ? <Row label={t("leave.decided")} value={formatDate(candidate.decidedAt)} /> : null}
          </dl>
        </section>

        <section className="nesto-card p-5" aria-labelledby="candidate-employment">
          <h2 id="candidate-employment" className="text-card font-semibold text-fg">
            {t("tabs.employment")}
          </h2>
          {candidate.employment ? (
            <dl className="mt-3" data-testid="candidate-employment">
              <Row label={t("recruitment.company")} value={candidate.employment.companyName} />
              <Row label={t("columns.status")} value={<StatusBadge status={candidate.employment.status} />} />
              <Row label={t("fields.employeeNumber")} value={candidate.employment.employeeNumber} />
            </dl>
          ) : (
            <p className="mt-3 text-table text-fg-muted">{t("recruitment.noEmployment")}</p>
          )}
        </section>

        <section className="nesto-card p-5" aria-labelledby="candidate-account">
          <h2 id="candidate-account" className="text-card font-semibold text-fg">
            {t("columns.nestoAccount")}
          </h2>
          <dl className="mt-3" data-testid="candidate-account">
            <Row label={t("employee.account")} value={account} />
            {candidate.provisioning ? (
              <Row
                label={t("recruitment.request")}
                value={
                  can(context, "organization.provisioning_request.view") ? (
                    <Link href={`/organization/provisioning/${candidate.provisioning.id}`} className="text-accent-strong hover:underline">
                      <StatusText status={candidate.provisioning.status} />
                    </Link>
                  ) : (
                    <StatusText status={candidate.provisioning.status} />
                  )
                }
              />
            ) : null}
          </dl>
        </section>

        {candidate.notes ? (
          <section className="nesto-card p-5 lg:col-span-2" aria-labelledby="candidate-notes">
            <h2 id="candidate-notes" className="text-card font-semibold text-fg">
              {t("attendance.notes")}
            </h2>
            <p className="mt-3 whitespace-pre-line text-table text-fg">{candidate.notes}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
