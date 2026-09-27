import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { LeadForm } from "@/components/sales/lead-form";
import { updateLeadAction } from "@/lib/actions/sales";
import { salesOwnerOptions } from "@/lib/modules/sales/sales.options";
import { leadContext } from "../lead-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.editLead") };
}

type Params = { params: Promise<{ leadId: string }> };

/** Editing a lead (PRD #17 §46). A converted lead is read-only (§234). */
export default async function EditLeadPage({ params }: Params) {
  const { leadId } = await params;
  const { context, lead } = await leadContext(leadId);
  const t = await getTranslations("sales");

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
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.leads"), href: "/sales/leads" },
          { label: lead.name, href: `/sales/leads/${leadId}` },
          { label: t("crumbs.edit") },
        ]}
        title={t("pages.editTitle", { name: lead.name })}
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
        submitLabel={t("pages.saveChanges")}
        pendingLabel={t("pages.saving")}
      />
    </div>
  );
}
