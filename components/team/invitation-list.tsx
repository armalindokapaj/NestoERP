"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { MailCheck, MailWarning, RotateCw, X } from "lucide-react";

import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { useTeamServerText, useTeamTranslations } from "@/components/team/team-text";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cancelInvitationAction, resendInvitationAction } from "@/lib/actions/team";
import type { InvitationDTO } from "@/lib/modules/team/team.types";
import { formatDate } from "@/lib/utils/format";

/**
 * Whether the latest email for an open invitation arrived at the provider.
 * A failure is shown where the person who can fix it — by resending — will see
 * it (PRD #38 §21).
 */
function DeliveryNote({ delivery }: { delivery: InvitationDTO["delivery"] }) {
  const t = useTeamTranslations();
  if (!delivery) return null;
  if (delivery.status === "FAILED") {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-meta text-danger-strong">
        <MailWarning aria-hidden="true" className="size-3.5" />
        {t("invitations.deliveryFailed")}
      </p>
    );
  }
  if (delivery.status === "SUPPRESSED") {
    return (
      <p className="mt-0.5 text-meta text-warning-strong">
        {t("invitations.suppressed")}
      </p>
    );
  }
  if (delivery.status === "SENT") {
    return <p className="mt-0.5 text-meta text-fg-subtle">{t("invitations.emailSent", { date: formatDate(delivery.at) })}</p>;
  }
  return null;
}

/**
 * Pending and settled invitations (PRD #14 §68, §69, §70).
 *
 * Resend and cancel are only ever offered on an invitation that is still open:
 * an accepted or cancelled one is history, and history does not have buttons.
 * The service re-checks the same thing (PRD #14 §233, §237).
 */
export function InvitationList({
  invitations,
  canResend,
  canCancel,
}: {
  invitations: InvitationDTO[];
  canResend: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const t = useTeamTranslations();
  const serverText = useTeamServerText();
  const toast = useToast();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState<InvitationDTO | null>(null);
  const [busy, startTransition] = React.useTransition();

  function resend(invite: InvitationDTO) {
    setPendingId(invite.id);
    startTransition(async () => {
      const result = await resendInvitationAction(invite.id);
      setPendingId(null);
      if (result.ok) {
        toast({
          title: result.delivered
            ? t("invitations.resent", { email: result.email })
            : t("invitations.freshLink", { email: result.email }),
          tone: result.delivered ? "success" : "warning",
        });
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
      }
    });
  }

  function cancel() {
    const invite = cancelling;
    if (!invite) return;
    setPendingId(invite.id);
    startTransition(async () => {
      const result = await cancelInvitationAction(invite.id);
      setPendingId(null);
      setCancelling(null);
      if (result.ok) {
        toast({ title: t("invitations.cancelled") });
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      <ul className="nesto-card divide-y divide-line">
        {invitations.map((invite) => {
          const open = invite.status === "PENDING";
          const expired = invite.status === "EXPIRED";
          const rowBusy = busy && pendingId === invite.id;

          return (
            <li
              key={invite.id}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-table font-medium text-fg">{invite.email}</span>
                  <StatusBadge status={invite.status} />
                </div>
                <p className="mt-1 text-meta text-fg-subtle">
                  {invite.role.name}
                  {invite.department ? ` · ${invite.department.name}` : ""}
                  {invite.jobTitle ? ` · ${invite.jobTitle}` : ""}
                </p>
                <p className="mt-0.5 text-meta text-fg-subtle">
                  {t("invitations.invited", { date: formatDate(invite.invitedAt) })} {invite.invitedBy ? <PersonLink memberId={invite.invitedByMemberId} name={invite.invitedBy} /> : "—"} ·{" "}
                  {expired ? t("invitations.expired") : t("invitations.expires")} {formatDate(invite.expiresAt)}
                </p>
                {open || expired ? <DeliveryNote delivery={invite.delivery} /> : null}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* Resending an expired invitation is the ordinary fix, so it
                    stays available after expiry (PRD #14 §69, §236). */}
                {canResend && (open || expired) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => resend(invite)}
                    disabled={rowBusy}
                  >
                    <RotateCw aria-hidden="true" />
                    {rowBusy ? t("invitations.sending") : t("invitations.resend")}
                  </Button>
                ) : null}

                {canCancel && open ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("invitations.cancelFor", { email: invite.email ?? "" })}
                    onClick={() => setCancelling(invite)}
                    disabled={rowBusy}
                  >
                    <X />
                  </Button>
                ) : null}

                {invite.status === "ACCEPTED" ? (
                  <MailCheck aria-hidden="true" className="size-4 text-success-strong" />
                ) : null}
                {invite.status === "CANCELLED" ? (
                  <MailWarning aria-hidden="true" className="size-4 text-fg-subtle" />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open) setCancelling(null);
        }}
        title={cancelling ? t("invitations.cancelTitle", { email: cancelling.email ?? "" }) : t("invitations.cancelInvitation")}
        description={t("invitations.cancelDescription")}
        confirmLabel={t("invitations.cancelInvitation")}
        pending={busy}
        onConfirm={cancel}
      />
    </>
  );
}
