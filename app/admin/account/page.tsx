import type { Metadata } from "next";

import { PasswordForm } from "@/components/settings/password-form";
import { SessionList } from "@/components/settings/session-list";
import { RecoveryEmailForm } from "@/components/platform/recovery-email-form";
import { Badge } from "@/components/ui/badge";
import { PageHeaderFrame } from "@/components/ui/page-header";
import {
  changePlatformPasswordAction,
  revokePlatformOtherSessionsAction,
  revokePlatformSessionAction,
  signOutPlatformEverywhereAction,
} from "@/lib/actions/platform-account";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { formatDateTime } from "@/lib/i18n/format";
import { getPlatformAccount } from "@/lib/modules/platform/platform-account.service";
import { getLocale, getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAccess");
  return { title: t("account.metaTitle") };
}

/**
 * The Platform Admin's own account (ADM-01): recovery email, password and
 * sessions. Personal security lives here, reached from the name in the top
 * bar, rather than among the console's administrative destinations.
 */
export default async function PlatformAccountPage() {
  const locale = await getLocale();
  const t = await getTranslations("adminAccess");
  const context = await requirePlatformContext();
  const account = await getPlatformAccount(context);

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeaderFrame kind="page" title={t("account.title")} subtitle={<>{account.fullName} · <span className="font-mono not-italic">{account.username}</span></>} />

      <section className="nesto-card p-6" aria-labelledby="recovery-title">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="recovery-title" className="nesto-section-head">{t("account.recoveryHeading")}</h2>
          {account.recoveryEmail ? <Badge tone="success">{t("account.verified")}</Badge> : <Badge tone="warning">{t("account.notSet")}</Badge>}
        </div>
        <p className="mt-1 text-table text-fg-muted">
          {account.recoveryEmail
            ? t("account.recoveryWith", { email: account.recoveryEmail, date: formatDateTime(account.recoveryEmailVerifiedAt!, locale) })
            : t("account.recoveryWithout")}
        </p>
        {account.pendingRecoveryEmail ? (
          <p role="status" className="mt-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-table text-fg-muted">
            {t("account.pending", { email: account.pendingRecoveryEmail.email, date: formatDateTime(account.pendingRecoveryEmail.expiresAt, locale) })}
          </p>
        ) : null}
        <div className="mt-4">
          <RecoveryEmailForm hasCurrent={Boolean(account.recoveryEmail)} />
        </div>
      </section>

      <section className="nesto-card p-6" aria-labelledby="password-title">
        <h2 id="password-title" className="nesto-section-head">{t("account.passwordHeading")}</h2>
        <p className="mt-1 text-table text-fg-muted">{t("account.passwordNote")}</p>
        <div className="mt-4">
          <PasswordForm action={changePlatformPasswordAction} />
        </div>
      </section>

      <section className="nesto-card p-6" aria-labelledby="sessions-title">
        <h2 id="sessions-title" className="nesto-section-head">{t("account.sessionsHeading")}</h2>
        <div className="mt-4">
          <SessionList
            actions={{ revokeOne: revokePlatformSessionAction, revokeOthers: revokePlatformOtherSessionsAction, everywhere: signOutPlatformEverywhereAction }}
            sessions={account.sessions.map((session) => ({
              id: session.id,
              current: session.current,
              device: session.device,
              companyName: null,
              startedLabel: formatDateTime(session.createdAt, locale),
              expiresLabel: formatDateTime(session.expiresAt, locale),
            }))}
          />
        </div>
      </section>
    </div>
  );
}
