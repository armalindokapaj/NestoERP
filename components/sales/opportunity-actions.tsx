"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { Archive, PenLine, RotateCcw, Trophy, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { AssignMemberControl } from "@/components/modules/assign-member-control";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  assignOpportunityAction,
  opportunityLifecycleAction,
  type OpportunityLifecycleAction,
} from "@/lib/actions/sales";
import type { OpportunityDetailDTO } from "@/lib/modules/sales/sales.types";

/**
 * Actions on an opportunity (PRD #17 §84–§97, §294).
 *
 * Winning and losing are routes rather than buttons: both need a close date and
 * a decision about the client, and a dialog that fired from one click would be
 * the wrong shape for either (PRD #17 §84, §253).
 */
export function OpportunityActions({ opportunity }: { opportunity: OpportunityDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [archiving, setArchiving] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);

  const may = opportunity.capabilities;

  function run(action: OpportunityLifecycleAction, success: string) {
    startTransition(async () => {
      const result = await opportunityLifecycleAction(opportunity.id, action);
      setArchiving(false);
      setReopening(false);
      if (result.ok) {
        toast({ title: success, tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/sales/opportunities/${opportunity.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canAssign ? (
        <AssignMemberControl
          endpoint="/api/sales/assignable"
          currentMemberId={opportunity.owner?.memberId ?? null}
          triggerLabel="Reassign"
          title="Assign this opportunity"
          description="The owner is who carries the deal, and whose pipeline it counts towards."
          onAssign={async (memberId) => {
            const result = await assignOpportunityAction(opportunity.id, memberId);
            return {
              ok: result.ok,
              message: result.ok ? "Opportunity reassigned." : result.error,
            };
          }}
        />
      ) : null}

      {may.canMarkWon ? (
        <Button asChild size="sm">
          <Link href={`/sales/opportunities/${opportunity.id}/won`}>
            <Trophy aria-hidden="true" />
            Mark won
          </Link>
        </Button>
      ) : null}

      {may.canMarkLost ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/sales/opportunities/${opportunity.id}/lost`}>
            <XCircle aria-hidden="true" />
            Mark lost
          </Link>
        </Button>
      ) : null}

      {may.canReopen ? (
        <Button variant="secondary" size="sm" onClick={() => setReopening(true)} disabled={pending}>
          <RotateCcw aria-hidden="true" />
          Reopen
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" onClick={() => setArchiving(true)} disabled={pending}>
          <Archive aria-hidden="true" />
          Archive
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => run("restore", "Opportunity restored.")}
          disabled={pending}
        >
          <RotateCcw aria-hidden="true" />
          Restore
        </Button>
      ) : null}

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title="Archive this opportunity?"
        description="It leaves the pipeline. Its commercial outcome is preserved, and restoring it returns it to the stage it holds now."
        confirmLabel="Archive opportunity"
        destructive={false}
        pending={pending}
        onConfirm={() => run("archive", "Opportunity archived.")}
      />

      <ConfirmDialog
        open={reopening}
        onOpenChange={setReopening}
        title="Reopen this opportunity?"
        description="It returns to Qualified, and the close date and lost reason are cleared."
        confirmLabel="Reopen"
        destructive={false}
        pending={pending}
        onConfirm={() => run("reopen", "Opportunity reopened.")}
      />
    </>
  );
}
