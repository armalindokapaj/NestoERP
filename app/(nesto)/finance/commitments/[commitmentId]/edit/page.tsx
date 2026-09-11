import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CommitmentForm } from "@/components/finance/commitment-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { updateCommitmentAction } from "@/lib/actions/finance";
import { prisma } from "@/lib/database/prisma";
import {
  buildFinanceProjectWhere,
  hasCompanyFinanceScope,
} from "@/lib/modules/finance/finance.scope";
import {
  commitmentBreadcrumbs,
  commitmentLabel,
  loadCommitment,
} from "../commitment-context";

type Params = { params: Promise<{ commitmentId: string }> };

export const metadata: Metadata = { title: "Edit commitment" };

export default async function EditCommitmentPage({ params }: Params) {
  const { commitmentId } = await params;
  const { context, commitment } = await loadCommitment(commitmentId);

  // An approved commitment is fixed, and one another module owns is theirs.
  if (!commitment.capabilities.canEdit) redirect(`/finance/commitments/${commitmentId}`);

  const projects = await prisma.project.findMany({
    where: buildFinanceProjectWhere(context),
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });

  async function action(formData: FormData) {
    "use server";
    return updateCommitmentAction(commitmentId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={commitmentBreadcrumbs(commitment, "Edit")}
        title={`Edit ${commitmentLabel(commitment)}`}
        status={commitment.status}
      />

      <CommitmentForm
        action={action}
        projects={projects.map((project) => ({
          value: project.id,
          label: `${project.name} (${project.code})`,
        }))}
        canCreateCompanyWide={hasCompanyFinanceScope(context)}
        values={{
          projectId: commitment.project?.id ?? null,
          reference: commitment.reference,
          description: commitment.description,
          counterpartyName: commitment.counterpartyName,
          category: commitment.category,
          currency: commitment.currency,
          amount: commitment.amount,
          expectedDate: commitment.expectedDate,
          notes: commitment.notes,
        }}
        versionUpdatedAt={commitment.updatedAt}
        cancelHref={`/finance/commitments/${commitment.id}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </div>
  );
}
