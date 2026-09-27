import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { NcrForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createNcrAction } from "@/lib/actions/qaqc";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.newNcr") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Raise a non-conformance (PRD #21 §128). */
export default async function NewNcrPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");
  if (!can(context, "qaqc.ncr.create")) notFound();

  const params = await searchParams;
  const options = await ncrs.ncrFormOptions(context);

  const read = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.ncrs"), href: "/qaqc/ncrs" },
          { label: t("crumbs.newNcr") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("ncrPage.newTitle")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("ncrPage.newIntro")}
        </p>
      </div>

      <NcrForm
        action={createNcrAction}
        cancelHref="/qaqc/ncrs"
        submitLabel={t("ncrPage.raise")}
        pendingLabel={t("common.raising")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        receipts={options.receipts.map((receipt) => ({
          value: receipt.id,
          label: `${receipt.receiptNumber} — ${receipt.supplier.name}`,
        }))}
        values={{
          title: "",
          description: "",
          projectId: read("projectId"),
          inspectionId: read("inspectionId"),
          goodsReceiptId: read("goodsReceiptId"),
          sourceDefectId: read("defectId"),
          category: "WORKMANSHIP",
          severity: "MEDIUM",
          assignedToMemberId: "",
          ownerMemberId: "",
          immediateAction: "",
          rootCause: "",
          correctiveActionSummary: "",
          dueDate: "",
        }}
      />
    </div>
  );
}
