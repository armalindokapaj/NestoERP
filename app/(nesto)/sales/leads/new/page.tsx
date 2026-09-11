import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { LeadForm } from "@/components/sales/lead-form";
import { can } from "@/lib/access/can";
import { createLeadAction } from "@/lib/actions/sales";
import { requireModule } from "@/lib/context/current-user";
import { salesOwnerOptions } from "@/lib/modules/sales/sales.options";

export const metadata: Metadata = { title: "New lead" };

/** Capture a lead (PRD #17 §41, §42). */
export default async function NewLeadPage() {
  const context = await requireModule("sales");
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
          { label: "Sales", href: "/sales" },
          { label: "Leads", href: "/sales/leads" },
          { label: "New lead" },
        ]}
        title="New lead"
        subtitle="A prospective contact. It becomes a client only when the deal is real."
      />

      <LeadForm
        action={action}
        owners={owners}
        cancelHref="/sales/leads"
        submitLabel="Create lead"
        pendingLabel="Creating…"
      />
    </div>
  );
}
