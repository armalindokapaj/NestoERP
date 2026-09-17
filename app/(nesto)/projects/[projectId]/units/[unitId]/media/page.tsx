import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { UnitMediaGallery } from "@/components/project-structure/unit-page/unit-media";
import { can, canAccessModule } from "@/lib/access/can";
import { listUnitFiles } from "@/lib/modules/project-structure/unit-files.service";
import { loadUnitPage, UnitShell } from "../unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string }> };

export const metadata: Metadata = { title: "Unit media" };

/** The unit's images and renders, in order, one of them primary (E-05D §40-§44). */
export default async function UnitMediaPage({ params }: Params) {
  const { projectId, unitId } = await params;
  const page = await loadUnitPage(projectId, unitId);
  if (!(canAccessModule(page.context, "documents") && can(page.context, "document.view"))) notFound();
  const files = await listUnitFiles(page.context, page.unit.id);
  return (
    <UnitShell page={page} active="media">
      <UnitMediaGallery unitId={page.unit.id} unitCode={page.unit.unitCode} files={files} />
    </UnitShell>
  );
}
