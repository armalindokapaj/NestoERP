"use client";

import * as React from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * A destructive or consequential action behind an explicit confirmation
 * (MOB-04 §61, §62). It docks to the bottom on a phone and centres from `sm`.
 *
 *   <ConfirmAction open onOpenChange title="Delete Unit A-120?" description="This action cannot be undone."
 *     confirmLabel="Delete Unit" run={() => deleteUnit(id)} />
 *
 * `run` is awaited and the button stays disabled meanwhile, so a second tap
 * cannot send the action twice (§50). A refusal keeps the dialog open and shows
 * the message; only a committed answer (`ok: true`) closes it. The consequence
 * is stated in `description` — routine low-risk deletes do not ask for a typed
 * name; a high-risk entity passes `children` with what it will affect.
 */
export type ConfirmRun = () => Promise<{ ok: true } | { ok: false; error: string }> | { ok: true } | { ok: false; error: string };

export function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = true,
  run,
  onDone,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  run: ConfirmRun;
  onDone?: () => void;
  children?: React.ReactNode;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await run();
      if (result.ok) {
        onOpenChange(false);
        onDone?.();
      } else {
        setError(result.error);
      }
    } catch {
      // The request may or may not have been committed: say so, keep the dialog.
      setError("We could not confirm this was done. Check the record before trying again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      destructive={destructive}
      pending={pending}
      onConfirm={confirm}
    >
      {children}
      {error ? (
        <p role="alert" className="mt-3 text-table text-danger-strong" data-testid="confirm-error">
          {error}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}
