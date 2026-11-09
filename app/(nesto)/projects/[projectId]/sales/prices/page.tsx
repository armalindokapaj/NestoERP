import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { RecordContextHeader } from "@/components/modules/record-header";
import Link from "@/components/navigation/nav-link";
import { PriceListEditor } from "@/components/sales/unit-sales/price-list-editor";
import { Button } from "@/components/ui/button";
import { AccessError } from "@/lib/access/guards";
import { getTranslations } from "@/lib/i18n/server";
import * as projects from "@/lib/modules/projects/project.service";
import { salesCapabilities } from "@/lib/modules/sales/units/unit-sales.core";
import { getPriceList } from "@/lib/modules/sales/units/unit-pricing.service";
import { loadProject } from "../../project-context";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sales"))("priceList.title") };
}

function refuse(error: unknown): never {
  if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
  if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
  throw error;
}

/**
 * A project's price list (2026-11): a price per m² for each floor, one price
 * for every parking space, and any unit changed by hand. Only for readers who
 * may set asking prices; the Sales inventory links here.
 */
export default async function ProjectPricesPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  if (!projects.projectActions(context).canViewUnitSales || !salesCapabilities(context).canManagePrice) redirect("/access-denied");
  const t = await getTranslations("sales");
  const list = await getPriceList(context, project.id).catch(refuse);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        title={t("priceList.title")}
        subtitle={project.name}
        actions={
          <Button asChild variant="ghost">
            <Link href={`/projects/${project.id}/sales`}>
              <ArrowLeft aria-hidden="true" />
              {t("priceList.back")}
            </Link>
          </Button>
        }
      />
      <PriceListEditor initial={list} />
    </div>
  );
}
