"use client";

import * as React from "react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Takes a model out of the Experience, with the reason the audit trail needs.
 * Its versions stay, and a published release keeps showing it until the next
 * release; it just stops asking for a version when publishing.
 */
export function RemoveModelDialog({ projectId, slot, onOpenChange, onRemoved }: {
  projectId: string;
  slot: { id: string; displayName: string } | null;
  onOpenChange: (open: boolean) => void;
  onRemoved: (slotId: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();

  React.useEffect(() => {
    if (!slot) return;
    setReason("");
    setError(null);
  }, [slot]);

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    if (!slot || pending) return;
    if (reason.trim().length < 3) {
      setError("Give a reason of at least three characters.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await engineeringApi(`/api/platform/3d/projects/${projectId}/slots/${slot.id}`, { method: "DELETE", body: { reason: reason.trim() } });
      onRemoved(slot.id);
      onOpenChange(false);
    } catch (failure) {
      setError(failureMessage(failure, "The model could not be removed."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={slot !== null} onOpenChange={(open) => { if (!pending) onOpenChange(open); }}>
      <DialogContent className="max-w-md">
        <form onSubmit={(event) => void remove(event)} className="space-y-4">
          <DialogTitle>Remove {slot?.displayName ?? "this model"}?</DialogTitle>
          <DialogDescription>
            It leaves the scene and is no longer needed to publish. Its uploaded versions are kept, and the published viewer keeps showing it until the next release is published.
          </DialogDescription>
          <label className="block text-table font-medium text-fg" htmlFor={`${id}-reason`}>
            Reason
            <Input id={`${id}-reason`} className="mt-1.5" value={reason} maxLength={500} autoFocus onChange={(event) => setReason(event.target.value)} placeholder="Why this model is removed" />
          </label>
          {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="danger" disabled={pending}>{pending ? "Removing…" : "Remove model"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
