"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cancelRequestAction } from "@/lib/actions/qaqc";
import type { RequestDetailDTO } from "@/lib/modules/qaqc/qaqc.types";
import { AssignControl } from "./assign-control";

/** What a reader may do to an inspection request (PRD #21 §44–§48). */
export function RequestActions({ request }: { request: RequestDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [cancelling, setCancelling] = React.useState(false);

  const may = request.capabilities;

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/qaqc/requests/${request.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canStartInspection ? (
        <Button asChild size="sm">
          <Link href={`/qaqc/inspections/new?requestId=${request.id}`}>Start an inspection</Link>
        </Button>
      ) : null}

      {may.canAssign ? <AssignControl kind="request" recordId={request.id} /> : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setCancelling(true)}>
          Cancel
        </Button>
      ) : null}

      <RejectDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${request.requestNumber}?`}
        description="The request stays on the record as cancelled. Anything already inspected against it is unaffected."
        label="Reason"
        placeholder="Why is it being cancelled?"
        confirmLabel="Cancel request"
        pendingLabel="Cancelling…"
        emptyMessage="Say why it is being cancelled."
        onReject={async (reason) => {
          let ok = false;
          await new Promise<void>((resolve) => {
            startTransition(async () => {
              const result = await cancelRequestAction(request.id, reason);
              if (result.ok) {
                ok = true;
                setCancelling(false);
                toast({ title: "Request cancelled.", tone: "success" });
                router.refresh();
              } else {
                toast({ title: result.error, tone: "danger" });
              }
              resolve();
            });
          });
          return ok;
        }}
      />
    </>
  );
}
