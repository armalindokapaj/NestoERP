import { EditContractorButton } from "@/components/contractors/contractor-dialogs";
import { ReviewBadge } from "@/components/engineering/engineering-ui";
import { counted, orNotFound } from "@/components/engineering/page-helpers";
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
  const base = `/contractors/${contractor.id}`;
  const tabs = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/projects`, label: "Projects", count: contractor.activeProjects },
    ...(caps.canViewWorkPackages ? [{ href: `${base}/work-packages`, label: "Work packages", count: contractor.workPackages }] : []),
    ...(caps.canViewContracts ? [{ href: `${base}/contracts`, label: "Contracts" }] : []),
    ...(caps.canViewEngineering ? [{ href: `${base}/engineering`, label: "Engineering", count: contractor.openRfis + contractor.openSubmittals }] : []),
    ...(caps.canViewCompliance ? [{ href: `${base}/compliance`, label: "Compliance", count: contractor.complianceAlerts }] : []),
    ...(caps.canViewDocuments ? [{ href: `${base}/documents`, label: "Documents" }] : []),
    ...(caps.canViewContacts ? [{ href: `${base}/contacts`, label: "Contacts" }] : []),
    { href: `${base}/activity`, label: "Activity" },
  ];
  const commands: CommandSpec[] = [
    ...(caps.canOffboard ? [{ url: `/api/contractors/${contractor.id}/archive`, label: "Offboard", variant: "ghost" as const, success: "Contractor offboarded.", testId: "offboard-contractor", body: { status: "OFFBOARDED", expectedVersion: contractor.version }, reason: { title: `Offboard ${contractor.legalName}`, description: "It stays in the directory with its history; it takes no new projects until reactivated.", confirmLabel: "Offboard", required: false } }] : []),
    ...(caps.canArchive ? [{ url: `/api/contractors/${contractor.id}/archive`, label: "Archive", variant: "ghost" as const, success: "Contractor archived.", testId: "archive-contractor", body: { status: "ARCHIVED", expectedVersion: contractor.version }, reason: { title: `Archive ${contractor.legalName}`, description: "Historical records stay; nothing is deleted.", confirmLabel: "Archive", required: false } }] : []),
    ...(caps.canReactivate ? [{ url: `/api/contractors/${contractor.id}/reactivate`, label: "Reactivate", variant: "secondary" as const, success: "Contractor reactivated.", testId: "reactivate-contractor", body: { expectedVersion: contractor.version }, reason: { title: `Reactivate ${contractor.legalName}`, confirmLabel: "Reactivate", extraFields: [{ name: "status", label: "Return as", type: "select" as const, required: true, options: [{ value: "ACTIVE", label: "Active" }, { value: "PROSPECTIVE", label: "Prospective" }] }] } }] : []),
  ];

  return (
    <div className="space-y-5" data-testid="contractor-workspace">
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Contractors", href: "/contractors" }, { label: contractor.legalName }]} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-page font-semibold tracking-tight text-fg">{contractor.legalName}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-table text-fg-muted">
              <ReviewBadge status={contractor.status} label={CONTRACTOR_STATUS_LABELS[contractor.status]} testId="contractor-status" />
              <span data-testid="contractor-counts">
                <span className="tabular-nums text-fg">{contractor.activeProjects}</span> {counted(contractor.activeProjects, "project")} <span aria-hidden="true">•</span> <span className="tabular-nums text-fg">{contractor.workPackages}</span> {counted(contractor.workPackages, "work package")} <span aria-hidden="true">•</span> <span className="tabular-nums text-fg">{contractor.openRfis}</span> open {counted(contractor.openRfis, "RFI")} <span aria-hidden="true">•</span> <span className="tabular-nums text-fg">{contractor.openSubmittals}</span> {counted(contractor.openSubmittals, "submittal")} <span aria-hidden="true">•</span>{" "}
                <span className={contractor.complianceAlerts ? "tabular-nums font-medium text-warning-strong" : "tabular-nums text-fg"}>{contractor.complianceAlerts}</span> {counted(contractor.complianceAlerts, "compliance alert")}
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
      <SectionNav items={tabs} label="Contractor sections" testId="contractor-tabs" layout="tabs" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
