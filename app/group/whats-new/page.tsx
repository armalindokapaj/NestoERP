import type { Metadata } from "next";

import { WhatsNewPage } from "@/components/shell/whats-new";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("shell"))("account.whatsNew") };
}

export default WhatsNewPage;
