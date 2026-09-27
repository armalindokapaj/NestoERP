import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { LinkProjectForm } from "@/components/sales/link-project-form";
import { can } from "@/lib/access/can";
import { salesProjectOptions } from "@/lib/modules/sales/sales.options";
import { opportunityContext } from "../opportunity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.linkProject") };
}

type Params = { params: Promise<{ opportunityId: string }> };

/**
 * Handing a won deal over to a project set up afterwards (PRD #17 §423).
 *
 * The opportunity stays WON. Only the delivery link is added.
 */
export default async function LinkProjectPage({ params }: Params) {
  const { opportunityId } = await params;
  const { context, opportunity } = await opportunityContext(opportunityId);
  const t = await getTranslations("sales");

  if (!opportunity.capabilities.canLinkProject) redirect(`/sales/opportunities/${opportunityId}`);
  if (!can(context, "project.view")) redirect(`/sales/opportunities/${opportunityId}`);

  const projects = await salesProjectOptions(context, opportunity.client?.id ?? null);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.opportunities"), href: "/sales/opportunities" },
          { label: opportunity.name, href: `/sales/opportunities/${opportunityId}` },
          { label: t("crumbs.linkProject") },
        ]}
        title={t("pages.linkProjectTitle")}
        subtitle={t("pages.linkProjectSubtitle", { name: opportunity.name })}
      />

      <LinkProjectForm
        opportunityId={opportunityId}
        projects={projects}
        cancelHref={`/sales/opportunities/${opportunityId}`}
      />
    </div>
  );
}
