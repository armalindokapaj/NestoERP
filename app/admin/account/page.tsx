import type { Metadata } from "next";

import { PasswordForm } from "@/components/settings/password-form";
import { SessionList } from "@/components/settings/session-list";
import { RecoveryEmailForm } from "@/components/platform/recovery-email-form";
import { Badge } from "@/components/ui/badge";
import {
  changePlatformPasswordAction,
  revokePlatformOtherSessionsAction,
  revokePlatformSessionAction,
  signOutPlatformEverywhereAction,
} from "@/lib/actions/platform-account";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getPlatformAccount } from "@/lib/modules/platform/platform-account.service";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "My Account & Security" };

/**
 * The Platform Admin's own account (ADM-01): recovery email, password and
 * sessions. Personal security lives here, reached from the name in the top
 * bar, rather than among the console's administrative destinations.
 */
export default async function PlatformAccountPage() {
  const context = await requirePlatformContext();
  const account = await getPlatformAccount(context);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-page font-semibold text-fg">My Account & Security</h1>
        <p className="mt-1 text-body text-fg-muted">
          {account.fullName} · <span className="font-mono text-meta">{account.username}</span>
        </p>
      </div>

      <section className="nesto-card p-6" aria-labelledby="recovery-title">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="recovery-title" className="text-card font-semibold text-fg">Recovery email</h2>
          {account.recoveryEmail ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not set</Badge>}
        </div>
        <p className="mt-1 text-table text-fg-muted">
          {account.recoveryEmail
            ? `Password-recovery links go to ${account.recoveryEmail}, verified ${formatDateTime(account.recoveryEmailVerifiedAt!)}.`
            : "Without a verified recovery email, a forgotten password can only be reset by another Platform Admin."}
        </p>
        {account.pendingRecoveryEmail ? (
          <p role="status" className="mt-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-table text-fg-muted">
            Waiting for {account.pendingRecoveryEmail.email} to be confirmed. The link expires {formatDateTime(account.pendingRecoveryEmail.expiresAt)}; until then the current address stays in use.
          </p>
        ) : null}
        <div className="mt-4">
          <RecoveryEmailForm hasCurrent={Boolean(account.recoveryEmail)} />
        </div>
      </section>

      <section className="nesto-card p-6" aria-labelledby="password-title">
        <h2 id="password-title" className="text-card font-semibold text-fg">Password</h2>
        <p className="mt-1 text-table text-fg-muted">Changing it signs out your other sessions.</p>
        <div className="mt-4">
          <PasswordForm action={changePlatformPasswordAction} />
        </div>
      </section>

      <section className="nesto-card p-6" aria-labelledby="sessions-title">
        <h2 id="sessions-title" className="text-card font-semibold text-fg">Sessions</h2>
        <div className="mt-4">
          <SessionList
            actions={{ revokeOne: revokePlatformSessionAction, revokeOthers: revokePlatformOtherSessionsAction, everywhere: signOutPlatformEverywhereAction }}
            sessions={account.sessions.map((session) => ({
              id: session.id,
              current: session.current,
              device: session.device,
              companyName: null,
              startedLabel: formatDateTime(session.createdAt),
              expiresLabel: formatDateTime(session.expiresAt),
            }))}
          />
        </div>
      </section>
    </div>
  );
}
