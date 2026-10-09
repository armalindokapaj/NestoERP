import type { Metadata } from "next";

import { WhatsNewPage } from "@/components/shell/whats-new";
import { requireUserContext } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("shell"))("account.whatsNew") };
}

export default async function CompanyWhatsNewPage() {
  await requireUserContext();
  return <WhatsNewPage />;
}
