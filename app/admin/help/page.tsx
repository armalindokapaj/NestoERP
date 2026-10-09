import type { Metadata } from "next";

import { SurfaceHelpPage } from "@/components/shell/surface-help";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("shell"))("account.help") };
}

export default function HelpPage() {
  return <SurfaceHelpPage accountHref="/admin/account" />;
}
