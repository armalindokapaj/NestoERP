"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { Pencil, Plus } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, useDialogClose } from "@/components/ui/dialog";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { REVIEW_STATUS_LABELS } from "@/lib/modules/engineering/engineering.types";
import type { TransmittalDocumentOption } from "@/lib/modules/engineering/engineering.transmittals";
import { unsaved, type SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { engineeringApi, failureMessage, failureOutcome, fieldErrorsOf } from "./engineering-api";
import { FormFields, payloadFor, valuesFor, type FormValues } from "./form-kit";
import { transmittalHeaderFields, type ProjectOptions } from "./record-fields";
import { useEngineeringTranslations } from "./engineering-text";
import { engineeringLabel } from "@/lib/i18n/modules/engineering/labels";

/**
 * Preparing a transmittal (PRD #46 §118-§123): who it goes to and why, and
 * which revisions of which register documents travel on it. It stays a draft
 * until issued; issuing fixes every item and the file version it carried.
 * A draft being prepared is unsaved work: closing the dialog asks (AUD-03 §5).
 */

/**
 * One item on the transmittal. A register revision has both ids; a loose file
 * or a document without a revision has neither or one. `label` names it when
 * it is not among the revisions this dialog can pick (AUD-09 §4, §7, FV-05).
 */
type Selected = { engineeringDocumentId: string | null; engineeringRevisionId: string | null; documentId: string; remarks: string; label?: string };

export function NewTransmittalButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = React.useState(false);
  const t = useEngineeringTranslations();
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)} data-testid="new-transmittal">
        <Plus aria-hidden="true" />
        {t("transmittal.newTransmittal")}
      </Button>
      {open ? <TransmittalDialog projectId={projectId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function EditTransmittalButton({ projectId, transmittal }: { projectId: string; transmittal: { id: string; direction: string; purpose: string; subject: string | null; contractorId: string | null; workPackageId: string | null; senderText: string | null; recipientText: string | null; notes: string | null; items: Selected[] } }) {
  const [open, setOpen] = React.useState(false);
  const t = useEngineeringTranslations();
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="edit-transmittal">
        <Pencil aria-hidden="true" />
        {t("transmittal.editDraft")}
      </Button>
      {open ? <TransmittalDialog projectId={projectId} existing={transmittal} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type TransmittalDialogProps = { projectId: string; existing?: Parameters<typeof EditTransmittalButton>[0]["transmittal"]; onClose: () => void };

function TransmittalDialog(props: TransmittalDialogProps) {
  const [pending, setPending] = React.useState(false);
  const t = useEngineeringTranslations();
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && props.onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto" data-testid="transmittal-form">
        <DialogTitle>{props.existing ? t("transmittal.editTransmittal") : t("transmittal.newTransmittal")}</DialogTitle>
        <DialogDescription>{t("transmittal.dialogBody")}</DialogDescription>
        {/* Inside the dialog, so the editor belongs to its guarded close (AUD-03 §5). */}
        <TransmittalBody {...props} pending={pending} setPending={setPending} />
      </DialogContent>
    </Dialog>
  );
}

function TransmittalBody({ projectId, existing, onClose, pending, setPending }: TransmittalDialogProps & { pending: boolean; setPending: (pending: boolean) => void }) {
  const router = useRouter();
  const close = useDialogClose();
  const t = useEngineeringTranslations();
  const [options, setOptions] = React.useState<ProjectOptions | null>(null);
  const [documents, setDocuments] = React.useState<TransmittalDocumentOption[] | null>(null);
  const [values, setValues] = React.useState<FormValues>({});
  const [baseline, setBaseline] = React.useState<FormValues>({});
  const [selected, setSelected] = React.useState<Selected[]>(existing?.items ?? []);
  const [selectedBaseline, setSelectedBaseline] = React.useState<Selected[]>(existing?.items ?? []);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [outcomeText, setOutcomeText] = React.useState<string | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const running = React.useRef(false);
  // What the dialog opened with. A parent re-render (a refresh while it is
  // open) hands a new object; the header typed so far is not reset by it.
  const opened = React.useRef(existing);

  React.useEffect(() => {
    // The options of this dialog's own request only: a slower, older answer is ignored (AUD-09 §5, FV-08).
    let live = true;
    setLoadFailed(false);
    Promise.all([
      engineeringApi<ProjectOptions>(`/api/projects/${projectId}/engineering/options?for=document`),
      engineeringApi<TransmittalDocumentOption[]>(`/api/projects/${projectId}/transmittals/options`),
    ]).then(
      ([projectOptions, documentOptions]) => {
        if (!live) return;
        setOptions(projectOptions);
        setDocuments(documentOptions);
        const loaded = valuesFor(transmittalHeaderFields(projectOptions, t), opened.current ?? { direction: "OUTGOING", purpose: "FOR_INFORMATION" });
        setValues(loaded);
        setBaseline(loaded);
      },
      () => {
        // "Couldn't load" is its own state with a retry, never an empty list (AUD-09 §5, FV-09).
        if (live) setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
    // `t` only names the fields; a change of language does not reload the choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, attempt]);

  const fields = options ? transmittalHeaderFields(options, t) : [];

  // The header and the picked revisions against what the dialog opened with (AUD-03 §3).
  const run = React.useRef<(mode?: "normal" | "continue") => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({ module: "engineering", saveKind: existing ? "save" : "create", label: existing ? t("transmittal.editTransmittal") : t("transmittal.newTransmittal"), save: () => run.current("continue") });
  const { setDirty, setSaving, setUnresolved } = editor;
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline) || JSON.stringify(selected) !== JSON.stringify(selectedBaseline);
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);

  function toggle(doc: TransmittalDocumentOption, revisionId: string) {
    const revision = doc.revisions.find((item) => item.id === revisionId)!;
    setSelected((current) => {
      const withoutDoc = current.filter((item) => item.engineeringDocumentId !== doc.engineeringDocumentId);
      if (current.some((item) => item.engineeringRevisionId === revisionId)) return withoutDoc;
      return [...withoutDoc, { engineeringDocumentId: doc.engineeringDocumentId, engineeringRevisionId: revision.id, documentId: revision.documentId, remarks: "" }];
    });
  }

  run.current = async (mode: "normal" | "continue" = "normal") => {
    if (running.current || !options) return { kind: "unknown" };
    if (unsaved.frozen) return { kind: "refused" };
    running.current = true;
    setPending(true);
    setSaving(true);
    setError(null);
    setOutcomeText(null);
    setErrors({});
    const body = { ...payloadFor(fields, values), items: selected.map((item) => ({ engineeringDocumentId: item.engineeringDocumentId, engineeringRevisionId: item.engineeringRevisionId, documentId: item.documentId, remarks: item.remarks.trim() || null })) };
    let outcome: SaveOutcome;
    let createdId: string | null = null;
    try {
      if (existing) await engineeringApi(`/api/transmittals/${existing.id}`, { method: "PATCH", body });
      else createdId = (await engineeringApi<{ id: string }>(`/api/projects/${projectId}/transmittals`, { body })).id;
      outcome = { kind: "committed" };
      // Clean before it stops saving, so the page it opens next goes on at once.
      setBaseline(values);
      setSelectedBaseline(selected);
      setDirty(false);
      setUnresolved(false);
    } catch (failure) {
      outcome = failureOutcome(failure);
      setUnresolved(outcome.kind === "unknown");
      setErrors(fieldErrorsOf(failure));
      setError(failureMessage(failure, t("ui.somethingWrong")));
      setOutcomeText(outcome.kind === "unknown" ? OUTCOME_COPY.unknown : null);
    } finally {
      running.current = false;
      setPending(false);
      setSaving(false);
    }
    if (outcome.kind === "committed") {
      if (createdId && mode === "normal") router.push(`/projects/${projectId}/engineering/transmittals/${createdId}`);
      else {
        onClose();
        router.refresh();
      }
    }
    return outcome;
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void run.current("normal");
  }

  // Items this list cannot show — a loose file, a document without a revision, a revision no longer offered.
  const others = selected.filter((item) => !documents?.some((doc) => doc.engineeringDocumentId === item.engineeringDocumentId && doc.revisions.some((revision) => revision.id === item.engineeringRevisionId)));

  if (loadFailed) {
    return (
      <div className="mt-4 space-y-3" role="alert">
        <p className="text-table text-danger-strong">{t("transmittal.loadFailed")}</p>
        <Button type="button" size="sm" variant="secondary" onClick={() => setAttempt((count) => count + 1)}>
          {t("transmittal.retry")}
        </Button>
      </div>
    );
  }

  return options && documents ? (
    <form onSubmit={submit} className="mt-4 space-y-5" noValidate>
      <fieldset disabled={pending} className="m-0 min-w-0 space-y-5 border-0 p-0">
        <FormFields fields={fields} values={values} onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))} errors={errors} idPrefix="transmittal" />
        <fieldset className="space-y-2">
          <legend className="text-meta font-medium text-fg-muted">{t("transmittal.documents")}</legend>
          {documents.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-4 text-table text-fg-muted">{t("transmittal.noRevisions")}</p>
          ) : (
            // On a phone the list is not a second scroller inside the dialog, and each
            // revision select sits under its full document label (AUD-04 §6, D-09-09, MW-08).
            <ul className="divide-y divide-line rounded-md border border-line sm:max-h-72 sm:overflow-y-auto">
              {documents.map((doc) => {
                const chosen = selected.find((item) => item.engineeringDocumentId === doc.engineeringDocumentId);
                return (
                  <li key={doc.engineeringDocumentId} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="transmittal-document-option">
                    <label className="flex min-w-0 flex-1 items-center gap-2.5 text-table text-fg">
                      <Checkbox checked={Boolean(chosen)} onCheckedChange={() => toggle(doc, chosen?.engineeringRevisionId ?? doc.revisions[0].id)} aria-label={t("transmittal.include", { label: doc.label })} />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{doc.label}</span>
                    </label>
                    <select
                      aria-label={t("transmittal.revisionOf", { label: doc.label })}
                      className={`${selectClass} h-8 w-full text-table sm:w-auto`}
                      value={chosen?.engineeringRevisionId ?? doc.revisions[0].id}
                      onChange={(event) => chosen && toggle(doc, event.target.value)}
                      disabled={!chosen}
                    >
                      {doc.revisions.map((revision) => (
                        <option key={revision.id} value={revision.id}>
                          {t("ui.rev", { code: revision.code })} · {engineeringLabel(t, "reviewStatus", revision.status, REVIEW_STATUS_LABELS[revision.status])}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          )}
          {others.length > 0 ? (
            <div className="space-y-1.5" data-testid="transmittal-other-items">
              <p className="text-meta font-medium text-fg-muted">{t("transmittal.alsoOn")}</p>
              <ul className="divide-y divide-line rounded-md border border-line">
                {others.map((item) => (
                  <li key={item.documentId} className="flex items-center justify-between gap-3 px-3 py-2 text-table text-fg">
                    <span className="min-w-0 truncate">{item.label ?? t("transmittal.aFile")}</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSelected((current) => current.filter((entry) => entry.documentId !== item.documentId))}>
                      {t("transmittal.remove")}
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-meta text-fg-subtle">{t("transmittal.othersNote")}</p>
            </div>
          ) : null}
          <p className="text-meta text-fg-subtle">{t("transmittal.selected", { count: selected.length })}</p>
        </fieldset>
      </fieldset>
      {error || outcomeText ? (
        <div role="alert" className="space-y-1 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
          {error ? <p>{error}</p> : null}
          {outcomeText ? <p>{outcomeText}</p> : null}
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close} disabled={pending}>
          {t("ui.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("ui.saving") : existing ? t("transmittal.saveDraft") : t("transmittal.createDraft")}
        </Button>
      </DialogFooter>
    </form>
  ) : (
    <p className="mt-4 text-table text-fg-muted">{t("ui.loading")}</p>
  );
}
