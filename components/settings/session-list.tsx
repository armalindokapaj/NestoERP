"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Laptop } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  revokeOtherSessionsAction,
  revokeSessionAction,
  signOutEverywhereAction,
} from "@/lib/actions/account";

export type SessionRow = {
  id: string;
  current: boolean;
  device: string;
  companyName: string;
  ipAddress: string | null;
  /** Formatted on the server, so the browser's timezone cannot cause a hydration mismatch. */
  startedLabel: string;
  expiresLabel: string;
};

/** Where the person is signed in, and a way to end each of those sessions (PRD #38 §20). */
export function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const toast = useToast();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [confirmEverywhere, setConfirmEverywhere] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const others = sessions.filter((session) => !session.current);

  function revoke(sessionId: string) {
    setPendingId(sessionId);
    startTransition(async () => {
      const result = await revokeSessionAction(sessionId);
      setPendingId(null);
      if (!result.ok) toast({ title: t(`profile.errors.${result.code === "NOT_FOUND" ? "NOT_FOUND" : "SAVE_FAILED"}`), tone: "danger" });
      router.refresh();
    });
  }

  function revokeOthers() {
    startTransition(async () => {
      const result = await revokeOtherSessionsAction();
      if (result.ok) {
        toast({ title: t("profile.sessions.othersDone", { count: result.revokedSessions ?? 0 }), tone: "success" });
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-lg border border-line" aria-label={t("profile.sessions.title")}>
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-start gap-3">
              <Laptop aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-table font-medium text-fg">{session.device}</span>
                  {session.current ? <Badge tone="success">{t("profile.sessions.current")}</Badge> : null}
                </div>
                <p className="mt-0.5 text-meta text-fg-subtle">
                  {session.companyName} · {session.ipAddress ?? t("profile.sessions.unknownAddress")}
                </p>
                <p className="mt-0.5 text-meta text-fg-subtle">
                  {t("profile.sessions.started", { date: session.startedLabel })} ·{" "}
                  {t("profile.sessions.expires", { date: session.expiresLabel })}
                </p>
              </div>
            </div>
            {!session.current ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => revoke(session.id)}
                disabled={pending && pendingId === session.id}
              >
                {t("profile.sessions.signOut")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {others.length === 0 ? <p className="text-meta text-fg-subtle">{t("profile.sessions.none")}</p> : null}

      <div className="flex flex-wrap justify-end gap-2">
        {others.length > 0 ? (
          <Button variant="secondary" onClick={revokeOthers} disabled={pending}>
            {t("profile.sessions.signOutOthers")}
          </Button>
        ) : null}
        <Button variant="danger" onClick={() => setConfirmEverywhere(true)} disabled={pending}>
          {t("profile.sessions.signOutEverywhere")}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmEverywhere}
        onOpenChange={setConfirmEverywhere}
        title={t("profile.sessions.confirmEverywhereTitle")}
        description={t("profile.sessions.confirmEverywhereDescription")}
        confirmLabel={t("profile.sessions.signOutEverywhere")}
        cancelLabel={t("profile.sessions.cancel")}
        pending={pending}
        onConfirm={() => startTransition(() => signOutEverywhereAction())}
      />
    </div>
  );
}
