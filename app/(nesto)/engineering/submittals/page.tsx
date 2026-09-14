import type { Metadata } from "next";

import { ListToolbar } from "@/components/data/list-toolbar";
import { flat, type SearchParams } from "@/components/engineering/page-helpers";
import { SubmittalRegister } from "@/components/engineering/registers";
import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listSubmittals } from "@/lib/modules/engineering/engineering.submittals";
import { submittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { REVIEW_STATUS_LABELS, SUBMITTAL_STATUSES, SUBMITTAL_TYPES, SUBMITTAL_TYPE_LABELS } from "@/lib/modules/engineering/engineering.types";

export const metadata: Metadata = { title: "Submittals" };

/** Submittals, method statements and material submittals across your projects. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const result = await listSubmittals(context, submittalListSchema.parse({ ...flat(await searchParams) }));
  return (
    <ModulePage experience={experience} activeSection="submittals" title="Submittals" description="Submittals, method statements and material submittals across your projects.">
      <div className="space-y-4">
        <ListToolbar searchPlaceholder="Search number or title…" searchParam="q" filters={[{ param: "status", label: "Status", options: SUBMITTAL_STATUSES.map((value) => ({ value, label: REVIEW_STATUS_LABELS[value] })) }, { param: "type", label: "Type", options: SUBMITTAL_TYPES.map((value) => ({ value, label: SUBMITTAL_TYPE_LABELS[value] })) }, { param: "reviewer", label: "Reviewer", options: [{ value: "me", label: "Assigned to me" }] }]} />
        <SubmittalRegister items={result.items} showProject />
      </div>
    </ModulePage>
  );
}
