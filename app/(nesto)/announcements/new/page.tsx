import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AnnouncementEditor } from "@/components/announcements/announcement-editor";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { announcementOptions } from "@/lib/modules/announcements/announcement.service";

export const metadata: Metadata = { title: "New announcement" };

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || "";

/** A new draft (PRD #45 §35, §36): from a project, the project is already chosen. */
export default async function NewAnnouncementPage({ searchParams }: Params) {
  const context = await requireModule("announcements");
  if (!can(context, "announcement.create")) redirect("/access-denied");
  const options = await announcementOptions(context);
  if (!options.audiences.length) redirect("/access-denied");
  const params = await searchParams;
  const projectId = one(params.projectId);
  const fromProject = Boolean(projectId && options.audiences.includes("PROJECT") && options.projects.some((project) => project.id === projectId));
  const audienceType = fromProject ? "PROJECT" : options.audiences.includes("COMPANY") ? "COMPANY" : options.audiences[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-page font-semibold tracking-tight text-fg">New announcement</h1>
        <p className="mt-1.5 text-body text-fg-muted">Saved as a draft until you publish or schedule it.</p>
      </header>
      <AnnouncementEditor
        mode="create"
        options={options}
        initial={{ title: "", body: "", priority: "NORMAL", audienceType, projectId: fromProject ? projectId : "", departmentId: "", selectedMemberIds: [], expiresAt: "", eventStartsAt: "", eventEndsAt: "", pinned: false, requiresAcknowledgment: false }}
      />
    </div>
  );
}
