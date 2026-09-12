import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { QuoteComparison } from "@/components/procurement/quote-comparison";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as quotes from "@/lib/modules/procurement/quotes/quote.service";

type Params = { params: Promise<{ rfqId: string }> };

export const metadata: Metadata = { title: "Quote comparison" };

/**
 * The comparison screen (PRD #19 §88–§91, §270).
 *
 * A reader without `procurement.quote.view` still reaches this page and sees
 * who was asked and who answered — with no figures and no ranking, because a
 * ranking is a statement about the prices behind it (PRD #19 §261).
 */
export default async function ComparisonPage({ params }: Params) {
  const { rfqId } = await params;
  const context = await requireModule("procurement");
  if (!can(context, "procurement.rfq.view")) redirect("/access-denied");

  let comparison;
  try {
    comparison = await quotes.compareQuotes(context, rfqId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Enquiries", href: "/procurement/rfqs" },
          { label: comparison.rfq.rfqNumber, href: `/procurement/rfqs/${rfqId}` },
          { label: "Comparison" },
        ]}
        title={comparison.rfq.title}
        subtitle={comparison.rfq.rfqNumber}
        status={comparison.rfq.status}
      />

      {!comparison.canCompare ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          You can see who was asked and who answered. Supplier prices need a separate permission.
        </p>
      ) : null}

      <QuoteComparison
        comparison={comparison}
        canSelect={can(context, "procurement.quote.select")}
        canDisqualify={can(context, "procurement.quote.disqualify")}
      />
    </div>
  );
}
