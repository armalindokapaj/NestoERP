import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CommitmentForm } from "@/components/finance/commitment-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { createCommitmentAction } from "@/lib/actions/finance";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { prisma } from "@/lib/database/prisma";
import {
  buildFinanceProjectWhere,
  hasCompanyFinanceScope,
} from "@/lib/modules/finance/finance.scope";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.newCommitment") };
}

export default async function NewCommitmentPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.commitment.create")) redirect("/access-denied");

  const params = await searchParams;
  const t = await getTranslations("finance");
  const projects = await prisma.project.findMany({
    where: buildFinanceProjectWhere(context),
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });

  async function action(formData: FormData) {
    "use server";
    return createCommitmentAction(formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.finance"), href: "/finance" },
          { label: t("crumbs.commitments"), href: "/finance/commitments" },
          { label: t("commitments.new") },
        ]}
        title={t("commitments.new")}
        subtitle={t("commitments.newSubtitle")}
      />

      <CommitmentForm
        action={action}
        projects={projects.map((project) => ({
          value: project.id,
          label: `${project.name} (${project.code})`,
        }))}
        canCreateCompanyWide={hasCompanyFinanceScope(context)}
        values={
          params.projectId
            ? {
                projectId: params.projectId,
                reference: null,
                description: "",
                counterpartyName: null,
                category: "SUBCONTRACTOR",
                currency: "EUR",
                amount: "0",
                expectedDate: null,
                notes: null,
              }
            : undefined
        }
        cancelHref="/finance/commitments"
        submitLabel={t("commitments.create")}
        pendingLabel={t("revise.creating")}
      />
    </div>
  );
}
