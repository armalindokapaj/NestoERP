"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";
import { Archive, ArchiveRestore, CircleX, EyeOff, RotateCcw, Send, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { EntityActionSheet } from "@/components/detail/entity-action-sheet";
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
  const t = useTranslations("projects");
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
      const message = failureMessage(error, t("publishing.failed", { label }));
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
    void run(t("publishing.submitting"), `/api/project-units/${unitId}/submit-for-publishing`, { expectedVersion: version }, published ? t("publishing.changesWaiting", { code: unitCode }) : t("publishing.readyForPublishing", { code: unitCode }));
  }

  function publish() {
    if (!readiness.ready) {
      setMissingFor("publish");
      return setOpen("missing");
    }
    void run(t("publishing.publishingLabel"), `/api/project-units/${unitId}/publish`, { expectedVersion: version }, published ? t("publishing.publishedNewVersion", { code: unitCode }) : t("publishing.published", { code: unitCode }));
  }

  const menu = offerUnpublish || offerArchive || offerRestore;
  if (!offerSubmit && !offerPublish && !offerRevision && !menu) return null;

  return (
    <>
      {offerSubmit ? (
        <Button variant={offerPublish ? "secondary" : "primary"} onClick={submit} disabled={pending}>
          <Send aria-hidden="true" />
          {published ? t("publishing.submitChanges") : t("publishing.submitForPublishing")}
        </Button>
      ) : null}
      {offerPublish ? (
        <Button onClick={publish} disabled={pending}>
          <Upload aria-hidden="true" />
          {published ? t("publishing.publishChanges") : t("publishing.publish")}
        </Button>
      ) : null}
      {offerRevision ? (
        <Button variant="secondary" onClick={() => setOpen("revision")} disabled={pending}>
          <RotateCcw aria-hidden="true" />
          {changesWaiting ? t("publishing.returnChanges") : t("publishing.revisionRequired")}
        </Button>
      ) : null}
      {menu ? (
        // One action list on every width: a sheet on a phone, the dropdown from md (MOB-04 §79).
        <EntityActionSheet
          name={unitCode}
          actions={[
            ...(offerUnpublish ? [{ key: "unpublish", label: t("publishing.unpublish"), icon: <EyeOff aria-hidden="true" />, onSelect: () => setOpen("unpublish") }] : []),
            ...(offerRestore ? [{ key: "restore", label: t("publishing.restore"), icon: <ArchiveRestore aria-hidden="true" />, onSelect: () => setOpen("restore") }] : []),
            ...(offerArchive ? [{ key: "archive", label: t("publishing.archive"), icon: <Archive aria-hidden="true" />, destructive: true, onSelect: () => setOpen("archive") }] : []),
          ]}
        />
      ) : null}

      <Dialog open={open === "missing"} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="max-w-md" data-testid="not-ready-dialog">
          <DialogTitle>{missingFor === "publish" ? t("publishing.cannotPublish", { code: unitCode }) : t("publishing.cannotSubmit", { code: unitCode })}</DialogTitle>
          <DialogDescription>{t("publishing.completeFirst")}</DialogDescription>
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
              <Button>{t("publishing.close")}</Button>
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
        title={open === "unpublish" ? t("publishing.unpublishTitle", { code: unitCode }) : changesWaiting ? t("publishing.returnTitle", { code: unitCode }) : t("publishing.revisionTitle", { code: unitCode })}
        description={
          open === "unpublish"
            ? t("publishing.unpublishBody")
            : changesWaiting
              ? t("publishing.returnBody")
              : published
                ? t("publishing.revisionPublishedBody")
                : t("publishing.revisionBody")
        }
        confirmLabel={open === "unpublish" ? t("publishing.unpublish") : changesWaiting ? t("publishing.returnChanges") : t("publishing.sendBack")}
        reason={reason}
        onReason={setReason}
        pending={pending}
        unconfirmed={unconfirmed}
        error={formError}
        onConfirm={() =>
          open === "unpublish"
            ? void run(t("publishing.unpublishing"), `/api/project-units/${unitId}/unpublish`, { reason, expectedVersion: version }, t("publishing.unpublished", { code: unitCode }))
            : void run(t("publishing.askingRevision"), `/api/project-units/${unitId}/revision-required`, { reason, expectedVersion: version }, changesWaiting ? t("publishing.returned", { code: unitCode }) : t("publishing.sentBack", { code: unitCode }))
        }
      />

      <ConfirmDialog
        open={open === "archive"}
        onOpenChange={(value) => !value && setOpen(null)}
        title={t("publishing.archiveTitle", { code: unitCode })}
        description={t("publishing.archiveBody")}
        confirmLabel={t("publishing.archive")}
        pending={pending}
        onConfirm={() => void run(t("publishing.archiving"), `/api/project-units/${unitId}/archive`, { expectedVersion: version }, t("publishing.archived", { code: unitCode }))}
      />
      <ConfirmDialog
        open={open === "restore"}
        onOpenChange={(value) => !value && setOpen(null)}
        title={t("publishing.restoreTitle", { code: unitCode })}
        description={t("publishing.restoreBody")}
        confirmLabel={t("publishing.restore")}
        destructive={false}
        pending={pending}
        onConfirm={() => void run(t("publishing.restoring"), `/api/project-units/${unitId}/restore`, { expectedVersion: version }, t("publishing.restored", { code: unitCode }))}
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
  const t = useTranslations("projects");
  const [touched, setTouched] = React.useState(false);
  const editor = useUnsavedEditor({ module: "units", saveKind: "none", workflow: confirmLabel, label: t("publishing.reasonLabel", { action: confirmLabel }) });
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
      <Field label={t("publishing.reason")} htmlFor="publishing-reason" required error={touched && blank ? t("publishing.reasonRequired") : undefined}>
        <Textarea id="publishing-reason" value={reason} onChange={(event) => onReason(event.target.value)} rows={4} maxLength={REVISION_REASON_MAX} autoFocus aria-invalid={touched && blank} />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {t("publishing.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? t("publishing.working") : confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
