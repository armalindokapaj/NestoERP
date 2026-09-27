import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { engineeringLabel } from "@/lib/i18n/modules/engineering/labels";
import Link from "@/components/navigation/nav-link";
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

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("engineering"))("submittalPage.metaTitle") };
}

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
  const t = await getTranslations("engineering");
  const number = { number: item.submittalNumber };
  const material = item.submittalType === "MATERIAL_SUBMITTAL" || item.submittalType === "PRODUCT_DATA" || item.submittalType === "SAMPLE";
  const method = item.submittalType === "METHOD_STATEMENT";
  const register = method ? "method-statements" : material ? "material-submittals" : "submittals";
  const commands: CommandSpec[] = [
    ...(caps.canClose ? [{ url: `/api/submittals/${item.id}/close`, label: t("submittalPage.closeOut"), success: t("submittalPage.closed", number), variant: "secondary" as const, testId: "close-submittal", confirm: { title: t("submittalPage.closeTitle", number), description: t("submittalPage.closeBody"), confirmLabel: t("submittalPage.closeOut") } }] : []),
    ...(caps.canVoid ? [{ url: `/api/submittals/${item.id}/void`, label: t("submittalPage.void"), success: t("submittalPage.voided", number), variant: "ghost" as const, testId: "void-submittal", reason: { title: t("submittalPage.voidTitle", number), confirmLabel: t("submittalPage.voidConfirm") } }] : []),
  ];

  return (
    <div className="space-y-5" data-testid="submittal-detail">
      <div className="space-y-3">
        <Link href={`/projects/${projectId}/engineering/${register}`} className="inline-flex items-center gap-1.5 text-table text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {method ? t("project.methodStatements") : material ? t("project.materialSubmittals") : t("project.submittals")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-table text-fg-muted" data-testid="submittal-number">
              {item.submittalNumber}
              {item.currentRevision ? <span className="ml-2 text-fg">{t("ui.rev", { code: item.currentRevision.code })}</span> : null}
            </p>
            <h2 className="mt-1 text-page font-semibold tracking-tight text-fg">{item.title}</h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <ReviewBadge status={item.status} testId="submittal-status" />
              {item.overdue ? <ReviewBadge status="OVERDUE" label={t("ui.reviewOverdue")} testId="submittal-overdue" /> : null}
              <Badge tone="default">{engineeringLabel(t, "submittalType", item.submittalType, SUBMITTAL_TYPE_LABELS[item.submittalType])}</Badge>
              {item.discipline ? <Badge tone="default">{engineeringLabel(t, "discipline", item.discipline, DISCIPLINE_LABELS[item.discipline])}</Badge> : null}
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
        {item.status === "VOID" ? <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">{t("ui.void")}{item.voidReason ? ` · ${item.voidReason}` : ""}</p> : null}
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
            description={method ? t("submittalPage.methodLinks") : material ? t("submittalPage.materialLinks") : undefined}
          />
          {caps.canViewFiles ? (
            <Panel title={t("details.files")} description={t("submittalPage.filesBody")}>
              <RecordDocuments context={context} entityType="technical_submittal" entityId={item.id} canAttach={caps.canUploadFiles} emptyTitle={t("details.noFilesYet")} emptyDescription={t("details.uploadFromRevisions")} />
            </Panel>
          ) : null}
          <CollaborationPanel parentType="technical_submittal" parentId={item.id} />
        </div>
        <aside className="min-w-0 space-y-5">
          <Panel title={t("details.details")}>
            <Facts
              columns={2}
              items={[
                { label: t("details.reviewer"), value: <Person value={item.reviewer} /> },
                { label: t("details.reviewDue"), value: <Due date={item.dueAt} overdue={item.overdue} /> },
                { label: t("details.contractor"), value: <Ref value={item.contractor} /> },
                { label: t("details.workPackage"), value: <Ref value={item.workPackage} /> },
                { label: t("details.specification"), value: item.specificationReference },
                material && { label: t("details.manufacturer"), value: item.manufacturer },
                material && { label: t("details.product"), value: [item.productName, item.modelNumber].filter(Boolean).join(" · ") || null },
                material && { label: t("details.supplier"), value: <Ref value={item.supplier} /> },
                method && { label: t("details.activity"), value: item.activity },
                method && { label: t("details.workArea"), value: item.workArea },
              ]}
            />
            {item.description ? <p className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-table text-fg-muted">{item.description}</p> : null}
          </Panel>
          {item.linkedRfis.length ? (
            <Panel title={t("submittalPage.referencedByRfis")}>
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
