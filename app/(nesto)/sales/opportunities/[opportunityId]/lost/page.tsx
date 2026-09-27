import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { LostForm } from "@/components/sales/close-forms";
import { markLostAction } from "@/lib/actions/sales";
import { opportunityContext } from "../opportunity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.markLost") };
}

type Params = { params: Promise<{ opportunityId: string }> };

/** Losing a deal, with a reason the report can group by (PRD #17 §93, §168). */
export default async function MarkLostPage({ params }: Params) {
  const { opportunityId } = await params;
  const { opportunity } = await opportunityContext(opportunityId);
  const t = await getTranslations("sales");

  if (!opportunity.capabilities.canMarkLost) redirect(`/sales/opportunities/${opportunityId}`);

  async function action(formData: FormData) {
    "use server";
    return markLostAction(opportunityId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.opportunities"), href: "/sales/opportunities" },
          { label: opportunity.name, href: `/sales/opportunities/${opportunityId}` },
          { label: t("crumbs.markLost") },
        ]}
        title={t("pages.markLostTitle", { name: opportunity.name })}
        subtitle={t("pages.markLostSubtitle")}
      />

      <LostForm action={action} cancelHref={`/sales/opportunities/${opportunityId}`} />
    </div>
  );
}
