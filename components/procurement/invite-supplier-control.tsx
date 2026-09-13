"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { inviteSupplierAction } from "@/lib/actions/procurement";

/**
 * Asking one more supplier to quote (PRD #19 §84).
 *
 * The list is the module's own selectable suppliers — active, in this company —
 * resolved on the server and passed in, because who may be asked is a
 * procurement decision rather than something the browser should work out.
 *
 * Suppliers already invited are filtered out here as a courtesy; the service
 * refuses a duplicate invitation regardless.
 */
export function InviteSupplierControl({
  rfqId,
  suppliers,
  invitedSupplierIds,
}: {
  rfqId: string;
  suppliers: { value: string; label: string }[];
  invitedSupplierIds: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [supplierId, setSupplierId] = React.useState("");

  const invited = new Set(invitedSupplierIds);
  const available = suppliers.filter((supplier) => !invited.has(supplier.value));

  function invite() {
    if (!supplierId) return;

    startTransition(async () => {
      const result = await inviteSupplierAction(rfqId, supplierId);
      if (result.ok) {
        setOpen(false);
        setSupplierId("");
        toast({ title: "Supplier invited to quote.", tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Invite supplier
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>Invite a supplier</DialogTitle>
          <DialogDescription>
            They are added to this request and can be sent it with the others.
          </DialogDescription>

          <div className="space-y-1.5">
            <Label htmlFor="invite-supplier">Supplier</Label>
            <select
              id="invite-supplier"
              className={selectClass}
              value={supplierId}
              disabled={available.length === 0}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">
                {available.length === 0 ? "Everyone available is already invited" : "Choose a supplier"}
              </option>
              {available.map((supplier) => (
                <option key={supplier.value} value={supplier.value}>
                  {supplier.label}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || !supplierId} onClick={invite}>
              {pending ? "Inviting…" : "Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
