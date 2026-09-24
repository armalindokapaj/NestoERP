import { NestoLogo } from "@/components/layout/nesto-logo";
import { Button } from "@/components/ui/button";
import { getTranslations } from "@/lib/i18n/server";

/**
 * 404 page (spec §57).
 *
 * Also the answer to a record refused before the shell streams (NAV-01 §2.1),
 * which Next draws from its error payload. A soft navigation out of that
 * payload changes the URL but keeps this screen, so the links here are plain
 * document navigations.
 */
export default async function NotFound() {
  const t = await getTranslations("system");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 text-center">
      <NestoLogo className="mb-8" />
      <p className="text-micro font-semibold uppercase tracking-[0.18em] text-fg-subtle">404</p>
      <h1 className="mt-3 text-section font-semibold text-fg">{t("notFound.title")}</h1>
      <p className="mt-2 max-w-sm text-body text-fg-muted">{t("notFound.description")}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <a href="/dashboard">{t("returnToDashboard")}</a>
        </Button>
        <Button asChild variant="secondary">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a document navigation on purpose, see above */}
          <a href="/">{t("notFound.home")}</a>
        </Button>
      </div>
    </div>
  );
}
