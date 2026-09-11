import type { Metadata } from "next";
import Link from "next/link";

import { BrandPanel } from "@/components/layout/brand-panel";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { previewInvite } from "@/lib/modules/team/invitations/invite.service";
import { AcceptInviteForm } from "./accept-invite-form";
import { JoinButton } from "./join-button";

type Params = { params: Promise<{ token: string }> };

export const metadata: Metadata = { title: "Accept invitation" };

/**
 * The invitation landing page (PRD #14 §73–§79, §240).
 *
 * Public on purpose: the recipient has no account yet. Every failure — unknown
 * token, cancelled, expired, already used, suspended company — answers with the
 * same message, so the page cannot be used to discover which addresses have
 * been invited (PRD #14 §240).
 *
 * Three outcomes for a valid token:
 *   1. No account yet          → choose a name and password here.
 *   2. Account, not signed in  → sign in first; the link survives the round trip.
 *   3. Account, signed in      → one button, no password.
 */
export default async function AcceptInvitePage({ params }: Params) {
  const { token } = await params;

  const [invite, session] = await Promise.all([previewInvite(token), auth()]);
  const signedInUserId = session?.user?.id ?? null;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,42%)_minmax(0,1fr)]">
      <BrandPanel />

      <div className="flex min-h-dvh flex-col bg-surface lg:min-h-0">
        <header className="flex h-16 shrink-0 items-center px-4 sm:px-8 lg:hidden">
          <Link href="/" aria-label="NESTO home">
            <NestoLogo />
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-lg">
            {!invite ? (
              <InvalidInvitation />
            ) : !invite.hasAccount ? (
              <>
                <h1 className="text-section font-semibold text-fg">
                  Join {invite.companyName}
                </h1>
                <p className="mb-6 mt-1.5 text-body text-fg-muted">
                  You have been invited as {invite.roleName}. Choose a password to finish
                  setting up your account.
                </p>
                <AcceptInviteForm token={token} email={invite.email} />
              </>
            ) : signedInUserId ? (
              <>
                <h1 className="text-section font-semibold text-fg">
                  Join {invite.companyName}
                </h1>
                <p className="mb-6 mt-1.5 text-body text-fg-muted">
                  {invite.email} has been invited as {invite.roleName}. Accepting adds this
                  company to your existing NESTO account.
                </p>
                <JoinButton token={token} companyName={invite.companyName} />
              </>
            ) : (
              <>
                <h1 className="text-section font-semibold text-fg">
                  Sign in to join {invite.companyName}
                </h1>
                <p className="mb-6 mt-1.5 text-body text-fg-muted">
                  {invite.email} already has a NESTO account. Sign in with it and you will
                  come straight back here to accept.
                </p>
                <Button asChild className="w-full">
                  <Link href={`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}>
                    Sign in
                  </Link>
                </Button>
              </>
            )}
          </div>
        </main>

        <footer className="shrink-0 px-4 py-6 sm:px-8">
          <p className="text-meta text-fg-subtle">© {new Date().getFullYear()} NESTO</p>
        </footer>
      </div>
    </div>
  );
}

/**
 * One message for every failure (PRD #14 §240).
 *
 * Distinguishing "expired" from "never existed" here would turn the page into a
 * way of testing addresses, so it does not.
 */
function InvalidInvitation() {
  return (
    <>
      <h1 className="text-section font-semibold text-fg">This invitation is no longer valid</h1>
      <p className="mb-6 mt-1.5 text-body text-fg-muted">
        The link may have expired, already been used, or been cancelled. Ask whoever invited
        you to send a new one.
      </p>
      <Button asChild variant="secondary">
        <Link href="/login">Back to sign in</Link>
      </Button>
    </>
  );
}
