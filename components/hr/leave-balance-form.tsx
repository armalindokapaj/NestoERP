"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { setLeaveBalanceAction } from "@/lib/actions/hr";
import { LEAVE_TYPES } from "@/lib/modules/hr/hr.schema";
import { leaveTypeLabels } from "@/lib/modules/hr/hr.status";

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
  memberId,
  year,
  employeeName,
}: {
  memberId: string;
  year: number;
  employeeName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);

    startTransition(async () => {
      const result = await setLeaveBalanceAction(memberId, formData);
      if (result.ok) {
        setOpen(false);
        toast({ title: result.message ?? "Leave balance saved.", tone: "success" });
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden="true" />
        Set entitlement
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Leave entitlement</DialogTitle>
          <DialogDescription>
            {employeeName}&rsquo;s entitlement for a leave year. Days already used are calculated
            from approved leave and cannot be typed here.
          </DialogDescription>

          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="balance-leaveType">Leave type</Label>
                <select id="balance-leaveType" name="leaveType" className={selectClass} defaultValue="ANNUAL">
                  {LEAVE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {leaveTypeLabels[type]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="balance-year">Year</Label>
                <Input
                  id="balance-year"
                  name="year"
                  inputMode="numeric"
                  required
                  defaultValue={String(year)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="balance-entitledDays">Entitled days</Label>
                <Input
                  id="balance-entitledDays"
                  name="entitledDays"
                  inputMode="decimal"
                  required
                  placeholder="20"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="balance-adjustmentDays">Adjustment</Label>
                <Input
                  id="balance-adjustmentDays"
                  name="adjustmentDays"
                  inputMode="decimal"
                  placeholder="0"
                />
                <p className="text-meta text-fg-subtle">
                  Carry-over or a correction. Can be negative.
                </p>
              </div>
            </div>

            {error ? (
              <p role="alert" className="text-meta text-danger-strong">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save entitlement"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
