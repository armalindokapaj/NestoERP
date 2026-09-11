import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { WonForm } from "@/components/sales/close-forms";
import { can } from "@/lib/access/can";
import { markWonAction } from "@/lib/actions/sales";
import { salesClientOptions, salesProjectOptions } from "@/lib/modules/sales/sales.options";
import { opportunityContext } from "../opportunity-context";

export const metadata: Metadata = { title: "Mark won" };

type Params = { params: Promise<{ opportunityId: string }> };

/**
 * Winning a deal (PRD #17 §84–§91).
 *
 * A page rather than a dialog, because it asks real questions: which canonical
 * client the company now has, and whether a project is created to deliver it.
 */
export default async function MarkWonPage({ params }: Params) {
  const { opportunityId } = await params;
  const { context, opportunity } = await opportunityContext(opportunityId);

  if (!opportunity.capabilities.canMarkWon) redirect(`/sales/opportunities/${opportunityId}`);

  /**
   * Each conversion needs both halves: the Sales grant and the target module's
   * own (PRD #17 §395–§397). Linking and creating are separate permissions, so
   * they are separate answers — a sales user who may hand a deal to an existing
   * project is not thereby able to create one.
   */
  const canLinkClient = can(context, "sales.client.convert") && can(context, "client.view");
  const canCreateClient = canLinkClient && can(context, "client.create");
  const canLinkProject = can(context, "sales.project.convert") && can(context, "project.view");
  const canCreateProject = canLinkProject && can(context, "project.create");

  const [clients, projects] = await Promise.all([
    canLinkClient ? salesClientOptions(context) : Promise.resolve([]),
    canLinkProject
      ? salesProjectOptions(context, opportunity.client?.id ?? null)
      : Promise.resolve([]),
  ]);

  async function action(formData: FormData) {
    "use server";
    return markWonAction(opportunityId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Opportunities", href: "/sales/opportunities" },
          { label: opportunity.name, href: `/sales/opportunities/${opportunityId}` },
          { label: "Mark won" },
        ]}
        title={`Mark ${opportunity.name} as won`}
        subtitle="The opportunity stays. It becomes the record of where the client and project came from."
      />

      <WonForm
        action={action}
        hasClient={opportunity.client !== null}
        clientName={opportunity.client?.name ?? null}
        clients={clients.map((client) => ({ value: client.value, label: client.label }))}
        projects={projects}
        canLinkClient={canLinkClient}
        canCreateClient={canCreateClient}
        canLinkProject={canLinkProject}
        canCreateProject={canCreateProject}
        defaultValue={opportunity.estimatedValue}
        currency={opportunity.currency}
        cancelHref={`/sales/opportunities/${opportunityId}`}
      />
    </div>
  );
}
