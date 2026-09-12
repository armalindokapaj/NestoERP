import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HseRecordDocuments } from "@/components/hse/record-documents";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as permits from "@/lib/modules/hse/permits/permit.service";

export const metadata: Metadata = { title: "Permit documents" };

type Params = { params: Promise<{ permitId: string }> };

export default async function PermitDocumentsPage({ params }: Params) {
  const { permitId } = await params;
  const context = await requireModule("hse");

  let permit;
  try {
    permit = await permits.getPermit(context, permitId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!permit.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Permits", href: "/hse/permits" },
          { label: permit.permitNumber, href: `/hse/permits/${permitId}` },
          { label: "Documents" },
        ]}
      />

      <h1 className="text-page font-semibold text-fg">Documents on {permit.permitNumber}</h1>

      <HseRecordDocuments context={context} entityType="work_permit" entityId={permit.id} />
    </div>
  );
}
