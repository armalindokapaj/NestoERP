"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { Archive, ArchiveRestore, CircleX, EyeOff, MoreHorizontal, RotateCcw, Send, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { failureOutcome } from "@/components/project-planning/use-values-editor";
import { REVISION_REASON_MAX, type UnitPublishingDTO } from "@/lib/modules/project-structure/unit-publishing.types";
import { Field, FormError, failureMessage, structureApi } from "../structure-ui";

/**
 * What the reader may do to a unit's publication (E-05D §7, §21-§23, §31, §32,
 * §46, §47). Only permitted actions are offered; the server decides each one
 * again. A publish or a submission the unit is not ready for is not silently
 * disabled: the button explains what is missing (§46).
 */

type Dialogs = "missing" | "revision" | "unpublish" | "archive" | "restore" | null;

export function PublishingActions({ unitId, unitCode, version, publishing }: { unitId: string; unitCode: string; version: number; publishing: UnitPublishingDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState<Dialogs>(null);
  const [missingFor, setMissingFor] = React.useState<"publish" | "submit">("publish");
  const [pending, setPending] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  // A reason sent without an answer back: it may have been applied (AUD-03 §6).
  const [unconfirmed, setUnconfirmed] = React.useState(false);
  const { status, capabilities: can, readiness, pendingRequest, hasUnpublishedChanges } = publishing;

  const published = status === "PUBLISHED";
  const changesWaiting = published && pendingRequest !== null;
  const offerSubmit = can.canSubmit && (status === "DRAFT" || status === "REVISION_REQUIRED" || (published && hasUnpublishedChanges && !pendingRequest));
  const offerPublish = can.canPublish && status !== "ARCHIVED" && (!published || hasUnpublishedChanges);
  const offerRevision = can.canRequestRevision && (status === "READY_FOR_PUBLISHING" || published);
  const offerUnpublish = can.canUnpublish && published;
  const offerArchive = can.canArchive && status !== "ARCHIVED";
  const offerRestore = can.canRestore && status === "ARCHIVED";

  async function run(label: string, url: string, body: Record<string, unknown>, success: string) {
    setPending(true);
    setFormError(null);
    try {
      await structureApi(url, { body });
      setUnconfirmed(false);
      toast({ title: success });
      setOpen(null);
      setReason("");
      router.refresh();
    } catch (error) {
      setUnconfirmed(failureOutcome(error).kind === "unknown");
      const message = failureMessage(error, `${label} did not work. Try again.`);
      if (open === "revision" || open === "unpublish") setFormError(message);
      else {
        setOpen(null);
        toast({ title: message, tone: "danger" });
      }
    } finally {
      setPending(false);
    }
  }

  function submit() {
    if (!readiness.ready) {
      setMissingFor("submit");
      return setOpen("missing");
    }
    void run("Submitting", `/api/project-units/${unitId}/submit-for-publishing`, { expectedVersion: version }, published ? `The changes to ${unitCode} are waiting for review.` : `${unitCode} is ready for publishing.`);
  }

  function publish() {
    if (!readiness.ready) {
      setMissingFor("publish");
      return setOpen("missing");
    }
    void run("Publishing", `/api/project-units/${unitId}/publish`, { expectedVersion: version }, published ? `${unitCode} published as a new version.` : `${unitCode} published.`);
  }

  const menu = offerUnpublish || offerArchive || offerRestore;
  if (!offerSubmit && !offerPublish && !offerRevision && !menu) return null;

  return (
    <>
      {offerSubmit ? (
        <Button variant={offerPublish ? "secondary" : "primary"} onClick={submit} disabled={pending}>
          <Send aria-hidden="true" />
          {published ? "Submit changes" : "Submit for Publishing"}
        </Button>
      ) : null}
      {offerPublish ? (
        <Button onClick={publish} disabled={pending}>
          <Upload aria-hidden="true" />
          {published ? "Publish changes" : "Publish"}
        </Button>
      ) : null}
      {offerRevision ? (
        <Button variant="secondary" onClick={() => setOpen("revision")} disabled={pending}>
          <RotateCcw aria-hidden="true" />
          {changesWaiting ? "Return changes" : "Revision Required"}
        </Button>
      ) : null}
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More publishing actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {offerUnpublish ? (
              <DropdownMenuItem onSelect={() => setOpen("unpublish")}>
                <EyeOff aria-hidden="true" /> Unpublish
              </DropdownMenuItem>
            ) : null}
            {offerArchive ? (
              <DropdownMenuItem onSelect={() => setOpen("archive")}>
                <Archive aria-hidden="true" /> Archive
              </DropdownMenuItem>
            ) : null}
            {offerRestore ? (
              <DropdownMenuItem onSelect={() => setOpen("restore")}>
                <ArchiveRestore aria-hidden="true" /> Restore
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Dialog open={open === "missing"} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="max-w-md" data-testid="not-ready-dialog">
          <DialogTitle>{missingFor === "publish" ? `${unitCode} cannot be published yet` : `${unitCode} cannot be submitted yet`}</DialogTitle>
          <DialogDescription>Complete these first:</DialogDescription>
          <ul className="mt-3 space-y-2">
            {readiness.items
              .filter((item) => !item.ok)
              .map((item) => (
                <li key={item.key} className="flex items-start gap-2 text-table">
                  <CircleX className="mt-0.5 size-4 shrink-0 text-danger-strong" aria-hidden="true" />
                  <span>
                    <span className="font-medium text-fg">{item.label}</span>
                    {item.hint ? <span className="block text-meta text-fg-muted">{item.hint}</span> : null}
                  </span>
                </li>
              ))}
          </ul>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={open === "revision" || open === "unpublish"}
        onOpenChange={(value) => {
          // Reached only through the guarded close: what was discarded is gone (AUD-03 §5).
          if (!value) {
            setOpen(null);
            setFormError(null);
            setReason("");
            setUnconfirmed(false);
          }
        }}
        title={open === "unpublish" ? `Unpublish ${unitCode}?` : changesWaiting ? `Return the changes to ${unitCode}` : `Revision Required for ${unitCode}`}
        description={
          open === "unpublish"
            ? "The unit goes back to Ready for Publishing and stops being available downstream. Every published version stays in its history."
            : changesWaiting
              ? "The published version stays live. The changes go back to be corrected."
              : published
                ? "The unit stops being published until it is corrected and published again."
                : "The unit goes back to the people preparing it, with your reason."
        }
        confirmLabel={open === "unpublish" ? "Unpublish" : changesWaiting ? "Return changes" : "Send back"}
        reason={reason}
        onReason={setReason}
        pending={pending}
        unconfirmed={unconfirmed}
        error={formError}
        onConfirm={() =>
          open === "unpublish"
            ? void run("Unpublishing", `/api/project-units/${unitId}/unpublish`, { reason, expectedVersion: version }, `${unitCode} unpublished.`)
            : void run("Asking for a revision", `/api/project-units/${unitId}/revision-required`, { reason, expectedVersion: version }, changesWaiting ? `The changes to ${unitCode} were returned.` : `${unitCode} was sent back for revision.`)
        }
      />

      <ConfirmDialog
        open={open === "archive"}
        onOpenChange={(value) => !value && setOpen(null)}
        title={`Archive ${unitCode}?`}
        description="The unit leaves every normal workflow. Its page, documents and published versions are kept, and it can be restored."
        confirmLabel="Archive"
        pending={pending}
        onConfirm={() => void run("Archiving", `/api/project-units/${unitId}/archive`, { expectedVersion: version }, `${unitCode} archived.`)}
      />
      <ConfirmDialog
        open={open === "restore"}
        onOpenChange={(value) => !value && setOpen(null)}
        title={`Restore ${unitCode}?`}
        description="The unit returns to what it was before it was archived. A unit that was waiting for review comes back as a Draft."
        confirmLabel="Restore"
        destructive={false}
        pending={pending}
        onConfirm={() => void run("Restoring", `/api/project-units/${unitId}/restore`, { expectedVersion: version }, `${unitCode} restored.`)}
      />
    </>
  );
}

function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  reason,
  onReason,
  pending,
  unconfirmed,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  reason: string;
  onReason: (value: string) => void;
  pending: boolean;
  unconfirmed: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => (pending ? null : onOpenChange(value))}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <ReasonForm confirmLabel={confirmLabel} reason={reason} onReason={onReason} pending={pending} unconfirmed={unconfirmed} error={error} onConfirm={onConfirm} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The reason, as a workflow editor (AUD-03 §3): only the step itself — send
 * back, unpublish — finishes it, so closing with a reason typed asks, and Save
 * and continue is never offered.
 */
function ReasonForm({
  confirmLabel,
  reason,
  onReason,
  pending,
  unconfirmed,
  error,
  onConfirm,
}: {
  confirmLabel: string;
  reason: string;
  onReason: (value: string) => void;
  pending: boolean;
  unconfirmed: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const [touched, setTouched] = React.useState(false);
  const editor = useUnsavedEditor({ module: "units", saveKind: "none", workflow: confirmLabel, label: `${confirmLabel}: reason` });
  const { setDirty, setSaving, setUnresolved } = editor;
  React.useEffect(() => setDirty(reason !== ""), [reason, setDirty]);
  React.useEffect(() => setSaving(pending), [pending, setSaving]);
  React.useEffect(() => setUnresolved(unconfirmed), [unconfirmed, setUnresolved]);
  const blank = reason.trim() === "";
  return (
    <form
      className="mt-4 space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!blank) onConfirm();
      }}
    >
      <FormError message={error} />
      <Field label="Reason" htmlFor="publishing-reason" required error={touched && blank ? "Give a reason." : undefined}>
        <Textarea id="publishing-reason" value={reason} onChange={(event) => onReason(event.target.value)} rows={4} maxLength={REVISION_REASON_MAX} autoFocus aria-invalid={touched && blank} />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Working…" : confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
