import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Panel } from "@/components/engineering/engineering-ui";
import { keepPageInRange, one, orNotFound, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { Pagination } from "@/components/data/pagination";
import { DocumentRegister, RfiRegister, SubmittalRegister } from "@/components/engineering/registers";
import { requireModule } from "@/lib/context/current-user";
import { getContractor } from "@/lib/modules/contractors/contractor.service";
import { listEngineeringDocuments } from "@/lib/modules/engineering/engineering.documents";
import { engineeringOpen } from "@/lib/modules/engineering/engineering.permissions";
import { listRfis } from "@/lib/modules/engineering/engineering.rfis";
import { engineeringDocumentListSchema, rfiListSchema, submittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { listSubmittals } from "@/lib/modules/engineering/engineering.submittals";

type Params = { params: Promise<{ contractorId: string }>; searchParams: SearchParams };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("contractors"))("meta.engineering") };
}

/**
 * The contractor's RFIs, submittals and documents across the reader's projects (PRD #46 §160).
 *
 * Each register pages on its own key (`rfiPage`, `submittalPage`,
 * `documentPage`) with a true count, so a contractor with more than one page
 * of records shows all of them rather than silently the first 50; a page past
 * the end moves once to the last real one (AUD-08 §4, DT-05).
 */
export default async function ContractorEngineeringPage({ params, searchParams }: Params) {
  const [{ contractorId }, search] = await Promise.all([params, searchParams]);
  const context = await requireModule("contractors");
  const contractor = await orNotFound(getContractor(context, contractorId));
  if (!contractor.capabilities.canViewEngineering) redirect("/access-denied");
  const base = `/contractors/${contractor.id}/engineering`;
  const t = await getTranslations("contractors");
  const pageOf = (key: string) => one(search[key]);
  const queries = {
    rfis: rfiListSchema.parse({ contractorId: contractor.id, page: pageOf("rfiPage") }),
    submittals: submittalListSchema.parse({ contractorId: contractor.id, page: pageOf("submittalPage") }),
    documents: engineeringDocumentListSchema.parse({ contractorId: contractor.id, page: pageOf("documentPage") }),
  };
  const [rfis, submittals, documents] = await Promise.all([
    engineeringOpen(context, "rfi.view") ? listRfis(context, queries.rfis) : null,
    engineeringOpen(context, "submittal.view") ? listSubmittals(context, queries.submittals) : null,
    engineeringOpen(context, "engineering_document.view") ? listEngineeringDocuments(context, queries.documents) : null,
  ]);
  if (rfis) keepPageInRange(base, search, queries.rfis.page, rfis, "rfiPage");
  if (submittals) keepPageInRange(base, search, queries.submittals.page, submittals, "submittalPage");
  if (documents) keepPageInRange(base, search, queries.documents.page, documents, "documentPage");
  return (
    <div className="space-y-5">
      {rfis ? (
        <Panel title={t("engineeringPage.rfis")} description={t("engineeringPage.rfisDescription")}>
          <RfiRegister items={rfis.items} showProject emptyTitle={t("engineeringPage.noRfis")} />
          <Pagination meta={registerMeta(rfis)} buildHref={(page) => pageHref(base, search, page, "rfiPage")} />
        </Panel>
      ) : null}
      {submittals ? (
        <Panel title={t("engineeringPage.submittals")}>
          <SubmittalRegister items={submittals.items} showProject emptyTitle={t("engineeringPage.noSubmittals")} />
          <Pagination meta={registerMeta(submittals)} buildHref={(page) => pageHref(base, search, page, "submittalPage")} />
        </Panel>
      ) : null}
      {documents ? (
        <Panel title={t("engineeringPage.documents")}>
          <DocumentRegister items={documents.items} showProject emptyTitle={t("engineeringPage.noDocuments")} />
          <Pagination meta={registerMeta(documents)} buildHref={(page) => pageHref(base, search, page, "documentPage")} />
        </Panel>
      ) : null}
    </div>
  );
}
