import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { SalesActivityFeed } from "@/components/sales/sales-activity";
import { SkeletonTable } from "@/components/ui/loading-state";
import { leadContext } from "../lead-context";

export const metadata: Metadata = { title: "Lead activity" };

type Params = { params: Promise<{ leadId: string }> };

/** One lead's full history (PRD #17 §147, §410). */
export default async function LeadActivityPage({ params }: Params) {
  const { leadId } = await params;
  const { context, lead } = await leadContext(leadId);

  if (!lead.capabilities.canViewActivity) redirect(`/sales/leads/${leadId}`);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Leads", href: "/sales/leads" },
          { label: lead.name, href: `/sales/leads/${leadId}` },
          { label: "Activity" },
        ]}
        title={`${lead.name} — activity`}
        status={lead.status}
      />

      <Suspense fallback={<SkeletonTable rows={5} />}>
        <SalesActivityFeed context={context} entityType="Lead" entityId={leadId} />
      </Suspense>
    </div>
  );
}
