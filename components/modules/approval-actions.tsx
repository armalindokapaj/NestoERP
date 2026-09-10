"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Ban } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { decideRecordAction } from "@/lib/actions/records";

/**
 * The approval shell's controls (PRD #7 §50, §51).
 *
 * Rendered only when the person holds the granular approve permission *and*
 * the record is genuinely awaiting a decision. A button disabled because a
 * record is already approved is legitimate workflow state; a button disabled
 * because of missing permission is not, and is simply absent (PRD #5 §32).
 */
export function ApprovalActions({
  moduleKey,
  section,
  recordId,
  labels = { approve: "Approve", reject: "Reject" },
}: {
  moduleKey: string;
  section: string;
  recordId: string;
  labels?: { approve: string; reject: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  function decide(decision: "APPROVE" | "REJECT") {
    startTransition(async () => {
      const result = await decideRecordAction(moduleKey, section, recordId, decision);
      if (result.ok) {
        toast({
          title: decision === "APPROVE" ? `${labels.approve}d.` : `${labels.reject}ed.`,
        });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => decide("APPROVE")} disabled={pending}>
        <BadgeCheck aria-hidden="true" />
        {labels.approve}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => decide("REJECT")} disabled={pending}>
        <Ban aria-hidden="true" />
        {labels.reject}
      </Button>
    </>
  );
}
