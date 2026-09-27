import { EditContractorButton } from "@/components/contractors/contractor-dialogs";
import { ReviewBadge } from "@/components/engineering/engineering-ui";
import { orNotFound } from "@/components/engineering/page-helpers";
import { contractorsLabel } from "@/lib/i18n/modules/contractors/labels";
import { getTranslations } from "@/lib/i18n/server";
import { CommandBar, type CommandSpec } from "@/components/engineering/record-dialogs";
import { SectionNav } from "@/components/engineering/section-nav";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { requireModule } from "@/lib/context/current-user";
import { getContractor } from "@/lib/modules/contractors/contractor.service";
import { CONTRACTOR_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";

type Props = { children: React.ReactNode; params: Promise<{ contractorId: string }> };

/**
 * A contractor's workspace (PRD #46 §8, §164): its name and status, the counts
 * that matter — projects, work packages, open RFIs, submittals, compliance
 * alerts — and the tabs a reader's grants allow.
 */
export default async function ContractorLayout({ children, params }: Props) {
  const { contractorId } = await params;
  const context = await requireModule("contractors");
  const contractor = await orNotFound(getContractor(context, contractorId));
  const caps = contractor.capabilities;
  const t = await getTranslations("contractors");
  const noun = (key: "project" | "workPackage" | "openRfi" | "submittal" | "complianceAlert", count: number) => t(`nouns.${key}`, { count });
  const base = `/contractors/${contractor.id}`;
  const tabs = [
    { href: base, label: t("workspace.overview"), exact: true },
    { href: `${base}/projects`, label: t("workspace.projects"), count: contractor.activeProjects },
    ...(caps.canViewWorkPackages ? [{ href: `${base}/work-packages`, label: t("workspace.workPackages"), count: contractor.workPackages }] : []),
    ...(caps.canViewContracts ? [{ href: `${base}/contracts`, label: t("workspace.contracts") }] : []),
    ...(caps.canViewEngineering ? [{ href: `${base}/engineering`, label: t("workspace.engineering"), count: contractor.openRfis + contractor.openSubmittals }] : []),
    ...(caps.canViewCompliance ? [{ href: `${base}/compliance`, label: t("workspace.compliance"), count: contractor.complianceAlerts }] : []),
    ...(caps.canViewDocuments ? [{ href: `${base}/documents`, label: t("workspace.documents") }] : []),
    ...(caps.canViewContacts ? [{ href: `${base}/contacts`, label: t("workspace.contacts") }] : []),
    { href: `${base}/activity`, label: t("workspace.activity") },
  ];
  const commands: CommandSpec[] = [
    ...(caps.canOffboard ? [{ url: `/api/contractors/${contractor.id}/archive`, label: t("workspace.offboard"), variant: "ghost" as const, success: t("workspace.offboarded"), testId: "offboard-contractor", body: { status: "OFFBOARDED", expectedVersion: contractor.version }, reason: { title: t("workspace.offboardTitle", { name: contractor.legalName }), description: t("workspace.offboardDescription"), confirmLabel: t("workspace.offboard"), required: false } }] : []),
    ...(caps.canArchive ? [{ url: `/api/contractors/${contractor.id}/archive`, label: t("workspace.archive"), variant: "ghost" as const, success: t("workspace.archived"), testId: "archive-contractor", body: { status: "ARCHIVED", expectedVersion: contractor.version }, reason: { title: t("workspace.archiveTitle", { name: contractor.legalName }), description: t("workspace.archiveDescription"), confirmLabel: t("workspace.archive"), required: false } }] : []),
    ...(caps.canReactivate ? [{ url: `/api/contractors/${contractor.id}/reactivate`, label: t("workspace.reactivate"), variant: "secondary" as const, success: t("workspace.reactivated"), testId: "reactivate-contractor", body: { expectedVersion: contractor.version }, reason: { title: t("workspace.reactivateTitle", { name: contractor.legalName }), confirmLabel: t("workspace.reactivate"), extraFields: [{ name: "status", label: t("workspace.returnAs"), type: "select" as const, required: true, options: [{ value: "ACTIVE", label: contractorsLabel(t, "contractorStatus", "ACTIVE", "Active") }, { value: "PROSPECTIVE", label: contractorsLabel(t, "contractorStatus", "PROSPECTIVE", "Prospective") }] }] } }] : []),
  ];

  return (
    <div className="space-y-5" data-testid="contractor-workspace">
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: t("meta.contractors"), href: "/contractors" }, { label: contractor.legalName }]} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-page font-semibold tracking-tight text-fg">{contractor.legalName}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-table text-fg-muted">
              <ReviewBadge status={contractor.status} label={contractorsLabel(t, "contractorStatus", contractor.status, CONTRACTOR_STATUS_LABELS[contractor.status])} testId="contractor-status" />
              <span data-testid="contractor-counts">
                <span className="tabular-nums text-fg">{contractor.activeProjects}</span> {noun("project", contractor.activeProjects)} <span aria-hidden="true">•</span> <span className="tabular-nums text-fg">{contractor.workPackages}</span> {noun("workPackage", contractor.workPackages)} <span aria-hidden="true">•</span> <span className="tabular-nums text-fg">{contractor.openRfis}</span> {noun("openRfi", contractor.openRfis)} <span aria-hidden="true">•</span> <span className="tabular-nums text-fg">{contractor.openSubmittals}</span> {noun("submittal", contractor.openSubmittals)} <span aria-hidden="true">•</span>{" "}
                <span className={contractor.complianceAlerts ? "tabular-nums font-medium text-warning-strong" : "tabular-nums text-fg"}>{contractor.complianceAlerts}</span> {noun("complianceAlert", contractor.complianceAlerts)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {caps.canEdit ? (
              <EditContractorButton
                contractor={{ id: contractor.id, version: contractor.version, legalName: contractor.legalName, tradingName: contractor.tradingName, status: contractor.status, registrationNumber: contractor.registrationNumber, vatNumber: contractor.vatNumber, email: contractor.email, phone: contractor.phone, website: contractor.website, countryCode: contractor.countryCode, addressLine1: contractor.addressLine1, city: contractor.city, postalCode: contractor.postalCode, primaryContactName: contractor.primaryContactName, primaryContactEmail: contractor.primaryContactEmail, primaryContactPhone: contractor.primaryContactPhone, supplierId: contractor.supplier?.id ?? null, notes: contractor.notes }}
              />
            ) : null}
            <CommandBar commands={commands} />
          </div>
        </div>
      </div>
      <SectionNav items={tabs} label={t("workspace.sections")} testId="contractor-tabs" layout="tabs" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
