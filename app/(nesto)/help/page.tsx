import type { Metadata } from "next";

import { HelpIndex } from "@/components/help/help-page";
import { requireUserContext } from "@/lib/context/current-user";
import { helpAccess } from "@/lib/help/help-access";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("misc"))("help.title") };
}

/**
 * Help for every module this person can open (AUD-05 §7, UX-16). Checked-in
 * text, no tours, nothing fetched from outside NESTO.
 */
export default async function HelpIndexPage() {
  const context = await requireUserContext();
  const access = await helpAccess(context);
  return <HelpIndex modules={access.modules} />;
}
