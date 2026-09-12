import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QuoteForm } from "@/components/procurement/quote-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as rfqs from "@/lib/modules/procurement/rfqs/rfq.service";

type Params = { params: Promise<{ rfqId: string }> };

export const metadata: Metadata = { title: "Record a quote" };

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

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Enquiries", href: "/procurement/rfqs" },
          { label: rfq.rfqNumber, href: `/procurement/rfqs/${rfq.id}` },
          { label: "Record a quote" },
        ]}
        title={rfq.title}
        subtitle={rfq.rfqNumber}
        status={rfq.status}
      />

      <QuoteForm rfq={rfq} />
    </div>
  );
}
