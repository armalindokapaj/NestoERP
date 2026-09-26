"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { Plus } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
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
  const [open, setOpen] = React.useState(false);

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

          {/* Inside the dialog, so its guarded close asks about the choice (AUD-03 §5). */}
          <InviteForm
            rfqId={rfqId}
            suppliers={suppliers}
            invitedSupplierIds={invitedSupplierIds}
            onInvited={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The choice is dropped with the dialog. Inviting is the only way forward, so
 * the editor is workflow-only: Save and continue never invites (AUD-03 §3).
 */
function InviteForm({
  rfqId,
  suppliers,
  invitedSupplierIds,
  onInvited,
}: {
  rfqId: string;
  suppliers: { value: string; label: string }[];
  invitedSupplierIds: string[];
  onInvited: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = React.useState(false);
  const [supplierId, setSupplierId] = React.useState("");
  const editor = useUnsavedEditor({ module: "procurement", saveKind: "none", workflow: "Invite", label: "Supplier invitation" });
  const { setDirty, setSaving, setUnresolved } = editor;

  React.useEffect(() => setDirty(supplierId !== ""), [supplierId, setDirty]);

  const invited = new Set(invitedSupplierIds);
  const available = suppliers.filter((supplier) => !invited.has(supplier.value));

  async function invite() {
    if (!supplierId || pending) return;

    setPending(true);
    setSaving(true);
    try {
      const result = await inviteSupplierAction(rfqId, supplierId);
      if (result.ok) {
        setUnresolved(false);
        setDirty(false);
        onInvited();
        toast({ title: "Supplier invited to quote.", tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    } catch {
      // It may or may not have gone through: say so, never repeat it (§6).
      setUnresolved(true);
      toast({ title: OUTCOME_COPY.unknown, tone: "danger" });
    } finally {
      setPending(false);
      setSaving(false);
    }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="invite-supplier">Supplier</Label>
        <select
          id="invite-supplier"
          className={selectClass}
          value={supplierId}
          disabled={available.length === 0 || pending}
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
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button disabled={pending || !supplierId} onClick={invite}>
          {pending ? "Inviting…" : "Invite"}
        </Button>
      </DialogFooter>
    </>
  );
}
