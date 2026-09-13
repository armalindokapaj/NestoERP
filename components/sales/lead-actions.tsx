"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowRightLeft, CheckCircle2, PenLine, PhoneCall, RotateCcw, XCircle } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { AssignMemberControl } from "@/components/modules/assign-member-control";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  assignLeadAction,
  disqualifyLeadAction,
  leadLifecycleAction,
  type LeadLifecycleAction,
} from "@/lib/actions/sales";
import type { LeadDetailDTO } from "@/lib/modules/sales/sales.types";

/**
 * Actions on a lead (PRD #17 §48–§57, §294).
 *
 * Capabilities are hints: the server re-checks every one of them, so a stale
 * page cannot qualify a lead somebody else has already converted (PRD #17 §56).
 */
export function LeadActions({ lead }: { lead: LeadDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [archiving, setArchiving] = React.useState(false);
  const [disqualifying, setDisqualifying] = React.useState(false);

  const may = lead.capabilities;

  function run(action: LeadLifecycleAction, success: string) {
    startTransition(async () => {
      const result = await leadLifecycleAction(lead.id, action);
      setArchiving(false);
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
          <Link href={`/sales/leads/${lead.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canAssign ? (
        <AssignMemberControl
          endpoint="/api/sales/assignable"
          currentMemberId={lead.owner?.memberId ?? null}
          triggerLabel="Reassign"
          title="Assign this lead"
          description="The owner is who follows it up, and whose pipeline it counts towards."
          onAssign={async (memberId) => {
            const result = await assignLeadAction(lead.id, memberId);
            return { ok: result.ok, message: result.ok ? "Lead reassigned." : result.error };
          }}
        />
      ) : null}

      {may.canMarkContacted ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => run("contacted", "Contact recorded.")}
          disabled={pending}
        >
          <PhoneCall aria-hidden="true" />
          Mark contacted
        </Button>
      ) : null}

      {may.canQualify ? (
        <Button size="sm" onClick={() => run("qualify", "Lead qualified.")} disabled={pending}>
          <CheckCircle2 aria-hidden="true" />
          {pending ? "Working…" : "Qualify"}
        </Button>
      ) : null}

      {may.canConvert ? (
        <Button asChild size="sm">
          <Link href={`/sales/leads/${lead.id}/convert`}>
            <ArrowRightLeft aria-hidden="true" />
            Convert
          </Link>
        </Button>
      ) : null}

      {may.canDisqualify ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDisqualifying(true)}
          disabled={pending}
        >
          <XCircle aria-hidden="true" />
          Disqualify
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
          onClick={() => run("restore", "Lead restored.")}
          disabled={pending}
        >
          <RotateCcw aria-hidden="true" />
          Restore
        </Button>
      ) : null}

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title="Archive this lead?"
        description="It leaves the working list. Restoring it later returns it to the status it holds now."
        confirmLabel="Archive lead"
        destructive={false}
        pending={pending}
        onConfirm={() => run("archive", "Lead archived.")}
      />

      <RejectDialog
        open={disqualifying}
        onOpenChange={setDisqualifying}
        title="Disqualify this lead?"
        description="The reason stays on the lead, so the lost-lead picture is worth reading later."
        label="Why it went nowhere"
        placeholder="No budget this year, duplicate enquiry, wrong fit…"
        confirmLabel="Disqualify"
        pendingLabel="Disqualifying…"
        emptyMessage="Say why it went nowhere, so the record is worth keeping."
        onReject={async (reason) => {
          const result = await disqualifyLeadAction(lead.id, reason);
          if (result.ok) {
            toast({ title: "Lead disqualified." });
            setDisqualifying(false);
            router.refresh();
          } else {
            toast({ title: result.error, tone: "danger" });
          }
          return result.ok;
        }}
      />
    </>
  );
}
