import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { CompleteWorkPackageButton, EditWorkPackageButton } from "@/components/contractors/contractor-dialogs";
import { RecordDocuments } from "@/components/documents/record-documents";
import { Due, Facts, Metric, MetricStrip, Panel, Person, Ref, ReviewBadge } from "@/components/engineering/engineering-ui";
import { LinksPanel } from "@/components/engineering/links-panel";
import { orNotFound } from "@/components/engineering/page-helpers";
import { CommandBar } from "@/components/engineering/record-dialogs";
import { RecordContextHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { requireModule } from "@/lib/context/current-user";
import { loadRecord } from "@/lib/core/records/record.registry";
import { WORK_PACKAGE_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";
import { listLinks, linkableTypesFor } from "@/lib/modules/engineering/engineering.links";
import { memberOptions } from "@/lib/modules/engineering/engineering.shared";
import { DISCIPLINE_LABELS, LINKABLE_TYPES } from "@/lib/modules/engineering/engineering.types";
import { getWorkPackage } from "@/lib/modules/work-packages/work-package.service";

type Params = { params: Promise<{ projectId: string; workPackageId: string }> };

export const metadata: Metadata = { title: "Work package" };

/**
 * One work package (PRD #46 §39, §40, §215, §308): contractor, contract,
 * dates and value in context, the engineering, quality and safety records
 * around it, its tasks and files. Completing it closes nothing else.
 */
export default async function WorkPackagePage({ params }: Params) {
  const { projectId, workPackageId } = await params;
  const context = await requireModule("contractors");
  const wp = await orNotFound(getWorkPackage(context, workPackageId));
  if (wp.project.id !== projectId) notFound();
  const [links, members, project] = await Promise.all([
    listLinks(context, "work_package", wp.id),
    wp.capabilities.canCreateTask ? memberOptions(context.companyId, projectId, "task.view") : Promise.resolve([]),
    loadRecord(context, "project", projectId),
  ]);
  const caps = wp.capabilities;
  const engineering = `/projects/${projectId}/engineering`;

  return (
    <div className="space-y-5" data-testid="work-package-detail">
      <RecordContextHeader breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: project?.label ?? wp.project.label, href: `/projects/${projectId}` }, { label: "Work packages", href: `/projects/${projectId}/work-packages` }, { label: wp.code }]} title={`${wp.code} · ${wp.name}`} actions={
        <div className="flex flex-wrap items-center gap-2">
          {caps.canEdit ? <EditWorkPackageButton projectId={projectId} workPackage={{ id: wp.id, version: wp.version, code: wp.code, name: wp.name, description: wp.description, discipline: wp.discipline, status: wp.status, contractorId: wp.contractor?.id ?? null, contractId: wp.contract?.id ?? null, responsibleMemberId: wp.responsible?.id ?? null, plannedStartDate: wp.plannedStartDate, plannedFinishDate: wp.plannedFinishDate, forecastStartDate: wp.forecastStartDate, forecastFinishDate: wp.forecastFinishDate, actualStartDate: wp.actualStartDate, value: wp.value?.amount ?? null, currency: wp.value?.currency ?? null }} /> : null}
          {caps.canComplete ? <CompleteWorkPackageButton workPackageId={wp.id} version={wp.version} /> : null}
          {caps.canArchive ? <CommandBar commands={[{ url: `/api/work-packages/${wp.id}/archive`, label: "Archive", variant: "ghost", success: "Work package archived.", body: { expectedVersion: wp.version }, confirm: { title: "Archive work package", description: "It stays on the record, out of the open lists.", confirmLabel: "Archive" } }]} /> : null}
        </div>
      } />
      <Link href={`/projects/${projectId}/contractors`} className="inline-flex items-center gap-1.5 text-table text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Project contractors
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <ReviewBadge status={wp.status} label={WORK_PACKAGE_STATUS_LABELS[wp.status]} testId="work-package-status" />
        {wp.discipline ? <span className="text-table text-fg-muted">{DISCIPLINE_LABELS[wp.discipline]}</span> : null}
        {wp.completedAt ? <span className="text-table text-fg-muted">Completed{wp.completedBy ? <> by <PersonLink memberId={wp.completedBy.id} name={wp.completedBy.name} /></> : null}</span> : null}
      </div>
      <MetricStrip className="xl:grid-cols-6">
        <Metric label="Open tasks" value={wp.counts.openTasks} />
        <Metric label="Open RFIs" value={wp.counts.openRfis} href={`${engineering}/rfis?workPackageId=${wp.id}`} />
        <Metric label="Submittals" value={wp.counts.submittals} href={`${engineering}/submittals?workPackageId=${wp.id}`} />
        <Metric label="Engineering docs" value={wp.counts.engineeringDocuments} href={`${engineering}/documents?workPackageId=${wp.id}`} />
        <Metric label="QA/QC records" value={wp.counts.qaqc} />
        <Metric label="HSE records" value={wp.counts.hse} />
      </MetricStrip>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          {wp.description ? (
            <Panel title="Scope">
              <p className="whitespace-pre-wrap text-body text-fg">{wp.description}</p>
            </Panel>
          ) : null}
          <LinksPanel apiBase={`/api/work-packages/${wp.id}`} links={links} types={linkableTypesFor(context, LINKABLE_TYPES)} canLink={caps.canLink} canCreateTask={caps.canCreateTask} assignees={members} description="Tasks, meetings, daily logs, QA/QC and HSE records, purchase orders and contract obligations for this scope." />
          {caps.canViewFiles ? (
            <Panel title="Files">
              <RecordDocuments context={context} entityType="work_package" entityId={wp.id} canAttach={caps.canUploadFiles} emptyTitle="No files yet." emptyDescription="Scope documents, programmes and correspondence for this work package." />
            </Panel>
          ) : null}
          <CollaborationPanel parentType="work_package" parentId={wp.id} />
        </div>
        <aside className="min-w-0 space-y-5">
          <Panel title="Details">
            <Facts
              columns={2}
              items={[
                { label: "Contractor", value: <Ref value={wp.contractor} /> },
                { label: "Contract", value: <Ref value={wp.contract} /> },
                { label: "Responsible", value: <Person value={wp.responsible} fallback="—" /> },
                wp.value && { label: "Value", value: <span className="tabular-nums">{Number(wp.value.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })} {wp.value.currency ?? ""}</span> },
              ]}
            />
          </Panel>
          <Panel title="Dates">
            <Facts
              columns={2}
              items={[
                { label: "Planned start", value: <Due date={wp.plannedStartDate} /> },
                { label: "Planned finish", value: <Due date={wp.plannedFinishDate} /> },
                { label: "Forecast start", value: <Due date={wp.forecastStartDate} /> },
                { label: "Forecast finish", value: <Due date={wp.forecastFinishDate} /> },
                { label: "Actual start", value: <Due date={wp.actualStartDate} /> },
                { label: "Actual finish", value: <Due date={wp.actualFinishDate} /> },
              ]}
            />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
