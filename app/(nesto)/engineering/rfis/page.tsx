import type { Metadata } from "next";

import { ListToolbar } from "@/components/data/list-toolbar";
import { flat, type SearchParams } from "@/components/engineering/page-helpers";
import { RfiRegister } from "@/components/engineering/registers";
import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listRfis } from "@/lib/modules/engineering/engineering.rfis";
import { rfiListSchema } from "@/lib/modules/engineering/engineering.schema";
import { RFI_STATUSES, RFI_STATUS_LABELS } from "@/lib/modules/engineering/engineering.types";

export const metadata: Metadata = { title: "RFIs" };

/** Requests for information across every project you can open. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const result = await listRfis(context, rfiListSchema.parse({ ...flat(await searchParams) }));
  return (
    <ModulePage experience={experience} activeSection="rfis" title="RFIs" description="Requests for information across every project you can open.">
      <div className="space-y-4">
        <ListToolbar searchPlaceholder="Search number or title…" searchParam="q" filters={[{ param: "status", label: "Status", options: RFI_STATUSES.map((value) => ({ value, label: RFI_STATUS_LABELS[value] })) }, { param: "assignee", label: "Assignee", options: [{ value: "me", label: "Assigned to me" }] }, { param: "overdue", label: "Due", options: [{ value: "1", label: "Overdue" }] }]} />
        <RfiRegister items={result.items} showProject />
      </div>
    </ModulePage>
  );
}
