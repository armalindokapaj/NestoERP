import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { EmptyNote, Facts, Panel, ReviewBadge } from "@/components/engineering/engineering-ui";
import { orNotFound } from "@/components/engineering/page-helpers";
import { contractorsLabel } from "@/lib/i18n/modules/contractors/labels";
import { getTranslations } from "@/lib/i18n/server";
import { requireModule } from "@/lib/context/current-user";
import { listContractorAssignments } from "@/lib/modules/contractors/contractor.assignments";
import { listContractorCompliance } from "@/lib/modules/contractors/contractor.compliance";
import { getContractor } from "@/lib/modules/contractors/contractor.service";
import { ASSIGNMENT_STATUS_LABELS, COMPLIANCE_ALERT_STATUSES, COMPLIANCE_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";
import { dateLabel } from "@/lib/modules/project-planning/planning.dates";

type Params = { params: Promise<{ contractorId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("contractors"))("meta.contractor") };
}

/** The contractor at a glance (PRD #46 §160): who they are, where they work, what is out of date. */
export default async function ContractorOverviewPage({ params }: Params) {
  const { contractorId } = await params;
  const context = await requireModule("contractors");
  const contractor = await orNotFound(getContractor(context, contractorId));
  const caps = contractor.capabilities;
  const t = await getTranslations("contractors");
  const [assignments, compliance] = await Promise.all([listContractorAssignments(context, contractor.id).catch(() => []), caps.canViewCompliance ? listContractorCompliance(context, contractor.id) : Promise.resolve([])]);
  const alerts = compliance.filter((item) => COMPLIANCE_ALERT_STATUSES.includes(item.status));
  const address = [contractor.addressLine1, contractor.addressLine2, [contractor.postalCode, contractor.city].filter(Boolean).join(" "), contractor.region, contractor.countryCode].filter(Boolean).join(", ");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5">
        <Panel title={t("overview.projects")} description={t("overview.projectsDescription")} actions={<Link href={`/contractors/${contractor.id}/projects`} className="text-table text-fg-muted hover:text-fg">{t("overview.allProjects")}</Link>}>
          {assignments.length === 0 ? (
            <EmptyNote>{t("overview.notAssigned")}</EmptyNote>
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
                      {row.workPackages} {t("nouns.workPackage", { count: row.workPackages })} · {row.openRfis} {t("nouns.openRfi", { count: row.openRfis })} · {row.openSubmittals} {t("nouns.submittal", { count: row.openSubmittals })}
                    </p>
                  </div>
                  <ReviewBadge status={row.status} label={contractorsLabel(t, "assignmentStatus", row.status, ASSIGNMENT_STATUS_LABELS[row.status])} testId="assignment-status" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {caps.canViewCompliance ? (
          <Panel title={t("overview.complianceAlerts")} testId="contractor-compliance-alerts" actions={<Link href={`/contractors/${contractor.id}/compliance`} className="text-table text-fg-muted hover:text-fg">{t("overview.allCompliance")}</Link>}>
            {alerts.length === 0 ? (
              <EmptyNote>{t("overview.inDate")}</EmptyNote>
            ) : (
              <ul className="divide-y divide-line">
                {alerts.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/contractors/${contractor.id}/compliance?item=${item.id}`} className="text-table font-medium text-fg hover:underline">
                        {item.title}
                      </Link>
                      <p className="text-meta text-fg-muted">{item.expiresAt ? t(item.status === "EXPIRED" ? "overview.expired" : "overview.expires", { date: dateLabel(item.expiresAt) }) : t("overview.notOnFile")}</p>
                    </div>
                    <ReviewBadge status={item.status} label={contractorsLabel(t, "complianceStatus", item.status, COMPLIANCE_STATUS_LABELS[item.status])} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>
      <aside className="min-w-0 space-y-5">
        <Panel title={t("overview.organisation")}>
          <Facts
            columns={2}
            items={[
              { label: t("overview.tradingName"), value: contractor.tradingName },
              { label: t("overview.registration"), value: contractor.registrationNumber },
              { label: t("overview.vat"), value: contractor.vatNumber },
              { label: t("overview.country"), value: contractor.countryCode },
              { label: t("overview.email"), value: contractor.email ? <a href={`mailto:${contractor.email}`} className="underline-offset-4 hover:underline">{contractor.email}</a> : null },
              { label: t("overview.phone"), value: contractor.phone },
              { label: t("overview.website"), value: contractor.website },
              { label: t("overview.supplier"), value: contractor.supplier ? <Link href={contractor.supplier.href} className="underline-offset-4 hover:underline">{contractor.supplier.label}</Link> : null },
            ]}
          />
          {address ? <p className="mt-4 border-t border-line pt-4 text-table text-fg-muted">{address}</p> : null}
        </Panel>
        <Panel title={t("overview.primaryContact")}>
          {/* Tap to write or call, as on the Contacts tab (AUD-04 §3, D-09-14, MW-19). */}
          <Facts
            columns={2}
            items={[
              { label: t("overview.name"), value: contractor.primaryContactName },
              { label: t("overview.email"), value: contractor.primaryContactEmail ? <a href={`mailto:${contractor.primaryContactEmail}`} className="inline-flex items-center underline-offset-4 [overflow-wrap:anywhere] hover:underline touch:min-h-11">{contractor.primaryContactEmail}</a> : null },
              { label: t("overview.phone"), value: contractor.primaryContactPhone ? <a href={`tel:${contractor.primaryContactPhone}`} className="inline-flex items-center underline-offset-4 hover:underline touch:min-h-11">{contractor.primaryContactPhone}</a> : null },
            ]}
          />
        </Panel>
        {contractor.notes || contractor.statusReason ? (
          <Panel title={t("overview.notes")}>
            {contractor.statusReason ? <p className="text-table text-fg-muted">{t("overview.statusReason", { reason: contractor.statusReason })}</p> : null}
            {contractor.notes ? <p className="mt-2 whitespace-pre-wrap text-table text-fg">{contractor.notes}</p> : null}
          </Panel>
        ) : null}
      </aside>
    </div>
  );
}
