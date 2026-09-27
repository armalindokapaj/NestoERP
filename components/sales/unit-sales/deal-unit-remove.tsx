"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { X } from "lucide-react";

import { failureMessage, structureApi } from "@/components/project-structure/structure-ui";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useSalesTranslations } from "@/components/sales/sales-text";

/** Takes a unit the deal does not hold out of it (E-05E §18). The server refuses one it holds. */
export function DealUnitRemove({ opportunityId, unitId, unitCode }: { opportunityId: string; unitId: string; unitCode: string }) {
  const router = useRouter();
  const toast = useToast();
  const t = useSalesTranslations();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function remove() {
    setPending(true);
    try {
      await structureApi(`/api/sales/opportunities/${opportunityId}/units/${unitId}`, { method: "DELETE" });
      toast({ title: t("unitSales.removed", { unit: unitCode }) });
      router.refresh();
    } catch (error) {
      toast({ title: failureMessage(error, t("unitSales.removeFailed")), tone: "danger" });
    } finally {
      setPending(false);
      setOpen(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={t("unitSales.removeLabel", { unit: unitCode })} onClick={() => setOpen(true)}>
        <X />
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={t("unitSales.removeTitle", { unit: unitCode })} description={t("unitSales.removeDescription")} confirmLabel={t("unitSales.remove")} pending={pending} onConfirm={() => void remove()} />
    </>
  );
}
