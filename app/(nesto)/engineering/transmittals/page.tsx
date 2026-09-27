import type { Metadata } from "next";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { flat, keepPageInRange, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
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
  const params = await searchParams;
  const query = transmittalListSchema.parse({ ...flat(params) });
  const result = await listTransmittals(context, query);
  // Every matching record is reachable: a count and pages, never a silent cut at the page size;
  // a page past the end moves once to the last real page (AUD-08 §4, DT-05).
  keepPageInRange("/engineering/transmittals", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="transmittals" title="Transmittals" description="Formal issues of documents across your projects.">
      <div className="space-y-4">
        <ListToolbar searchPlaceholder="Search number or title…" searchParam="q" filters={[{ param: "status", label: "Status", options: TRANSMITTAL_STATUSES.map((value) => ({ value, label: TRANSMITTAL_STATUS_LABELS[value] })) }]} />
        <TransmittalRegister items={result.items} showProject />
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/engineering/transmittals", params, page)} />
      </div>
    </ModulePage>
  );
}
