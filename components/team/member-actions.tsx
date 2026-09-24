"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, PenLine, ShieldOff, UserCheck, UserMinus } from "lucide-react";

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
        toast({ title: MESSAGES[action] });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  const menuItems: { action: StatusAction; label: string; icon: React.ReactNode }[] = [
    ...(may.canSuspend
      ? [{ action: "suspend" as const, label: "Suspend access", icon: <ShieldOff /> }]
      : []),
    ...(may.canDeactivate
      ? [{ action: "deactivate" as const, label: "Deactivate member", icon: <UserMinus /> }]
      : []),
  ];

  return (
    <>
      {may.canEditMembership ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/team/${member.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canUnsuspend ? (
        <Button size="sm" onClick={() => run("unsuspend")} disabled={pending}>
          <UserCheck aria-hidden="true" />
          {pending ? "Working…" : "Lift suspension"}
        </Button>
      ) : null}

      {may.canReactivate ? (
        <Button size="sm" onClick={() => run("reactivate")} disabled={pending}>
          <UserCheck aria-hidden="true" />
          {pending ? "Working…" : "Reactivate"}
        </Button>
      ) : null}

      {menuItems.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${name}`}>
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
          confirming === "suspend" ? `Suspend ${name}?` : `Deactivate ${name}?`
        }
        description={describe(confirming, guards)}
        confirmLabel={confirming === "suspend" ? "Suspend access" : "Deactivate member"}
        pending={pending}
        onConfirm={() => confirming && run(confirming)}
      />
    </>
  );
}

const MESSAGES: Record<StatusAction, string> = {
  deactivate: "Member deactivated. Their sessions have ended.",
  reactivate: "Member reactivated.",
  suspend: "Access suspended. Their sessions have ended.",
  unsuspend: "Suspension lifted.",
};

function describe(action: StatusAction | null, guards: TeamMemberDetailDTO["guards"]): string {
  if (guards.lastActiveOwner) {
    return "This is the company's last active Owner. Assign another active Owner before changing their access.";
  }

  const warnings: string[] = [];
  if (action === "deactivate" && guards.managedActiveProjects > 0) {
    warnings.push(
      `They manage ${guards.managedActiveProjects} active project${
        guards.managedActiveProjects === 1 ? "" : "s"
      }, which must be reassigned first.`,
    );
  }
  if (guards.openAssignedTasks > 0) {
    warnings.push(
      `${guards.openAssignedTasks} open task${
        guards.openAssignedTasks === 1 ? " stays" : "s stay"
      } assigned to them.`,
    );
  }

  const base =
    action === "suspend"
      ? "They are signed out immediately and cannot sign in until the suspension is lifted. Nothing they created is removed."
      : "They are signed out immediately and lose access to this company. Their assignments, approvals and comments stay in place, and they can be reactivated later.";

  return warnings.length > 0 ? `${warnings.join(" ")} ${base}` : base;
}
