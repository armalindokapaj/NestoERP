import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { getSiteCopy } from "@/lib/i18n/server";

/**
 * The public site shell (design spec §82).
 *
 * A nested group inside (public) so that the marketing pages share a header and
 * footer while sign-in and password recovery stay bare — an authentication
 * screen with a marketing navigation is an invitation to wander off mid-task.
 *
 * The site is written in every interface language and reads the same cookie as
 * the application, so it inherits the document's `lang` from the root layout. A
 * visitor who picks a language in the header signs in to NESTO in it.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const copy = await getSiteCopy();

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SiteHeader copy={copy.header} nav={copy.nav} category={copy.category} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
