import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound, redirect } from "next/navigation";

import { QuoteComparison } from "@/components/procurement/quote-comparison";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as quotes from "@/lib/modules/procurement/quotes/quote.service";

type Params = { params: Promise<{ rfqId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("procurement");
  return { title: t("meta.comparison") };
}

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

  const t = await getTranslations("procurement");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.procurement"), href: "/procurement" },
          { label: t("crumbs.enquiries"), href: "/procurement/rfqs" },
          { label: comparison.rfq.rfqNumber, href: `/procurement/rfqs/${rfqId}` },
          { label: t("crumbs.comparison") },
        ]}
        title={comparison.rfq.title}
        subtitle={comparison.rfq.rfqNumber}
        status={comparison.rfq.status}
      />

      {!comparison.canCompare ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("comparison.permissionNote")}
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
