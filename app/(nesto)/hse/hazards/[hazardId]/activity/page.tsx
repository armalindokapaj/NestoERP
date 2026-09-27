import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HseActivityFeed } from "@/components/hse/record-activity";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { pageHref, paginationSchema } from "@/lib/modules/shared/list-query";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.hazardActivity") };
}

type Params = {
  params: Promise<{ hazardId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HazardActivityPage({ params, searchParams }: Params) {
  const { hazardId } = await params;
  const query = await searchParams;
  const { page } = paginationSchema.parse({ page: typeof query.page === "string" ? query.page : undefined });
  const basePath = `/hse/hazards/${hazardId}/activity`;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

  let hazard;
  try {
    hazard = await hazards.getHazard(context, hazardId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!hazard.capabilities.canViewActivity) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.hazards.title"), href: "/hse/hazards" },
          { label: hazard.hazardNumber, href: `/hse/hazards/${hazardId}` },
          { label: t("record.activity") },
        ]}
      />

      <h1 className="text-page font-semibold text-fg">{t("page.activityOn", { number: hazard.hazardNumber })}</h1>

      <HseActivityFeed
        context={context}
        entityType="HseHazard"
        entityId={hazard.id}
        page={page}
        buildHref={(target) => pageHref(basePath, query, target)}
      />
    </div>
  );
}
