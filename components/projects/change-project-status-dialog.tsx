"use client";

import * as React from "react";

import { announcementApi, failureMessage, isFailure } from "@/components/announcements/announcement-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { WorkingStatus } from "@/lib/modules/projects/project.machine";
import { cn } from "@/lib/utils/cn";

/**
 * Change Status (E-05A §12, §40).
 *
 * Offers only the moves the server said this project can make, for this
 * person. Going back to Pending corrects a status set too early, and asks why —
 * the same rule the server enforces. It lives on the project's own page: the
 * Projects page's card menu keeps to opening, starring and sharing (Projects
 * Workspace Grid §56, §57).
 */
export function ChangeProjectStatusDialog({
  project,
  statusMoves,
  open,
  onOpenChange,
  onChanged,
}: {
  project: { id: string; name: string; companyName: string } | null;
  statusMoves: readonly WorkingStatus[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (projectId: string, status: WorkingStatus) => void;
}) {
  // The next step first; going back to Pending is a correction, so it comes last
  // and is never the choice the dialog opens on.
  const moves = React.useMemo(
    () => [...statusMoves].sort((a, b) => Number(a === "PENDING") - Number(b === "PENDING")),
    [statusMoves],
  );

  if (!project) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted per opening: every opening starts on the first move with no reason. */}
        <StatusForm project={project} moves={moves} onChanged={onChanged} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The status form. Its only way forward is the status change itself, so it
 * takes part in the unsaved-work contract as a workflow editor (AUD-03 §3):
 * closing with a reason typed asks, and Save and continue never changes a
 * status.
 */
function StatusForm({
  project,
  moves,
  onChanged,
  onDone,
}: {
  project: { id: string; name: string; companyName: string };
  moves: readonly WorkingStatus[];
  onChanged: (projectId: string, status: WorkingStatus) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const t = useTranslations("projects");
  const [choice, setChoice] = React.useState<WorkingStatus | null>(moves[0] ?? null);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const editor = useUnsavedEditor({ module: "projects", saveKind: "none", workflow: "Change status", label: t("statusDialog.editorLabel", { name: project.name }) });
  const { setDirty, setSaving, setUnresolved } = editor;

  React.useEffect(() => setDirty(choice !== (moves[0] ?? null) || reason !== ""), [choice, reason, moves, setDirty]);

  const needsReason = choice === "PENDING";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!choice) return;
    if (needsReason && !reason.trim()) {
      setError(t("statusDialog.reasonRequired"));
      return;
    }
    setPending(true);
    setSaving(true);
    setError(null);
    try {
      await announcementApi(`/api/projects/${project.id}/status`, { method: "PATCH", body: { status: choice, reason: reason.trim() || undefined } });
      setUnresolved(false);
      setDirty(false);
      onChanged(project.id, choice);
      toast({ title: t("statusDialog.changed", { name: project.name, status: t(`status.${choice}`) }) });
      onDone();
    } catch (failure) {
      // A lost connection may have changed the status: its outcome is unknown (AUD-03 §6).
      setUnresolved(!isFailure(failure) || failure.status === 0);
      setError(failureMessage(failure, t("statusDialog.failed")));
    } finally {
      setPending(false);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="pr-6">
        <DialogTitle>{t("statusDialog.title")}</DialogTitle>
        <DialogDescription>
          {project.name} · {project.companyName}
        </DialogDescription>
      </div>

      <fieldset className="space-y-2" disabled={pending}>
        <legend className="sr-only">{t("statusDialog.newStatus")}</legend>
        {moves.map((status) => (
          <label
            key={status}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors",
              choice === status ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong",
            )}
          >
            <input
              type="radio"
              name="status"
              value={status}
              checked={choice === status}
              onChange={() => setChoice(status)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span>
              <span className="block text-body font-medium text-fg">{t(`status.${status}`)}</span>
              <span className="block text-table text-fg-muted">{t(`statusDialog.${status}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="status-reason">
          {t("statusDialog.reason")}{needsReason ? <span className="ml-0.5 text-danger-strong">*</span> : <span className="ml-1 font-normal text-fg-subtle">{t("statusDialog.optional")}</span>}
        </Label>
        <Textarea id="status-reason" rows={3} maxLength={500} value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} placeholder={t("statusDialog.reasonPlaceholder")} />
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {t("statusDialog.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending || !choice}>
          {pending ? t("statusDialog.saving") : t("statusDialog.title")}
        </Button>
      </DialogFooter>
    </form>
  );
}
