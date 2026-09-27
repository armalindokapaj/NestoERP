import Link from "@/components/navigation/nav-link";
import { Building2, HardHat, Package } from "lucide-react";

import { Due, Person, Ref, ReviewBadge } from "@/components/engineering/engineering-ui";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { ASSIGNMENT_STATUS_LABELS, CONTRACTOR_STATUS_LABELS, WORK_PACKAGE_STATUS_LABELS, type AssignmentDTO, type ContractorListItemDTO, type WorkPackageRowDTO } from "@/lib/modules/contractors/contractor.types";
import { DISCIPLINE_LABELS } from "@/lib/modules/engineering/engineering.types";
import { cn } from "@/lib/utils/cn";
import { EditAssignmentButton } from "./contractor-dialogs";
import { CommandBar } from "@/components/engineering/record-dialogs";
import { contractorsLabel } from "@/lib/i18n/modules/contractors/labels";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Contractor registers (PRD #46 §161, §163): the directory, a project's
 * assignments and work packages. Counts read as numbers, alerts in amber and
 * red, and every name opens its record.
 */

function Count({ value, tone }: { value: number; tone?: "warning" | "danger" }) {
  return <span className={cn("tabular-nums", value === 0 ? "text-fg-subtle" : tone === "danger" ? "font-medium text-danger-strong" : tone === "warning" ? "font-medium text-warning-strong" : "text-fg")}>{value}</span>;
}

export async function ContractorTable({ items, canCreate = false }: { items: ContractorListItemDTO[]; canCreate?: boolean }) {
  const t = await getTranslations("contractors");
  const status = (value: ContractorListItemDTO["status"]) => contractorsLabel(t, "contractorStatus", value, CONTRACTOR_STATUS_LABELS[value]);
  const supplierLine = (row: ContractorListItemDTO) => [row.tradingName, row.city, row.countryCode, row.supplier ? t("tables.supplier", { name: row.supplier.label }) : null].filter(Boolean).join(" · ") || "—";
  // First run: the purpose, and "add" only to someone who may (AUD-05 §6, UX-11, UX-15).
  if (!items.length)
    return (
      <EmptyState
        icon={<Building2 />}
        title={t("tables.noContractors")}
        description={canCreate ? t("tables.noContractorsCreate") : t("tables.noContractorsView")}
      />
    );
  return (
    <>
      <div className="hidden md:block">
        <Table label={t("tables.contractors")}>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col">{t("tables.contractor")}</TableHeaderCell>
              <TableHeaderCell scope="col">{t("tables.status")}</TableHeaderCell>
              <TableHeaderCell scope="col" className="text-right">
                {t("tables.activeProjects")}
              </TableHeaderCell>
              <TableHeaderCell scope="col" className="text-right">
                {t("tables.workPackages")}
              </TableHeaderCell>
              <TableHeaderCell scope="col" className="text-right">
                {t("tables.openRfis")}
              </TableHeaderCell>
              <TableHeaderCell scope="col" className="text-right">
                {t("tables.submittals")}
              </TableHeaderCell>
              <TableHeaderCell scope="col" className="text-right">
                {t("tables.compliance")}
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.id} data-testid="contractor-row">
                <TableCell className="min-w-[16rem]">
                  <Link href={row.href} className="font-medium text-fg hover:underline">
                    {row.legalName}
                  </Link>
                  <p className="text-meta text-fg-muted">{supplierLine(row)}</p>
                </TableCell>
                <TableCell>
                  <ReviewBadge status={row.status} label={status(row.status)} testId="contractor-status" />
                </TableCell>
                <TableCell className="text-right">
                  <Count value={row.activeProjects} />
                </TableCell>
                <TableCell className="text-right">
                  <Count value={row.workPackages} />
                </TableCell>
                <TableCell className="text-right">
                  <Count value={row.openRfis} />
                </TableCell>
                <TableCell className="text-right">
                  <Count value={row.openSubmittals} />
                </TableCell>
                <TableCell className="text-right" data-testid="contractor-compliance-alerts">
                  <Count value={row.complianceAlerts} tone="warning" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-2 md:hidden">
        {items.map((row) => (
          <li key={row.id}>
            <Link href={row.href} className="block rounded-lg border border-line bg-surface p-4" data-testid="contractor-card">
              {/* Everything the table row says, not a subset (AUD-04 §5, D-09-11, MW-05). */}
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-body font-medium text-fg [overflow-wrap:anywhere]">{row.legalName}</p>
                <ReviewBadge status={row.status} label={status(row.status)} />
              </div>
              <p className="mt-0.5 text-meta text-fg-muted [overflow-wrap:anywhere]">{supplierLine(row)}</p>
              <p className="mt-1 text-table text-fg-muted">
                {t("tables.contractorCounts", { projects: row.activeProjects, workPackages: row.workPackages, rfis: row.openRfis, submittals: row.openSubmittals, alerts: row.complianceAlerts })}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export async function AssignmentTable({ items, view }: { items: AssignmentDTO[]; view: "project" | "contractor" }) {
  const t = await getTranslations("contractors");
  if (!items.length) return <EmptyState icon={<HardHat />} title={view === "project" ? t("tables.noOnProject") : t("tables.notAssigned")} description={view === "project" ? t("tables.noOnProjectDescription") : t("tables.notAssignedDescription")} />;
  const status = (value: AssignmentDTO["status"]) => contractorsLabel(t, "assignmentStatus", value, ASSIGNMENT_STATUS_LABELS[value]);
  /*
   * Phones get a card per assignment with its actions on the card; the
   * ten-column table (from md) had Edit and Terminate ~800px to the right
   * (AUD-04 §5, D-09-12, MW-05).
   */
  const manage = (row: AssignmentDTO) =>
    row.canManage ? (
      <div className="flex flex-wrap justify-end gap-1">
        <EditAssignmentButton projectId={row.project.id} subject={view === "project" ? row.contractor.label : row.project.label} assignment={{ id: row.id, contractorId: row.contractor.id, version: row.version, status: row.status, scopeSummary: row.scopeSummary, contractId: row.contract?.id ?? null, internalManagerMemberId: row.internalManager?.id ?? null, primaryContractorContactId: row.primaryContact?.id ?? null, startDate: row.startDate, endDate: row.endDate }} />
        <CommandBar
          className="flex"
          commands={[{ url: `/api/project-contractor-assignments/${row.id}/terminate`, label: t("tables.terminate"), variant: "ghost", success: t("tables.terminated"), testId: "terminate-assignment", body: { expectedVersion: row.version }, reason: { title: t("tables.terminateTitle", { contractor: row.contractor.label, project: row.project.label }), description: t("tables.terminateDescription"), confirmLabel: t("tables.terminate"), extraFields: [{ name: "endDate", label: t("tables.endDate"), type: "date" }] } }]}
        />
      </div>
    ) : null;
  return (
    <>
    <ul className="space-y-2 md:hidden" aria-label={t("tables.assignments")}>
      {items.map((row) => (
        <li key={row.id} className={cn("space-y-1.5 rounded-lg border border-line bg-surface p-4", row.status === "TERMINATED" && "opacity-70")} data-testid="assignment-card">
          <div className="flex items-start justify-between gap-3">
            <Link href={view === "project" ? row.contractor.href : `/projects/${row.project.id}/contractors`} className="inline-flex min-w-0 items-center font-medium text-fg [overflow-wrap:anywhere] hover:underline touch:min-h-11">
              {view === "project" ? row.contractor.label : row.project.label}
            </Link>
            <ReviewBadge status={row.status} label={status(row.status)} />
          </div>
          {row.primaryContact ? <p className="text-meta text-fg-muted">{row.primaryContact.name}</p> : null}
          {row.terminationReason ? <p className="text-meta text-fg-muted [overflow-wrap:anywhere]">{row.terminationReason}</p> : null}
          {row.scopeSummary ? <p className="line-clamp-3 text-table text-fg-muted [overflow-wrap:anywhere]">{row.scopeSummary}</p> : null}
          <p className="text-meta text-fg-muted [overflow-wrap:anywhere]">
            {row.contract ? <Link href={row.contract.href} className="font-mono underline-offset-4 hover:underline">{row.contract.label.split(" · ")[0]}</Link> : t("tables.noContract")}
            {` · ${t("tables.manager")}`}
            {row.internalManager ? row.internalManager.name : "—"}
          </p>
          <p className="text-table text-fg-muted">
            {t("tables.assignmentCounts", { workPackages: row.workPackages, rfis: row.openRfis, submittals: row.openSubmittals, alerts: row.complianceAlerts })}
          </p>
          {manage(row)}
        </li>
      ))}
    </ul>
    <div className="hidden md:block">
    <Table label={t("tables.assignments")}>
      <TableHead>
        <TableRow>
          <TableHeaderCell scope="col">{view === "project" ? t("tables.contractor") : t("tables.project")}</TableHeaderCell>
          <TableHeaderCell scope="col">{t("tables.status")}</TableHeaderCell>
          <TableHeaderCell scope="col">{t("tables.scope")}</TableHeaderCell>
          <TableHeaderCell scope="col">{t("tables.contract")}</TableHeaderCell>
          <TableHeaderCell scope="col">{t("tables.managerHeader")}</TableHeaderCell>
          <TableHeaderCell scope="col" className="text-right">
            {t("tables.workPackages")}
          </TableHeaderCell>
          <TableHeaderCell scope="col" className="text-right">
            {t("tables.openRfis")}
          </TableHeaderCell>
          <TableHeaderCell scope="col" className="text-right">
            {t("tables.submittals")}
          </TableHeaderCell>
          <TableHeaderCell scope="col" className="text-right">
            {t("tables.compliance")}
          </TableHeaderCell>
          <TableHeaderCell scope="col">
            <span className="sr-only">{t("tables.actions")}</span>
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((row) => (
          <TableRow key={row.id} data-testid="assignment-row" className={row.status === "TERMINATED" ? "opacity-70" : undefined}>
            <TableCell className="min-w-[12rem]">
              {view === "project" ? (
                <Link href={row.contractor.href} className="font-medium text-fg hover:underline">
                  {row.contractor.label}
                </Link>
              ) : (
                <Link href={`/projects/${row.project.id}/contractors`} className="font-medium text-fg hover:underline">
                  {row.project.label}
                </Link>
              )}
              {row.primaryContact ? <p className="text-meta text-fg-muted">{row.primaryContact.name}</p> : null}
            </TableCell>
            <TableCell>
              <ReviewBadge status={row.status} label={status(row.status)} testId="assignment-status" />
              {row.terminationReason ? (
                <p className="mt-1 line-clamp-2 max-w-[12rem] text-meta text-fg-muted" title={row.terminationReason}>
                  {row.terminationReason}
                </p>
              ) : null}
            </TableCell>
            <TableCell className="min-w-[12rem] max-w-[18rem] text-fg-muted">
              <span className="line-clamp-2" title={row.scopeSummary ?? undefined}>
                {row.scopeSummary ?? "—"}
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {row.contract ? (
                <Link href={row.contract.href} title={row.contract.label} className="font-mono text-table text-fg underline-offset-4 hover:underline">
                  {row.contract.label.split(" · ")[0]}
                </Link>
              ) : (
                <Ref value={null} />
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <Person value={row.internalManager} fallback="—" />
            </TableCell>
            <TableCell className="text-right">
              <Count value={row.workPackages} />
            </TableCell>
            <TableCell className="text-right">
              <Count value={row.openRfis} />
            </TableCell>
            <TableCell className="text-right">
              <Count value={row.openSubmittals} />
            </TableCell>
            <TableCell className="text-right">
              <Count value={row.complianceAlerts} tone="warning" />
            </TableCell>
            <TableCell className="text-right">{manage(row)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>
    </>
  );
}

export async function WorkPackageTable({ items, showProject = false, emptyText }: { items: WorkPackageRowDTO[]; showProject?: boolean; emptyText?: string }) {
  const t = await getTranslations("contractors");
  if (!items.length) return <EmptyState icon={<Package />} title={emptyText ?? t("tables.noWorkPackages")} description={t("tables.workPackageDescription")} />;
  const status = (value: WorkPackageRowDTO["status"]) => contractorsLabel(t, "workPackageStatus", value, WORK_PACKAGE_STATUS_LABELS[value]);
  const discipline = (value: NonNullable<WorkPackageRowDTO["discipline"]>) => contractorsLabel(t, "discipline", value, DISCIPLINE_LABELS[value]);
  return (
    <>
    {/* A card per work package on a phone, every column's value on it (AUD-04 §5, D-09-12, MW-05). */}
    <ul className="space-y-2 md:hidden" aria-label={t("tables.workPackages")}>
      {items.map((row) => (
        <li key={row.id}>
          <Link href={row.href} className="block space-y-1 rounded-lg border border-line bg-surface p-4" data-testid="work-package-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-meta text-fg-muted [overflow-wrap:anywhere]">{row.code}</p>
                <p className="text-body font-medium text-fg [overflow-wrap:anywhere]">{row.name}</p>
              </div>
              <ReviewBadge status={row.status} label={status(row.status)} />
            </div>
            <p className="text-meta text-fg-muted [overflow-wrap:anywhere]">
              {[showProject ? row.project.label : null, row.discipline ? discipline(row.discipline) : null, row.contractor?.label ?? null, row.responsible ? t("tables.responsible", { name: row.responsible.name }) : null].filter(Boolean).join(" · ") || "—"}
            </p>
            <p className="text-table text-fg-muted">
              {t("tables.finish")} <Due date={row.actualFinishDate ?? row.forecastFinishDate ?? row.plannedFinishDate} />
              {t("tables.workPackageCounts", { tasks: row.counts.openTasks, rfis: row.counts.openRfis, submittals: row.counts.submittals })}
            </p>
          </Link>
        </li>
      ))}
    </ul>
    <div className="hidden md:block">
    <Table label={t("tables.workPackages")}>
      <TableHead>
        <TableRow>
          <TableHeaderCell scope="col">{t("tables.code")}</TableHeaderCell>
          <TableHeaderCell scope="col">{t("tables.workPackage")}</TableHeaderCell>
          {showProject ? <TableHeaderCell scope="col">{t("tables.project")}</TableHeaderCell> : null}
          <TableHeaderCell scope="col">{t("tables.contractor")}</TableHeaderCell>
          <TableHeaderCell scope="col">{t("tables.status")}</TableHeaderCell>
          <TableHeaderCell scope="col">{t("tables.finish")}</TableHeaderCell>
          <TableHeaderCell scope="col">{t("tables.responsibleHeader")}</TableHeaderCell>
          <TableHeaderCell scope="col" className="text-right">
            {t("tables.tasks")}
          </TableHeaderCell>
          <TableHeaderCell scope="col" className="text-right">
            {t("tables.rfis")}
          </TableHeaderCell>
          <TableHeaderCell scope="col" className="text-right">
            {t("tables.submittals")}
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((row) => (
          <TableRow key={row.id} data-testid="work-package-row">
            <TableCell className="whitespace-nowrap font-mono text-table">
              <Link href={row.href} className="hover:underline">
                {row.code}
              </Link>
            </TableCell>
            <TableCell className="min-w-[14rem]">
              <Link href={row.href} className="font-medium text-fg hover:underline">
                {row.name}
              </Link>
              {row.discipline ? <p className="text-meta text-fg-muted">{discipline(row.discipline)}</p> : null}
            </TableCell>
            {showProject ? <TableCell className="text-fg-muted">{row.project.label}</TableCell> : null}
            <TableCell>
              <Ref value={row.contractor} />
            </TableCell>
            <TableCell>
              <ReviewBadge status={row.status} label={status(row.status)} testId="work-package-status" />
            </TableCell>
            <TableCell>
              <Due date={row.actualFinishDate ?? row.forecastFinishDate ?? row.plannedFinishDate} />
            </TableCell>
            <TableCell>
              <Person value={row.responsible} fallback="—" />
            </TableCell>
            <TableCell className="text-right">
              <Count value={row.counts.openTasks} />
            </TableCell>
            <TableCell className="text-right">
              <Count value={row.counts.openRfis} />
            </TableCell>
            <TableCell className="text-right">
              <Count value={row.counts.submittals} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>
    </>
  );
}
