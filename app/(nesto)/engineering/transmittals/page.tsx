import type { Metadata } from "next";

import { ListToolbar } from "@/components/data/list-toolbar";
import { flat, type SearchParams } from "@/components/engineering/page-helpers";
import { TransmittalRegister } from "@/components/engineering/registers";
import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listTransmittals } from "@/lib/modules/engineering/engineering.transmittals";
import { transmittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { TRANSMITTAL_STATUSES, TRANSMITTAL_STATUS_LABELS } from "@/lib/modules/engineering/engineering.types";

export const metadata: Metadata = { title: "Transmittals" };

/** Formal issues of documents across your projects. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const result = await listTransmittals(context, transmittalListSchema.parse({ ...flat(await searchParams) }));
  return (
    <ModulePage experience={experience} activeSection="transmittals" title="Transmittals" description="Formal issues of documents across your projects.">
      <div className="space-y-4">
        <ListToolbar searchPlaceholder="Search number or title…" searchParam="q" filters={[{ param: "status", label: "Status", options: TRANSMITTAL_STATUSES.map((value) => ({ value, label: TRANSMITTAL_STATUS_LABELS[value] })) }]} />
        <TransmittalRegister items={result.items} showProject />
      </div>
    </ModulePage>
  );
}
