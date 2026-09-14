import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RecordDocuments } from "@/components/documents/record-documents";
import { Due, Facts, Panel, Person, Ref, ReviewBadge } from "@/components/engineering/engineering-ui";
import { LinksPanel } from "@/components/engineering/links-panel";
import { orNotFound } from "@/components/engineering/page-helpers";
import { CommandBar, EditSubmittalButton, type CommandSpec } from "@/components/engineering/record-dialogs";
import { RevisionPanel } from "@/components/engineering/revision-panel";
import { Badge } from "@/components/ui/badge";
import { requireModule } from "@/lib/context/current-user";
import { projectEngineeringOptions } from "@/lib/modules/engineering/engineering.documents";
import { linkableTypesFor } from "@/lib/modules/engineering/engineering.links";
import { resolveEngineeringSettings } from "@/lib/modules/engineering/engineering.settings";
import { getSubmittal } from "@/lib/modules/engineering/engineering.submittals";
import { DISCIPLINE_LABELS, LINKABLE_TYPES, SUBMITTAL_TYPE_LABELS } from "@/lib/modules/engineering/engineering.types";

type Params = { params: Promise<{ projectId: string; submittalId: string }> };

export const metadata: Metadata = { title: "Submittal" };

/**
 * One submittal (PRD #46 §98-§117, §310): its type's own details, every
 * revision with its review, what it links to — HSE and QA/QC records for a
 * method statement, the supplier and purchase order for a material — and its
 * files. Approval here changes nothing in Procurement, Inventory, HSE or QA/QC.
 */
export default async function SubmittalPage({ params }: Params) {
  const { projectId, submittalId } = await params;
  const context = await requireModule("engineering");
  const item = await orNotFound(getSubmittal(context, submittalId));
  if (item.projectId !== projectId) notFound();
  const [settings, options] = await Promise.all([resolveEngineeringSettings(context.companyId), item.capabilities.canCreateTask ? projectEngineeringOptions(context, projectId, "submittal.review") : null]);
  const caps = item.capabilities;
  const material = item.submittalType === "MATERIAL_SUBMITTAL" || item.submittalType === "PRODUCT_DATA" || item.submittalType === "SAMPLE";
  const method = item.submittalType === "METHOD_STATEMENT";
  const register = method ? "method-statements" : material ? "material-submittals" : "submittals";
  const commands: CommandSpec[] = [
    ...(caps.canClose ? [{ url: `/api/submittals/${item.id}/close`, label: "Close out", success: `${item.submittalNumber} closed.`, variant: "secondary" as const, testId: "close-submittal", confirm: { title: `Close ${item.submittalNumber}`, description: "Its review is final. A closed submittal takes no more revisions.", confirmLabel: "Close out" } }] : []),
    ...(caps.canVoid ? [{ url: `/api/submittals/${item.id}/void`, label: "Void", success: `${item.submittalNumber} voided.`, variant: "ghost" as const, testId: "void-submittal", reason: { title: `Void ${item.submittalNumber}`, confirmLabel: "Void submittal" } }] : []),
  ];

  return (
    <div className="space-y-5" data-testid="submittal-detail">
      <div className="space-y-3">
        <Link href={`/projects/${projectId}/engineering/${register}`} className="inline-flex items-center gap-1.5 text-table text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {method ? "Method statements" : material ? "Material submittals" : "Submittals"}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-table text-fg-muted" data-testid="submittal-number">
              {item.submittalNumber}
              {item.currentRevision ? <span className="ml-2 text-fg">Rev {item.currentRevision.code}</span> : null}
            </p>
            <h2 className="mt-1 text-page font-semibold tracking-tight text-fg">{item.title}</h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <ReviewBadge status={item.status} testId="submittal-status" />
              {item.overdue ? <ReviewBadge status="OVERDUE" label="Review overdue" testId="submittal-overdue" /> : null}
              <Badge tone="default">{SUBMITTAL_TYPE_LABELS[item.submittalType]}</Badge>
              {item.discipline ? <Badge tone="default">{DISCIPLINE_LABELS[item.discipline]}</Badge> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {caps.canEdit ? (
              <EditSubmittalButton
                projectId={projectId}
                submittal={{ id: item.id, version: item.version, title: item.title, description: item.description, submittalType: item.submittalType, discipline: item.discipline, contractorId: item.contractor?.id ?? null, workPackageId: item.workPackage?.id ?? null, assignedReviewerMemberId: item.reviewer?.id ?? null, dueAt: item.dueAt, specificationReference: item.specificationReference, manufacturer: item.manufacturer, productName: item.productName, modelNumber: item.modelNumber, supplierId: item.supplier?.id ?? null, activity: item.activity, workArea: item.workArea }}
              />
            ) : null}
            <CommandBar commands={commands} />
          </div>
        </div>
        {item.status === "VOID" ? <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">Void{item.voidReason ? ` · ${item.voidReason}` : ""}</p> : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <RevisionPanel kind="submittal" recordId={item.id} recordType="technical_submittal" revisions={item.revisions} capabilities={item.revisionCapabilities} canAddRevision={caps.canAddRevision} canUploadFiles={caps.canUploadFiles} zone={settings.timezone} />
          <LinksPanel
            apiBase={`/api/submittals/${item.id}`}
            links={item.links}
            types={linkableTypesFor(context, LINKABLE_TYPES)}
            canLink={caps.canLink}
            canCreateTask={caps.canCreateTask}
            assignees={options?.members ?? []}
            description={method ? "Risk assessments, permits, toolbox talks and inspection records this method statement relies on — each stays in its own module." : material ? "Drawings, purchase orders and inspections for this material. Approving it creates no order and no stock." : undefined}
          />
          {caps.canViewFiles ? (
            <Panel title="Files" description="Every file uploaded to this submittal. A file carried by a submitted revision is frozen.">
              <RecordDocuments context={context} entityType="technical_submittal" entityId={item.id} canAttach={caps.canUploadFiles} emptyTitle="No files yet." emptyDescription="Upload a revision's file from the revisions panel." />
            </Panel>
          ) : null}
          <CollaborationPanel parentType="technical_submittal" parentId={item.id} />
        </div>
        <aside className="min-w-0 space-y-5">
          <Panel title="Details">
            <Facts
              columns={2}
              items={[
                { label: "Reviewer", value: <Person value={item.reviewer} /> },
                { label: "Review due", value: <Due date={item.dueAt} overdue={item.overdue} /> },
                { label: "Contractor", value: <Ref value={item.contractor} /> },
                { label: "Work package", value: <Ref value={item.workPackage} /> },
                { label: "Specification", value: item.specificationReference },
                material && { label: "Manufacturer", value: item.manufacturer },
                material && { label: "Product", value: [item.productName, item.modelNumber].filter(Boolean).join(" · ") || null },
                material && { label: "Supplier", value: <Ref value={item.supplier} /> },
                method && { label: "Activity", value: item.activity },
                method && { label: "Work area", value: item.workArea },
              ]}
            />
            {item.description ? <p className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-table text-fg-muted">{item.description}</p> : null}
          </Panel>
          {item.linkedRfis.length ? (
            <Panel title="Referenced by RFIs">
              <ul className="space-y-1 text-table">
                {item.linkedRfis.map((rfi) => (
                  <li key={rfi.id}>
                    <Link href={rfi.href} className="text-fg underline-offset-4 hover:underline">
                      {rfi.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
