import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { RequestForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createRequestAction } from "@/lib/actions/qaqc";
import * as requests from "@/lib/modules/qaqc/requests/request.service";
import { formatDate } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.requestInspection") };
}

/** Ask for an inspection (PRD #21 §43). */
export default async function NewRequestPage() {
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");
  if (!can(context, "qaqc.request.create")) notFound();

  const options = await requests.requestFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.requests"), href: "/qaqc/requests" },
          { label: t("crumbs.newRequest") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.requestInspection")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("requestPage.newIntro")}
        </p>
      </div>

      <RequestForm
        action={createRequestAction}
        cancelHref="/qaqc/requests"
        submitLabel={t("requestPage.raise")}
        pendingLabel={t("common.raising")}
        canAssign={can(context, "qaqc.request.assign")}
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
          label: `${receipt.receiptNumber} — ${receipt.supplier.name} · ${formatDate(receipt.receiptDate.toISOString())}`,
        }))}
      />
    </div>
  );
}
