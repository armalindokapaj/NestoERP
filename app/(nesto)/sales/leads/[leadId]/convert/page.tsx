import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { ConvertLeadForm } from "@/components/sales/convert-form";
import { can } from "@/lib/access/can";
import { convertLeadAction } from "@/lib/actions/sales";
import * as leads from "@/lib/modules/sales/leads/lead.service";
import { salesClientOptions, salesOwnerOptions } from "@/lib/modules/sales/sales.options";
import { leadContext } from "../lead-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.convertLead") };
}

type Params = { params: Promise<{ leadId: string }> };

/**
 * Lead → Opportunity (PRD #17 §52).
 *
 * The duplicate check runs before the form renders, so if the company already
 * has a client by this name the person deciding sees it while they decide
 * (PRD #17 §158).
 */
export default async function ConvertLeadPage({ params }: Params) {
  const { leadId } = await params;
  const { context, lead } = await leadContext(leadId);
  const t = await getTranslations("sales");

  if (!lead.capabilities.canConvert) redirect(`/sales/leads/${leadId}`);

  // Both halves of the decision, and linking is not creating (PRD #17 §53, §54).
  const canLinkClient = can(context, "sales.client.convert") && can(context, "client.view");
  const canCreateClient = canLinkClient && can(context, "client.create");

  const [owners, clients, duplicates] = await Promise.all([
    salesOwnerOptions(context),
    canLinkClient ? salesClientOptions(context) : Promise.resolve([]),
    canCreateClient
      ? leads.checkLeadDuplicates(context, {
          email: lead.email ?? undefined,
          name: lead.name,
          companyName: lead.companyName ?? undefined,
          excludeLeadId: leadId,
        })
      : Promise.resolve([]),
  ]);

  async function action(formData: FormData) {
    "use server";
    return convertLeadAction(leadId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.leads"), href: "/sales/leads" },
          { label: lead.name, href: `/sales/leads/${leadId}` },
          { label: t("crumbs.convert") },
        ]}
        title={t("pages.convertTitle", { name: lead.name })}
        subtitle={t("pages.convertSubtitle")}
      />

      <ConvertLeadForm
        action={action}
        owners={owners}
        clients={clients.map((client) => ({ value: client.value, label: client.label }))}
        canLinkClient={canLinkClient}
        canCreateClient={canCreateClient}
        defaults={{
          opportunityName: lead.companyName ?? lead.name,
          ownerMemberId: lead.owner?.memberId ?? context.membershipId,
          estimatedValue: lead.estimatedValue ?? "",
          currency: lead.currency ?? "EUR",
          newClientName: lead.companyName ?? lead.name,
        }}
        duplicates={duplicates.filter((match) => match.kind === "CLIENT")}
        cancelHref={`/sales/leads/${leadId}`}
      />
    </div>
  );
}
