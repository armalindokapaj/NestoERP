"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Turning something down, with a reason (PRD #15 §306, §146, PRD #17 §50, §118).
 *
 * The reason is required, not optional. "Rejected" on its own tells the person
 * who submitted it nothing they can act on, and the reason becomes part of the
 * record's permanent history.
 *
 * The wording is a prop because the same machine serves two different refusals:
 * rejecting a price somebody quoted, and disqualifying a lead nobody is going
 * to win. Defaulting the copy to the approval case would put "shown to whoever
 * submitted it" on a dialog where nobody submitted anything.
 */
export function RejectDialog({
  open,
  onOpenChange,
  title,
  description = "The reason is recorded against the approval and shown to whoever submitted it.",
  label = "Reason",
  placeholder = "What needs to change before this can be approved?",
  confirmLabel = "Reject",
  pendingLabel = "Rejecting…",
  emptyMessage = "Say why it was rejected, so it can be corrected.",
  onReject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  pendingLabel?: string;
  emptyMessage?: string;
  onReject: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  function submit(event: React.FormEvent) {
    event.preventDefault();

    if (reason.trim().length < 3) {
      setError(emptyMessage);
      return;
    }

    setError(null);
    startTransition(async () => {
      const ok = await onReject(reason.trim());
      if (ok) onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">{label}</Label>
            <Textarea
              id="reject-reason"
              rows={4}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={placeholder}
            />
            {error ? <p className="text-meta text-danger-strong">{error}</p> : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
