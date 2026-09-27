import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { QuoteForm } from "@/components/procurement/quote-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as rfqs from "@/lib/modules/procurement/rfqs/rfq.service";

type Params = { params: Promise<{ rfqId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("procurement");
  return { title: t("meta.recordQuote") };
}

/** Records a supplier's answer against the enquiry's own lines (PRD #19 §269). */
export default async function QuotesPage({ params }: Params) {
  const { rfqId } = await params;
  const context = await requireModule("procurement");

  let rfq;
  try {
    rfq = await rfqs.getRfq(context, rfqId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!rfq.capabilities.canRecordQuote) notFound();
  const t = await getTranslations("procurement");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.procurement"), href: "/procurement" },
          { label: t("crumbs.enquiries"), href: "/procurement/rfqs" },
          { label: rfq.rfqNumber, href: `/procurement/rfqs/${rfq.id}` },
          { label: t("crumbs.recordQuote") },
        ]}
        title={rfq.title}
        subtitle={rfq.rfqNumber}
        status={rfq.status}
      />

      <QuoteForm rfq={rfq} />
    </div>
  );
}
