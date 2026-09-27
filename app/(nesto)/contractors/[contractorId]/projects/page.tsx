import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";

import { AssignmentTable } from "@/components/contractors/contractor-tables";
import { orNotFound } from "@/components/engineering/page-helpers";
import { requireModule } from "@/lib/context/current-user";
import { listContractorAssignments } from "@/lib/modules/contractors/contractor.assignments";

type Params = { params: Promise<{ contractorId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("contractors"))("meta.projects") };
}

/** Every project assignment of this contractor the reader can open (PRD #46 §27, §160). */
export default async function ContractorProjectsPage({ params }: Params) {
  const { contractorId } = await params;
  const context = await requireModule("contractors");
  const assignments = await orNotFound(listContractorAssignments(context, contractorId));
  const t = await getTranslations("contractors");
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-section font-semibold text-fg">{t("projectsPage.title")}</h2>
        <p className="mt-0.5 text-table text-fg-muted">{t("projectsPage.description")}</p>
      </div>
      <AssignmentTable items={assignments} view="contractor" />
    </section>
  );
}
