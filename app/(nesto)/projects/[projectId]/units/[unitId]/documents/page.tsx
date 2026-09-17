import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { UnitDocuments } from "@/components/project-structure/unit-page/unit-documents";
import { can, canAccessModule } from "@/lib/access/can";
import { listUnitFiles } from "@/lib/modules/project-structure/unit-files.service";
import { loadUnitPage, UnitShell } from "../unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string }> };

export const metadata: Metadata = { title: "Unit documents" };

/** The unit's Sales Plan and technical documents, as canonical files (E-05D §33-§39, §63, §94). */
export default async function UnitDocumentsPage({ params }: Params) {
  const { projectId, unitId } = await params;
  const page = await loadUnitPage(projectId, unitId);
  if (!(canAccessModule(page.context, "documents") && can(page.context, "document.view"))) notFound();
  const files = await listUnitFiles(page.context, page.unit.id);
  return (
    <UnitShell page={page} active="documents">
      <UnitDocuments unitId={page.unit.id} unitCode={page.unit.unitCode} files={files} />
    </UnitShell>
  );
}
