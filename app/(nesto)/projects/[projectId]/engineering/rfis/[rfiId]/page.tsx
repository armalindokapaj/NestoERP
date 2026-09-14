import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RecordDocuments } from "@/components/documents/record-documents";
import { Due, Facts, formatDateTime, Panel, Person, PriorityMark, Ref, ReviewBadge } from "@/components/engineering/engineering-ui";
import { orNotFound } from "@/components/engineering/page-helpers";
import { CommandBar, EditRfiButton, type CommandSpec } from "@/components/engineering/record-dialogs";
import { RfiWorkspace } from "@/components/engineering/rfi-workspace";
import { requireModule } from "@/lib/context/current-user";
import { projectEngineeringOptions } from "@/lib/modules/engineering/engineering.documents";
import { getRfi } from "@/lib/modules/engineering/engineering.rfis";
import { resolveEngineeringSettings } from "@/lib/modules/engineering/engineering.settings";
import { DISCIPLINE_LABELS } from "@/lib/modules/engineering/engineering.types";

type Params = { params: Promise<{ projectId: string; rfiId: string }> };

export const metadata: Metadata = { title: "RFI" };

/**
 * One RFI (PRD #46 §82-§97, §309, §313): the question and its thread beside
 * the facts that frame it, with the step that comes next — open, answer,
 * clarify, close — and void for a mistake.
 */
export default async function RfiPage({ params }: Params) {
  const { projectId, rfiId } = await params;
  const context = await requireModule("engineering");
  const rfi = await orNotFound(getRfi(context, rfiId));
  if (rfi.projectId !== projectId) notFound();
  const [settings, options] = await Promise.all([resolveEngineeringSettings(context.companyId), rfi.capabilities.canCreateTask ? projectEngineeringOptions(context, projectId, "rfi.respond") : null]);
  const caps = rfi.capabilities;
  const commands: CommandSpec[] = [
    ...(caps.canOpen ? [{ url: `/api/rfis/${rfi.id}/open`, label: "Open RFI", success: `RFI ${rfi.rfiNumber} opened.`, variant: "primary" as const, testId: "open-rfi", body: { expectedVersion: rfi.version } }] : []),
    ...(caps.canClose ? [{ url: `/api/rfis/${rfi.id}/close`, label: "Close RFI", success: `RFI ${rfi.rfiNumber} closed.`, variant: "primary" as const, testId: "close-rfi", reason: { title: `Close RFI ${rfi.rfiNumber}`, description: "The answer is accepted. A closed RFI is kept as it stands.", confirmLabel: "Close RFI", label: "Closing note", name: "note", required: false } }] : []),
    ...(caps.canVoid ? [{ url: `/api/rfis/${rfi.id}/void`, label: "Void", success: `RFI ${rfi.rfiNumber} voided.`, variant: "ghost" as const, testId: "void-rfi", reason: { title: `Void RFI ${rfi.rfiNumber}`, description: "For an RFI raised in error. It stays on the register, marked void.", confirmLabel: "Void RFI" } }] : []),
  ];

  return (
    <div className="space-y-5" data-testid="rfi-detail">
      <div className="space-y-3">
        <Link href={`/projects/${projectId}/engineering/rfis`} className="inline-flex items-center gap-1.5 text-table text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="size-4" />
          RFIs
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-table text-fg-muted" data-testid="rfi-number">
              {rfi.rfiNumber}
            </p>
            <h2 className="mt-1 text-page font-semibold tracking-tight text-fg">{rfi.subject}</h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <ReviewBadge status={rfi.status} testId="rfi-status" />
              {rfi.overdue ? <ReviewBadge status="OVERDUE" label="Overdue" testId="rfi-overdue" /> : null}
              <PriorityMark priority={rfi.priority} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {caps.canEdit ? <EditRfiButton projectId={projectId} rfi={{ id: rfi.id, status: rfi.status, version: rfi.version, subject: rfi.subject, question: rfi.question, priority: rfi.priority, discipline: rfi.discipline, assignedToMemberId: rfi.assignee?.id ?? null, dueAt: rfi.dueAt, contractorId: rfi.contractor?.id ?? null, workPackageId: rfi.workPackage?.id ?? null, raisedByText: rfi.raisedByText }} /> : null}
            <CommandBar commands={commands} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <RfiWorkspace rfi={rfi} zone={settings.timezone} assignees={options?.members ?? []} />
          {caps.canViewFiles ? (
            <Panel title="Files" description="Sketches, marked-up extracts and photographs for this RFI.">
              <RecordDocuments context={context} entityType="rfi" entityId={rfi.id} canAttach={caps.canUploadFiles} emptyTitle="No files attached." emptyDescription="Attach a sketch or marked-up drawing extract." />
            </Panel>
          ) : null}
          <CollaborationPanel parentType="rfi" parentId={rfi.id} />
        </div>
        <aside className="min-w-0 space-y-5">
          <Panel title="Details">
            <Facts
              columns={2}
              items={[
                { label: "Assignee", value: <Person value={rfi.assignee} /> },
                { label: "Due", value: <Due date={rfi.dueAt} overdue={rfi.overdue} /> },
                { label: "Discipline", value: rfi.discipline ? DISCIPLINE_LABELS[rfi.discipline] : null },
                { label: "Age", value: <span className="tabular-nums">{rfi.ageDays} days</span> },
                { label: "Contractor", value: <Ref value={rfi.contractor} /> },
                { label: "Work package", value: <Ref value={rfi.workPackage} /> },
                { label: "Raised by", value: rfi.raisedByText ?? rfi.raisedBy?.name },
                { label: "Answered", value: rfi.answeredAt ? formatDateTime(rfi.answeredAt, settings.timezone) : null },
              ]}
            />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
