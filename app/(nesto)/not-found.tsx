import Link from "next/link";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getTranslations } from "@/lib/i18n/server";

/**
 * 404 inside the app (spec §57): a record the reader cannot open, an edit a
 * record no longer allows, a page that does not exist. It keeps the shell —
 * sidebar, search, bell — so the person is one click from anywhere, and it says
 * nothing about why: missing and out of reach look the same (PRD #13 §149).
 */
export default async function AppNotFound() {
  const t = await getTranslations("system");

  return (
    <div className="flex min-h-[60vh] items-center justify-center" data-testid="not-found">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full border border-line bg-surface text-fg-subtle">
          <SearchX className="size-5" />
        </div>
        <p className="text-micro font-semibold uppercase tracking-[0.18em] text-fg-subtle">404</p>
        <h1 className="mt-2 text-section font-semibold text-fg">{t("notFound.title")}</h1>
        <p className="mt-2 text-body text-fg-muted">{t("notFound.description")}</p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">{t("returnToDashboard")}</Link>
        </Button>
      </div>
    </div>
  );
}
