import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ToolboxForm } from "@/components/hse/toolbox-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createToolboxTalkAction } from "@/lib/actions/hse";
import * as toolbox from "@/lib/modules/hse/toolbox/toolbox.service";

export const metadata: Metadata = { title: "Record a toolbox talk" };

/** A short safety briefing, and who was there (PRD #22 §136). */
export default async function NewToolboxTalkPage() {
  const context = await requireModule("hse");
  if (!can(context, "hse.toolbox.create")) notFound();

  const options = await toolbox.toolboxFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Toolbox talks", href: "/hse/toolbox-talks" },
          { label: "New" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Record a toolbox talk</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          What was covered and who was there. Not a training record — no course, no certificate.
        </p>
      </div>

      <ToolboxForm
        action={createToolboxTalkAction}
        cancelHref="/hse/toolbox-talks"
        submitLabel="Record talk"
        pendingLabel="Recording…"
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
      />
    </div>
  );
}
