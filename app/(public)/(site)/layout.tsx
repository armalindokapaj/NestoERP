import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

/**
 * The public site shell (design spec §82).
 *
 * A nested group inside (public) so that the marketing pages share a header and
 * footer while sign-in and password recovery stay bare — an authentication
 * screen with a marketing navigation is an invitation to wander off mid-task.
 *
 * The public site is written in English only, whatever language a visitor has
 * chosen for the application, so it says so to assistive technology rather
 * than inheriting the document's `lang`.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="en" className="flex min-h-dvh flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
