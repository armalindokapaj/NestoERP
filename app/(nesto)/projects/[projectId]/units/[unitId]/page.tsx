import type { Metadata } from "next";
import { getLocale, getTranslations } from "@/lib/i18n/server";

import { ReadinessPanel } from "@/components/project-structure/unit-page/publication-badge";
import { UnitFacts } from "@/components/project-structure/unit-page/unit-facts";
import { can, canAccessModule } from "@/lib/access/can";
import { listUnitFiles } from "@/lib/modules/project-structure/unit-files.service";
import { loadUnitPage, UnitShell } from "./unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("unitPage.unit") };
}

/** The unit's overview (E-05D §10, §11, §45, §90, §91): what it is (`UnitFacts`), and how complete its listing is (information only). */
export default async function UnitOverviewPage({ params }: Params) {
  const locale = await getLocale();
  const { projectId, unitId } = await params;
  const page = await loadUnitPage(projectId, unitId);
  const { context, unit, publishing } = page;
  const filesOpen = canAccessModule(context, "documents") && can(context, "document.view");
  const files = filesOpen ? await listUnitFiles(context, unit.id) : null;
  const base = `/projects/${unit.projectId}/units/${unit.id}`;

  return (
    <UnitShell page={page} active="overview">
      <UnitFacts
        unit={unit}
        files={files}
        locale={locale}
        links={{ media: `${base}/media`, documents: `${base}/documents` }}
        aside={publishing.status === "ARCHIVED" ? null : <ReadinessPanel readiness={publishing.readiness} />}
      />
    </UnitShell>
  );
}
