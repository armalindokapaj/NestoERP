import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { LeadForm } from "@/components/sales/lead-form";
import { can } from "@/lib/access/can";
import { createLeadAction } from "@/lib/actions/sales";
import { requireModule } from "@/lib/context/current-user";
import { salesOwnerOptions } from "@/lib/modules/sales/sales.options";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.newLead") };
}

/** Capture a lead (PRD #17 §41, §42). */
export default async function NewLeadPage() {
  const context = await requireModule("sales");
  const t = await getTranslations("sales");
  if (!can(context, "sales.lead.create")) redirect("/access-denied");

  const owners = await salesOwnerOptions(context);

  async function action(formData: FormData) {
    "use server";
    return createLeadAction(formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.leads"), href: "/sales/leads" },
          { label: t("crumbs.newLead") },
        ]}
        title={t("meta.newLead")}
        subtitle={t("pages.newLeadSubtitle")}
      />

      <LeadForm
        action={action}
        owners={owners}
        cancelHref="/sales/leads"
        submitLabel={t("pages.createLead")}
        pendingLabel={t("pages.creating")}
      />
    </div>
  );
}
