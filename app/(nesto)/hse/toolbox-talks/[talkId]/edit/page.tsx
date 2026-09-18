import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ToolboxForm } from "@/components/hse/toolbox-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateToolboxTalkAction } from "@/lib/actions/hse";
import { WORKER_PREFIX } from "@/lib/modules/hse/hse.schema";
import * as toolbox from "@/lib/modules/hse/toolbox/toolbox.service";

export const metadata: Metadata = { title: "Edit toolbox talk" };

type Params = { params: Promise<{ talkId: string }> };

export default async function EditToolboxTalkPage({ params }: Params) {
  const { talkId } = await params;
  const context = await requireModule("hse");
  if (!can(context, "hse.toolbox.update")) notFound();

  let talk;
  try {
    talk = await toolbox.getToolboxTalk(context, talkId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!talk.capabilities.canEdit) notFound();

  const options = await toolbox.toolboxFormOptions(context);
  const update = updateToolboxTalkAction.bind(null, talkId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Toolbox talks", href: "/hse/toolbox-talks" },
          { label: talk.talkNumber, href: `/hse/toolbox-talks/${talkId}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit {talk.talkNumber}</h1>
      </div>

      <ToolboxForm
        action={update}
        cancelHref={`/hse/toolbox-talks/${talkId}`}
        submitLabel="Save talk"
        pendingLabel="Saving…"
        versionUpdatedAt={talk.updatedAt}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        workers={options.workers.map((worker) => ({ value: `${WORKER_PREFIX}${worker.id}`, label: worker.name }))}
        values={{
          title: talk.title,
          topic: talk.topic,
          projectId: talk.project?.id ?? "",
          talkDate: talk.talkDate.slice(0, 10),
          locationText: talk.locationText ?? "",
          conductedByMemberId: talk.conductedBy?.memberId ?? "",
          notes: talk.notes ?? "",
          participants: talk.participants.map((participant) => ({
            companyMemberId: participant.member?.memberId ?? (participant.worker ? `${WORKER_PREFIX}${participant.worker.employeeId}` : ""),
            externalName: participant.externalName ?? "",
            attendanceStatus: participant.attendanceStatus,
            signatureRecorded: participant.signatureRecorded,
          })),
        }}
      />
    </div>
  );
}
