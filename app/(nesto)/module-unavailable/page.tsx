import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { ToggleRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("system");
  return { title: t("moduleUnavailable.title") };
}

/**
 * A module the company has switched off (PRD #7 §81).
 *
 * Deliberately distinct from Access Denied: nothing about this person's role is
 * wrong, and there is nothing they can change. Their administrator enables the
 * module, or nobody does (PRD #5 §99).
 */
export default async function ModuleUnavailablePage() {
  const t = await getTranslations("system");

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full border border-line bg-surface text-fg-subtle">
          <ToggleRight className="size-5" />
        </div>
        <h1 className="text-section font-semibold text-fg">{t("moduleUnavailable.title")}</h1>
        <p className="mt-2 text-body text-fg-muted">{t("moduleUnavailable.description")}</p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">{t("returnToDashboard")}</Link>
        </Button>
      </div>
    </div>
  );
}
