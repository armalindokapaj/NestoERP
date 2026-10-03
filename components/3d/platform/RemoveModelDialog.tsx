"use client";

import * as React from "react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useTranslations } from "@/components/i18n/i18n-provider";

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
  const t = useTranslations("adminPlatform");
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
      setError(failureMessage(failure, t("threeDAdmin.removeModel.failed")));
    } finally {
      setPending(false);
    }
  }

  const name = slot?.displayName ?? t("threeDAdmin.removeModel.thisModel");
  return (
    <ConfirmDialog
      open={slot !== null}
      onOpenChange={(open) => { if (!pending) onOpenChange(open); }}
      title={t("threeDAdmin.removeModel.title")}
      description={t("threeDAdmin.removeModel.description", { name })}
      confirmLabel={t("threeDAdmin.removeModel.confirm")}
      pending={pending}
      onConfirm={() => void remove()}
    >
      {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
    </ConfirmDialog>
  );
}
