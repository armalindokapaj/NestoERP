"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { X } from "lucide-react";

import { failureMessage, structureApi } from "@/components/project-structure/structure-ui";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

/** Takes a unit the deal does not hold out of it (E-05E §18). The server refuses one it holds. */
export function DealUnitRemove({ opportunityId, unitId, unitCode }: { opportunityId: string; unitId: string; unitCode: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function remove() {
    setPending(true);
    try {
      await structureApi(`/api/sales/opportunities/${opportunityId}/units/${unitId}`, { method: "DELETE" });
      toast({ title: `${unitCode} was removed from the opportunity.` });
      router.refresh();
    } catch (error) {
      toast({ title: failureMessage(error, "The unit could not be removed."), tone: "danger" });
    } finally {
      setPending(false);
      setOpen(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${unitCode} from the opportunity`} onClick={() => setOpen(true)}>
        <X />
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={`Remove ${unitCode}?`} description="The unit leaves this opportunity. The unit itself and its sales history are unchanged." confirmLabel="Remove" pending={pending} onConfirm={() => void remove()} />
    </>
  );
}
