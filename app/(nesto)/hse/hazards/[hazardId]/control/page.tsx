import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HazardControlForm } from "@/components/hse/hazard-panels";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.recordControl") };
}

type Params = { params: Promise<{ hazardId: string }> };

/** Recording the control that went in (PRD #22 §67). */
export default async function ControlHazardPage({ params }: Params) {
  const { hazardId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.hazard.control")) notFound();

  let hazard;
  try {
    hazard = await hazards.getHazard(context, hazardId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!hazard.capabilities.canControl) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.hazards.title"), href: "/hse/hazards" },
          { label: hazard.hazardNumber, href: `/hse/hazards/${hazardId}` },
          { label: t("page.crumbControl") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.recordControl")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.controlIntro")}
        </p>
      </div>

      <HazardControlForm hazard={hazard} />
    </div>
  );
}
