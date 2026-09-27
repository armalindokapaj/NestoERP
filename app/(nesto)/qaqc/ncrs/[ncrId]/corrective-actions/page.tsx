import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.correctiveActions") };
}

type Params = { params: Promise<{ ncrId: string }> };

/**
 * The corrective actions on one NCR (PRD #21 §10).
 *
 * They already appear on the NCR itself, where they belong beside the root
 * cause that makes sense of them — so this route sends the reader there rather
 * than showing the same list twice.
 */
export default async function NcrCorrectiveActionsPage({ params }: Params) {
  const { ncrId } = await params;
  redirect(`/qaqc/ncrs/${ncrId}`);
}
