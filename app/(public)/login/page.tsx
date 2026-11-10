import type { Metadata } from "next";
import Link from "next/link";

import { FocusedFormPage, FocusedHeading } from "@/components/layout/focused-page";
import { isDevMode } from "@/lib/auth/dev-mode";
import { quickLoginSections } from "@/lib/auth/quick-login";
import { getTranslations } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";
import { QuickLogin } from "./quick-login";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("login.metaTitle") };
}

/**
 * Why the person was sent back here (PRD #6 §51, §50).
 *
 * "Your session expired" and "sign in to continue" are different messages, and
 * being told the wrong one is how people conclude software is broken.
 */
const SIGN_IN_NOTICES = {
  "session-expired": "login.sessionExpired",
  "account-unavailable": "login.accountUnavailable",
} as const;

function isSignInNotice(reason: string | undefined): reason is keyof typeof SIGN_IN_NOTICES {
  return reason !== undefined && Object.hasOwn(SIGN_IN_NOTICES, reason);
}

/**
 * Login (spec §7; design spec §83, §84).
 *
 * The focused layout every account page shares (components/layout/focused-page.tsx;
 * UI-02 §7.5, UI-05 §5): the dusk drawing beside a title-block form. Accounts
 * are created by a company's administrator, so the way in for a newcomer is
 * the application, not a sign-up.
 *
 * Authenticated visitors never reach here — middleware sends them to /dashboard.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; reason?: string }>;
}) {
  const { callbackUrl, reason } = await searchParams;
  const [t, tShell] = await Promise.all([getTranslations("auth"), getTranslations("shell")]);
  const notice = isSignInNotice(reason) ? t(SIGN_IN_NOTICES[reason]) : null;

  return (
    <FocusedFormPage homeLabel={tShell("homeLink")}>
      <FocusedHeading title={t("login.title")} description={t("login.description")} />
      {notice ? (
        <p role="status" className="mb-4 border-l-2 border-accent bg-accent-soft px-4 py-3 text-table text-fg">
          {notice}
        </p>
      ) : null}
      <LoginForm callbackUrl={callbackUrl} revealPassword />
      <p className="mt-6 text-table leading-relaxed text-fg-muted">
        {t("login.noAccount")} {t("login.newToNesto")}{" "}
        <Link href="/apply" className="font-medium text-fg underline-offset-4 hover:underline">
          {t("login.apply")} →
        </Link>
      </p>
      {isDevMode ? <QuickLogin sections={await quickLoginSections()} /> : null}
    </FocusedFormPage>
  );
}
