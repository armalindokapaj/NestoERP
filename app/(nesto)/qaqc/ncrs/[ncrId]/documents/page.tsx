import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { QaqcRecordDocuments } from "@/components/qaqc/record-documents";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.documents") };
}

type Params = { params: Promise<{ ncrId: string }> };

/** Evidence filed against an NCR (PRD #21 §179). */
export default async function NcrDocumentsPage({ params }: Params) {
  const { ncrId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

  let ncr;
  try {
    ncr = await ncrs.getNcr(context, ncrId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!ncr.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.ncrs"), href: "/qaqc/ncrs" },
          { label: ncr.ncrNumber, href: `/qaqc/ncrs/${ncr.id}` },
          { label: t("crumbs.documents") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("detail.documents")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{ncr.ncrNumber}</p>
      </div>

      <QaqcRecordDocuments
        context={context}
        entityType="non_conformance_report"
        entityId={ncr.id}
        emptyDescription={t("documents.ncr")}
      />
    </div>
  );
}
