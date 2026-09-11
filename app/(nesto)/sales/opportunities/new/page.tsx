import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { OpportunityForm } from "@/components/sales/opportunity-form";
import { can } from "@/lib/access/can";
import { createOpportunityAction } from "@/lib/actions/sales";
import { requireModule } from "@/lib/context/current-user";
import { salesClientOptions, salesOwnerOptions } from "@/lib/modules/sales/sales.options";

export const metadata: Metadata = { title: "New opportunity" };

/** Open a deal (PRD #17 §75, §76). */
export default async function NewOpportunityPage() {
  const context = await requireModule("sales");
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
          { label: "Sales", href: "/sales" },
          { label: "Opportunities", href: "/sales/opportunities" },
          { label: "New opportunity" },
        ]}
        title="New opportunity"
        subtitle="A deal in the pipeline. It becomes a project only once it is won."
      />

      <OpportunityForm
        action={action}
        owners={owners}
        clients={clients}
        cancelHref="/sales/opportunities"
        submitLabel="Create opportunity"
        pendingLabel="Creating…"
      />
    </div>
  );
}
