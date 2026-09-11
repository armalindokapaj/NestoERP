"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Rejecting a finance record (PRD #15 §306, §146).
 *
 * The reason is required, not optional. "Rejected" on its own tells the person
 * who submitted it nothing they can act on, and the reason becomes part of the
 * record's permanent approval history.
 */
export function RejectDialog({
  open,
  onOpenChange,
  title,
  onReject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
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
      setError("Say why it was rejected, so it can be corrected.");
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
        <DialogDescription>
          The reason is recorded against the approval and shown to whoever submitted it.
        </DialogDescription>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              rows={4}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What needs to change before this can be approved?"
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
              {pending ? "Rejecting…" : "Reject"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
