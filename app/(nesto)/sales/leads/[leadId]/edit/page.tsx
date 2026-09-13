import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { LeadForm } from "@/components/sales/lead-form";
import { updateLeadAction } from "@/lib/actions/sales";
import { salesOwnerOptions } from "@/lib/modules/sales/sales.options";
import { leadContext } from "../lead-context";

export const metadata: Metadata = { title: "Edit lead" };

type Params = { params: Promise<{ leadId: string }> };

/** Editing a lead (PRD #17 §46). A converted lead is read-only (§234). */
export default async function EditLeadPage({ params }: Params) {
  const { leadId } = await params;
  const { context, lead } = await leadContext(leadId);

  if (!lead.capabilities.canEdit) redirect(`/sales/leads/${leadId}`);

  const owners = await salesOwnerOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateLeadAction(leadId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Leads", href: "/sales/leads" },
          { label: lead.name, href: `/sales/leads/${leadId}` },
          { label: "Edit" },
        ]}
        title={`Edit ${lead.name}`}
        status={lead.status}
      />

      <LeadForm
        excludeLeadId={lead.id}
        action={action}
        owners={owners}
        values={{
          name: lead.name,
          companyName: lead.companyName,
          email: lead.email,
          phone: lead.phone,
          website: lead.website,
          source: lead.source,
          ownerMemberId: lead.owner?.memberId ?? null,
          estimatedValue: lead.estimatedValue,
          currency: lead.currency,
          notes: lead.notes,
        }}
        versionUpdatedAt={lead.updatedAt}
        cancelHref={`/sales/leads/${leadId}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </div>
  );
}
