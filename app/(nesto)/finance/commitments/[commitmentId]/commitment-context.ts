import { notFound } from "next/navigation";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import type { UserContext } from "@/lib/context/types";
import * as commitments from "@/lib/modules/finance/commitments/commitment.service";
import type { CommitmentDetailDTO } from "@/lib/modules/finance/finance.types";

/** Loads a commitment for every page under /finance/commitments/[commitmentId]. */
export async function loadCommitment(
  commitmentId: string,
): Promise<{ context: UserContext; commitment: CommitmentDetailDTO }> {
  const context = await requireModule("finance");

  try {
    return { context, commitment: await commitments.getCommitment(context, commitmentId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export function commitmentLabel(commitment: CommitmentDetailDTO): string {
  return commitment.reference ?? commitment.description;
}

export async function commitmentBreadcrumbs(
  commitment: CommitmentDetailDTO,
  trailing?: string,
): Promise<Crumb[]> {
  const t = await getTranslations("finance");
  const label = commitmentLabel(commitment);
  const crumbs: Crumb[] = [
    { label: t("crumbs.finance"), href: "/finance" },
    { label: t("crumbs.commitments"), href: "/finance/commitments" },
    trailing ? { label, href: `/finance/commitments/${commitment.id}` } : { label },
  ];
  if (trailing) crumbs.push({ label: trailing });
  return crumbs;
}
