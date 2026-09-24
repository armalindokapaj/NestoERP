"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { rfqLifecycleAction, type RfqLifecycleAction } from "@/lib/actions/procurement";
import type { RfqDetailDTO } from "@/lib/modules/procurement/procurement.types";

/** What a reader may do to an enquiry (PRD #19 §73–§77). */
export function RfqActions({ rfq }: { rfq: RfqDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<"none" | "issue" | "close" | "cancel">("none");

  const may = rfq.capabilities;

  function run(action: RfqLifecycleAction, success: string, note?: string) {
    startTransition(async () => {
      const result = await rfqLifecycleAction(rfq.id, action, note);
      if (result.ok) {
        setDialog("none");
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
          <Link href={`/procurement/rfqs/${rfq.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canViewQuotes ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement/rfqs/${rfq.id}/comparison`}>Compare answers</Link>
        </Button>
      ) : null}

      {may.canRecordQuote ? (
        <Button asChild size="sm">
          <Link href={`/procurement/rfqs/${rfq.id}/quotes`}>Record a quote</Link>
        </Button>
      ) : null}

      {may.canIssue ? (
        <Button size="sm" disabled={pending} onClick={() => setDialog("issue")}>
          Issue to suppliers
        </Button>
      ) : null}

      {may.canClose ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("close")}>
          Close
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("cancel")}>
          Cancel
        </Button>
      ) : null}

      <ConfirmDialog
        open={dialog === "issue"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={`Issue ${rfq.rfqNumber}?`}
        description="The lines are fixed once it is issued, because suppliers price what they were sent."
        confirmLabel="Issue enquiry"
        destructive={false}
        pending={pending}
        onConfirm={() => run("issue", "Enquiry issued.")}
      />

      <ConfirmDialog
        open={dialog === "close"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={`Close ${rfq.rfqNumber}?`}
        description="No further answers will be recorded. The quotes already in stay comparable."
        confirmLabel="Close enquiry"
        destructive={false}
        pending={pending}
        onConfirm={() => run("close", "Enquiry closed.")}
      />

      <RejectDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => !open && setDialog("none")}
        title={`Cancel ${rfq.rfqNumber}?`}
        description="The enquiry stays on the record, marked cancelled."
        label="Note"
        placeholder="Why is this no longer being sourced?"
        confirmLabel="Cancel enquiry"
        pendingLabel="Cancelling…"
        emptyMessage="Say why it is being cancelled."
        onReject={async (note) => {
          run("cancel", "Enquiry cancelled.", note);
          return true;
        }}
      />
    </>
  );
}
