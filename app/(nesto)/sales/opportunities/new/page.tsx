import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { OpportunityForm } from "@/components/sales/opportunity-form";
import { can } from "@/lib/access/can";
import { createOpportunityAction } from "@/lib/actions/sales";
import { requireModule } from "@/lib/context/current-user";
import { salesClientOptions, salesOwnerOptions } from "@/lib/modules/sales/sales.options";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.newOpportunity") };
}

/** Open a deal (PRD #17 §75, §76). */
export default async function NewOpportunityPage() {
  const context = await requireModule("sales");
  const t = await getTranslations("sales");
  if (!can(context, "sales.opportunity.create")) redirect("/access-denied");

  const [owners, clients] = await Promise.all([
    salesOwnerOptions(context),
    can(context, "client.view") ? salesClientOptions(context) : Promise.resolve([]),
  ]);

  async function action(formData: FormData) {
    "use server";
    return createOpportunityAction(formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.opportunities"), href: "/sales/opportunities" },
          { label: t("crumbs.newOpportunity") },
        ]}
        title={t("meta.newOpportunity")}
        subtitle={t("pages.newOpportunitySubtitle")}
      />

      <OpportunityForm
        action={action}
        owners={owners}
        clients={clients}
        cancelHref="/sales/opportunities"
        submitLabel={t("pages.createOpportunity")}
        pendingLabel={t("pages.creating")}
      />
    </div>
  );
}
