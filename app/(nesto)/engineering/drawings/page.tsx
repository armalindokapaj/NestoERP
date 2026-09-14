import type { Metadata } from "next";

import { ListToolbar } from "@/components/data/list-toolbar";
import { flat, type SearchParams } from "@/components/engineering/page-helpers";
import { DocumentRegister } from "@/components/engineering/registers";
import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listEngineeringDocuments } from "@/lib/modules/engineering/engineering.documents";
import { engineeringDocumentListSchema } from "@/lib/modules/engineering/engineering.schema";
import { DISCIPLINES, DISCIPLINE_LABELS, DOCUMENT_STATUSES, REVIEW_STATUS_LABELS } from "@/lib/modules/engineering/engineering.types";

export const metadata: Metadata = { title: "Drawings" };

/** Drawings and shop drawings with their current revision across your projects. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const result = await listEngineeringDocuments(context, engineeringDocumentListSchema.parse({ ...flat(await searchParams), drawings: "1" }));
  return (
    <ModulePage experience={experience} activeSection="drawings" title="Drawings" description="Drawings and shop drawings with their current revision across your projects.">
      <div className="space-y-4">
        <ListToolbar searchPlaceholder="Search number or title…" searchParam="q" filters={[{ param: "discipline", label: "Discipline", options: DISCIPLINES.map((value) => ({ value, label: DISCIPLINE_LABELS[value] })) }, { param: "status", label: "Status", options: DOCUMENT_STATUSES.map((value) => ({ value, label: REVIEW_STATUS_LABELS[value] })) }]} />
        <DocumentRegister items={result.items} showProject drawings />
      </div>
    </ModulePage>
  );
}
