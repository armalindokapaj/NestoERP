import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("system");
  return { title: t("accessDenied.metaTitle") };
}

/**
 * Unauthorized page (spec §56).
 * Nothing about the restricted area is described — no module name, no data.
 */
export default async function AccessDeniedPage() {
  const t = await getTranslations("system");

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full border border-line bg-surface text-fg-subtle">
          <Lock className="size-5" />
        </div>
        <h1 className="text-section font-semibold text-fg">{t("accessDenied.title")}</h1>
        <p className="mt-2 text-body text-fg-muted">{t("accessDenied.description")}</p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">{t("returnToDashboard")}</Link>
        </Button>
      </div>
    </div>
  );
}
