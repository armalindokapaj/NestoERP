import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CommitmentForm } from "@/components/finance/commitment-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { createCommitmentAction } from "@/lib/actions/finance";
import { requireModule } from "@/lib/context/current-user";
import { prisma } from "@/lib/database/prisma";
import {
  buildFinanceProjectWhere,
  hasCompanyFinanceScope,
} from "@/lib/modules/finance/finance.scope";

export const metadata: Metadata = { title: "New commitment" };

export default async function NewCommitmentPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.commitment.create")) redirect("/access-denied");

  const params = await searchParams;
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
          { label: "Finance", href: "/finance" },
          { label: "Commitments", href: "/finance/commitments" },
          { label: "New commitment" },
        ]}
        title="New commitment"
        subtitle="Saved as a draft. It counts toward forecast cost once it has been approved."
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
        submitLabel="Create commitment"
        pendingLabel="Creating…"
      />
    </div>
  );
}
