"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import Link from "@/components/navigation/nav-link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { Project3DModelUsage } from "@/lib/modules/project-3d/project-3d.model-library";

type State =
  | { step: "closed" }
  | { step: "checking" }
  | { step: "ready"; usage: Project3DModelUsage }
  | { step: "failed"; message: string };

/**
 * Permanent delete from the Model Library (Experience Editor no-reason PRD
 * §13-§15, §19). A strong confirmation — never a typed reason — after reading
 * what still uses the version. Anything that would break blocks the delete and
 * points at the place to resolve it; the server re-checks on delete.
 */
export function DeleteModelVersionButton({ versionId, fileName }: { versionId: string; fileName: string }) {
  const [state, setState] = React.useState<State>({ step: "closed" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function open() {
    setError(null);
    setState({ step: "checking" });
    try {
      const usage = await engineeringApi<Project3DModelUsage>(`/api/platform/3d/models/${versionId}/usage`);
      setState({ step: "ready", usage });
    } catch (failure) {
      setState({ step: "failed", message: failureMessage(failure, "Where this model is used could not be checked.") });
    }
  }

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await engineeringApi(`/api/platform/3d/models/${versionId}`, { method: "DELETE", body: { confirmPermanentDelete: true } });
      setState({ step: "closed" });
      toast({ title: `${fileName} deleted permanently.`, tone: "success" });
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure, "The model could not be deleted."));
    } finally {
      setPending(false);
    }
  }

  const close = (next: boolean) => { if (!next && !pending) setState({ step: "closed" }); };
  const usage = state.step === "ready" ? state.usage : null;
  const blocked = usage !== null && usage.blockers.length > 0;

  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="text-danger-strong" onClick={() => void open()} disabled={state.step === "checking"} aria-label={`Delete ${fileName} permanently`}>
        <Trash2 aria-hidden="true" />{state.step === "checking" ? "Checking…" : "Delete"}
      </Button>

      <ConfirmDialog
        open={usage !== null && !blocked}
        onOpenChange={close}
        title={`Delete ${fileName} permanently?`}
        description="This action cannot be undone. The model file and its prepared version are removed from storage."
        confirmLabel="Delete permanently"
        pending={pending}
        onConfirm={() => void remove()}
      >
        {usage ? (
          <ul className="list-disc space-y-1 pl-5 text-table text-fg-muted">
            <li>{usage.model.name} · version {usage.version}, in {usage.experience.name}</li>
            <li>{usage.bindingCount === 0 ? "No unit links." : `${usage.bindingCount} unit ${usage.bindingCount === 1 ? "link is" : "links are"} removed with it.`}</li>
            <li>Not part of any published release.</li>
          </ul>
        ) : null}
        {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
      </ConfirmDialog>

      <Dialog open={blocked || state.step === "failed"} onOpenChange={close}>
        <DialogContent className="max-w-md">
          <DialogTitle>{state.step === "failed" ? "Could not check this model" : `${fileName} is still in use`}</DialogTitle>
          <DialogDescription>{state.step === "failed" ? state.message : blockedExplanation(usage!)}</DialogDescription>
          <DialogFooter>
            <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
            {usage?.blockers.includes("RELEASED") ? (
              <Button asChild variant="secondary"><Link href={`/admin/3d/projects/${usage.experience.projectId}/releases`}>View usages</Link></Button>
            ) : null}
            {usage?.blockers.includes("SHOWN_IN_EXPERIENCE") ? (
              <Button asChild><Link href={`/admin/3d/projects/${usage.experience.projectId}/models`}>Remove from this Experience</Link></Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function blockedExplanation(usage: Project3DModelUsage): string {
  const reasons: string[] = [];
  if (usage.blockers.includes("RELEASED")) {
    reasons.push(usage.releases.length
      ? `It is part of published release ${usage.releases.join(", ")}, which must stay restorable.`
      : "It is part of a published release, which must stay restorable.");
  }
  if (usage.blockers.includes("SHOWN_IN_EXPERIENCE")) reasons.push(`${usage.experience.name} still shows it. Remove the model from the Experience, or upload a newer version, first.`);
  if (usage.blockers.includes("IN_PROGRESS")) reasons.push("It is still uploading or being prepared.");
  return `${reasons.join(" ")} Nothing was deleted.`;
}
