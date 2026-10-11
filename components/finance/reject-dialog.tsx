"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, useDialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";

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
 * submitted it" on a dialog where nobody submitted anything. What a caller
 * leaves out reads from the frame dictionary: the dialog opens under every
 * module, and only the frame is there in all of them.
 *
 * A typed reason is unsaved work, and its only way forward is the workflow
 * step itself (AUD-03 §3): the dialog registers as workflow-only, so every
 * close — X, Escape, the backdrop, Cancel — asks first, including while the
 * step is running, and "Save and continue" never rejects anything. A refused
 * close keeps the reason; it is dropped only with the dialog, after an
 * approved close or a step that went through.
 */
export function RejectDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  confirmLabel,
  pendingLabel,
  emptyMessage,
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
  const t = useTranslations("ui");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description ?? t("rejectDescription")}</DialogDescription>

        {/* Inside the dialog, so the editor belongs to its guarded close (AUD-03 §5). */}
        <ReasonForm
          title={title}
          label={label ?? t("reason")}
          placeholder={placeholder ?? t("rejectPlaceholder")}
          confirmLabel={confirmLabel ?? t("reject")}
          pendingLabel={pendingLabel ?? t("rejecting")}
          emptyMessage={emptyMessage ?? t("rejectEmpty")}
          onReject={onReject}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  title,
  label,
  placeholder,
  confirmLabel,
  pendingLabel,
  emptyMessage,
  onReject,
  onDone,
}: {
  title: string;
  label: string;
  placeholder: string;
  confirmLabel: string;
  pendingLabel: string;
  emptyMessage: string;
  onReject: (reason: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const close = useDialogClose();
  const tUi = useTranslations("ui");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const running = React.useRef(false);
  const editor = useUnsavedEditor({ saveKind: "none", workflow: confirmLabel, label: title });
  const { setDirty, setSaving, setUnresolved } = editor;

  React.useEffect(() => setDirty(reason !== ""), [reason, setDirty]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (running.current) return;

    if (reason.trim().length < 3) {
      setError(emptyMessage);
      return;
    }

    setError(null);
    running.current = true;
    setPending(true);
    setSaving(true);
    let ok = false;
    try {
      ok = await onReject(reason.trim());
    } catch {
      // The step may or may not have happened: say so, never retry it (§6).
      setUnresolved(true);
      setError(OUTCOME_COPY.unknown);
    } finally {
      running.current = false;
      setPending(false);
      setSaving(false);
    }
    if (ok) {
      setUnresolved(false);
      setDirty(false);
      onDone();
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="reject-reason">{label}</Label>
        <Textarea
          id="reject-reason"
          rows={4}
          maxLength={2000}
          value={reason}
          readOnly={pending}
          onChange={(event) => setReason(event.target.value)}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "reject-reason-error" : undefined}
        />
        {/* Announced where it is, beside the field, above a phone's keyboard (AUD-04 §6, MW-15). */}
        {error ? (
          <p id="reject-reason-error" role="alert" className="text-meta text-danger-strong">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* The guarded close, like the X: never a direct setOpen(false) (§5). */}
        <Button type="button" variant="secondary" onClick={close} disabled={pending}>
          {tUi("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </form>
  );
}
