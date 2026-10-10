"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, useDialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { setLeaveBalanceAction } from "@/lib/actions/hr";
import { LEAVE_TYPES } from "@/lib/modules/hr/hr.schema";
import { hrLabel, useHrServerText, useHrTranslations } from "./hr-text";
import { FormSelect } from "@/components/ui/form-select";

const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

/**
 * Set a leave entitlement by hand (PRD #16 §81, §217).
 *
 * There is no accrual engine in V0.1, and `usedDays` is not on this form at
 * all: days used are derived from approved leave, and letting anybody type a
 * number over them is how a balance stops matching the requests behind it
 * (PRD #16 §218).
 */
export function LeaveBalanceForm({
  employeeId,
  year,
  employeeName,
}: {
  employeeId: string;
  year: number;
  employeeName: string;
}) {
  const [open, setOpen] = React.useState(false);
  const t = useHrTranslations();

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden="true" />
        {t("balanceForm.set")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{t("balanceForm.title")}</DialogTitle>
          <DialogDescription>
            {t("balanceForm.description", { name: employeeName })}
          </DialogDescription>

          {/* Inside the dialog, so its guarded close asks about the entries (AUD-03 §5). */}
          <EntitlementForm employeeId={employeeId} year={year} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The entitlement under the unsaved-work contract (AUD-03 §3, §6): dirty
 * against what it opened with, one request per submission, and a refusal keeps
 * every value. Closing after a committed save needs no question — it is clean.
 */
function EntitlementForm({ employeeId, year, onDone }: { employeeId: string; year: number; onDone: () => void }) {
  const t = useHrTranslations();
  const serverText = useHrServerText();
  const router = useRouter();
  const toast = useToast();
  const close = useDialogClose();
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => setLeaveBalanceAction(employeeId, formData),
    module: "hr",
    saveKind: "save",
    label: t("balanceForm.title"),
    onCommitted: (result, mode) => {
      toast({ title: serverText(result?.message) ?? t("server.leaveBalanceSaved"), tone: "success" });
      if (mode === "normal") onDone();
      router.refresh();
      return true;
    },
  });
  const { pending } = save;

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="mt-4 space-y-3">
      <SaveMessages save={save} />
      <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 border-0 p-0">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="balance-leaveType">{t("reports.leaveType")}</Label>
          <FormSelect id="balance-leaveType" name="leaveType" className={selectClass} defaultValue="ANNUAL">
            {LEAVE_TYPES.map((type) => (
              <option key={type} value={type}>
                {hrLabel(t, "leaveType", type)}
              </option>
            ))}
          </FormSelect>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="balance-year">{t("balanceForm.year")}</Label>
          <Input
            id="balance-year"
            name="year"
            inputMode="numeric"
            required
            defaultValue={String(year)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="balance-entitledDays">{t("balanceForm.entitledDays")}</Label>
          <Input
            id="balance-entitledDays"
            name="entitledDays"
            inputMode="decimal"
            required
            placeholder="20"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="balance-adjustmentDays">{t("balanceForm.adjustment")}</Label>
          <Input
            id="balance-adjustmentDays"
            name="adjustmentDays"
            inputMode="decimal"
            placeholder="0"
          />
          <p className="text-meta text-fg-subtle">
            {t("balanceForm.adjustmentHint")}
          </p>
        </div>
      </div>

      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <UnsavedIndicator save={save} className="mr-auto" />
        <Button type="button" variant="secondary" onClick={close} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("balanceForm.save")}
        </Button>
      </div>
    </form>
  );
}
