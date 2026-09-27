"use client";

import * as React from "react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Takes a model out of the Experience: a confirmation, never a typed reason
 * (Experience Editor no-reason PRD §12, §15). It detaches only — its versions
 * and files stay in the Model Library, and a published release keeps showing it
 * until the next release; it just stops asking for a version when publishing.
 * Who removed it, and when, is audited by the server.
 */
export function RemoveModelDialog({ projectId, slot, onOpenChange, onRemoved }: {
  projectId: string;
  slot: { id: string; displayName: string } | null;
  onOpenChange: (open: boolean) => void;
  onRemoved: (slotId: string) => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (slot) setError(null);
  }, [slot]);

  async function remove() {
    if (!slot || pending) return;
    setPending(true);
    setError(null);
    try {
      await engineeringApi(`/api/platform/3d/projects/${projectId}/slots/${slot.id}`, { method: "DELETE" });
      onRemoved(slot.id);
      onOpenChange(false);
    } catch (failure) {
      setError(failureMessage(failure, "The model could not be removed."));
    } finally {
      setPending(false);
    }
  }

  const name = slot?.displayName ?? "This model";
  return (
    <ConfirmDialog
      open={slot !== null}
      onOpenChange={(open) => { if (!pending) onOpenChange(open); }}
      title="Remove model?"
      description={`${name} will be removed from this 3D Experience. Its files stay in the Model Library, and the published viewer keeps showing it until the next release is published.`}
      confirmLabel="Remove"
      pending={pending}
      onConfirm={() => void remove()}
    >
      {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
    </ConfirmDialog>
  );
}
