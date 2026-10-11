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
import { useTranslations } from "@/components/i18n/i18n-provider";
import { useProcurementServerText, useProcurementTranslations } from "./procurement-text";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useProcurementTranslations();

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        {t("invite.button")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t("invite.title")}</DialogTitle>
          <DialogDescription>
            {t("invite.description")}
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
  const t = useProcurementTranslations();
  const serverText = useProcurementServerText();
  const tCommon = useTranslations("common");
  const [pending, setPending] = React.useState(false);
  const [supplierId, setSupplierId] = React.useState("");
  const editor = useUnsavedEditor({ module: "procurement", saveKind: "none", workflow: t("invite.invite"), label: t("invite.editorLabel") });
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
        toast({ title: t("invite.invited"), tone: "success" });
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
      }
    } catch {
      // It may or may not have gone through: say so, never repeat it (§6).
      setUnresolved(true);
      toast({ title: tCommon("outcomeUnknown") === "outcomeUnknown" ? OUTCOME_COPY.unknown : tCommon("outcomeUnknown"), tone: "danger" });
    } finally {
      setPending(false);
      setSaving(false);
    }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="invite-supplier">{t("common.supplier")}</Label>
        <FormSelect
          id="invite-supplier"
          className={selectClass}
          value={supplierId}
          disabled={available.length === 0 || pending}
          onChange={(event) => setSupplierId(event.target.value)}
        >
          <option value="">
            {available.length === 0 ? t("invite.allInvited") : t("common.chooseSupplier")}
          </option>
          {available.map((supplier) => (
            <option key={supplier.value} value={supplier.value}>
              {supplier.label}
            </option>
          ))}
        </FormSelect>
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{t("common.cancel")}</Button>
        </DialogClose>
        <Button disabled={pending || !supplierId} onClick={invite}>
          {pending ? t("invite.inviting") : t("invite.invite")}
        </Button>
      </DialogFooter>
    </>
  );
}
