"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { MoreHorizontal, PenLine, ShieldOff, UserCheck, UserMinus } from "lucide-react";

import { useTeamServerText, useTeamTranslations } from "@/components/team/team-text";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { memberStatusAction } from "@/lib/actions/team";
import type { TeamMemberDetailDTO } from "@/lib/modules/team/team.types";
import type { Translate } from "@/lib/i18n/translator";

type StatusAction = "deactivate" | "reactivate" | "suspend" | "unsuspend";

/**
 * Membership actions (PRD #14 §97–§111).
 *
 * Deactivate and suspend are confirmed, and the confirmation says what the
 * person loses and what survives — sessions end immediately, while their
 * history of assignments, approvals and comments stays (PRD #14 §103, §242).
 *
 * Guards are shown before the press, not as an error afterwards. The service
 * enforces the same rules regardless (PRD #14 §93, §102, §148).
 */
export function MemberActions({ member }: { member: TeamMemberDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const t = useTeamTranslations();
  const serverText = useTeamServerText();
  const [confirming, setConfirming] = React.useState<StatusAction | null>(null);
  const [pending, startTransition] = React.useTransition();

  const may = member.capabilities;
  const guards = member.guards;
  const name = member.profile.fullName;

  function run(action: StatusAction) {
    startTransition(async () => {
      const result = await memberStatusAction(member.id, action);
      setConfirming(null);
      if (result.ok) {
        toast({ title: t(MESSAGES[action]) });
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
      }
    });
  }

  const menuItems: { action: StatusAction; label: string; icon: React.ReactNode }[] = [
    ...(may.canSuspend
      ? [{ action: "suspend" as const, label: t("actions.suspendAccess"), icon: <ShieldOff /> }]
      : []),
    ...(may.canDeactivate
      ? [{ action: "deactivate" as const, label: t("actions.deactivateMember"), icon: <UserMinus /> }]
      : []),
  ];

  return (
    <>
      {may.canEditMembership ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/team/${member.id}/edit`}>
            <PenLine aria-hidden="true" />
            {t("actions.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canUnsuspend ? (
        <Button size="sm" onClick={() => run("unsuspend")} disabled={pending}>
          <UserCheck aria-hidden="true" />
          {pending ? t("actions.working") : t("actions.liftSuspension")}
        </Button>
      ) : null}

      {may.canReactivate ? (
        <Button size="sm" onClick={() => run("reactivate")} disabled={pending}>
          <UserCheck aria-hidden="true" />
          {pending ? t("actions.working") : t("actions.reactivate")}
        </Button>
      ) : null}

      {menuItems.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("actions.moreFor", { name })}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menuItems.map((item) => (
              <DropdownMenuItem
                key={item.action}
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirming(item.action);
                }}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={
          confirming === "suspend" ? t("actions.suspendTitle", { name }) : t("actions.deactivateTitle", { name })
        }
        description={describe(t, confirming, guards)}
        confirmLabel={confirming === "suspend" ? t("actions.suspendAccess") : t("actions.deactivateMember")}
        pending={pending}
        onConfirm={() => confirming && run(confirming)}
      />
    </>
  );
}

const MESSAGES = {
  deactivate: "actions.deactivated",
  reactivate: "actions.reactivated",
  suspend: "actions.suspended",
  unsuspend: "actions.unsuspended",
} as const satisfies Record<StatusAction, string>;

function describe(t: Translate<"team">, action: StatusAction | null, guards: TeamMemberDetailDTO["guards"]): string {
  if (guards.lastActiveOwner) {
    return t(guards.lastActiveRole === "CEO" ? "actions.lastCeo" : "actions.lastOwner");
  }

  const warnings: string[] = [];
  if (action === "deactivate" && guards.managedActiveProjects > 0) {
    warnings.push(t("actions.managedProjects", { count: guards.managedActiveProjects }));
  }
  if (guards.openAssignedTasks > 0) {
    warnings.push(t("actions.openTasks", { count: guards.openAssignedTasks }));
  }

  const base =
    action === "suspend"
      ? t("actions.suspendBase")
      : t("actions.deactivateBase");

  return warnings.length > 0 ? `${warnings.join(" ")} ${base}` : base;
}
