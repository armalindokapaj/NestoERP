"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { failureMessage, meetingApi } from "./meeting-api";

/**
 * Done / not done for one action, optimistic with rollback (PRD #40 §242).
 * Offered only where the server said this reader may move the action along.
 */
export function ActionStatusToggle({
  meetingId,
  actionId,
  title,
  done,
  disabled,
  onChanged,
}: {
  meetingId: string;
  actionId: string;
  title: string;
  done: boolean;
  disabled?: boolean;
  onChanged?: (detail: unknown) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [checked, setChecked] = React.useState(done);
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => setChecked(done), [done]);

  async function toggle() {
    const next = !checked;
    setChecked(next);
    setPending(true);
    try {
      const detail = await meetingApi(`/api/meetings/${meetingId}/actions/${actionId}`, { method: "PATCH", body: { status: next ? "DONE" : "OPEN" } });
      if (onChanged) onChanged(detail);
      else router.refresh();
    } catch (error) {
      setChecked(!next);
      toast({ title: failureMessage(error, "The action could not be updated."), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? `Mark “${title}” as not done` : `Mark “${title}” as done`}
      disabled={disabled || pending}
      onClick={() => void toggle()}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
        checked ? "border-success-strong bg-success-strong text-white" : "border-line-strong bg-surface hover:border-accent",
        disabled && !checked && "opacity-50",
      )}
    >
      {pending ? <Loader2 aria-hidden="true" className="size-3 animate-spin" /> : checked ? <Check aria-hidden="true" className="size-3.5" /> : null}
    </button>
  );
}
