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
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { engineeringApi, failureMessage, failureOutcome, fieldErrorsOf } from "./engineering-api";
import { FormFields, payloadFor, valuesFor, type FormValues } from "./form-kit";
import { transmittalHeaderFields, type ProjectOptions } from "./record-fields";

/**
 * Preparing a transmittal (PRD #46 §118-§123): who it goes to and why, and
 * which revisions of which register documents travel on it. It stays a draft
 * until issued; issuing fixes every item and the file version it carried.
 * A draft being prepared is unsaved work: closing the dialog asks (AUD-03 §5).
 */

type Selected = { engineeringDocumentId: string; engineeringRevisionId: string; documentId: string; remarks: string };

export function NewTransmittalButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)} data-testid="new-transmittal">
        <Plus aria-hidden="true" />
        New transmittal
      </Button>
      {open ? <TransmittalDialog projectId={projectId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function EditTransmittalButton({ projectId, transmittal }: { projectId: string; transmittal: { id: string; direction: string; purpose: string; subject: string | null; contractorId: string | null; workPackageId: string | null; senderText: string | null; recipientText: string | null; notes: string | null; items: Selected[] } }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="edit-transmittal">
        <Pencil aria-hidden="true" />
        Edit draft
      </Button>
      {open ? <TransmittalDialog projectId={projectId} existing={transmittal} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type TransmittalDialogProps = { projectId: string; existing?: Parameters<typeof EditTransmittalButton>[0]["transmittal"]; onClose: () => void };

function TransmittalDialog(props: TransmittalDialogProps) {
  const [pending, setPending] = React.useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && props.onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto" data-testid="transmittal-form">
        <DialogTitle>{props.existing ? "Edit transmittal" : "New transmittal"}</DialogTitle>
        <DialogDescription>Saved as a draft. Issuing it fixes its contents and the file versions it carries.</DialogDescription>
        {/* Inside the dialog, so the editor belongs to its guarded close (AUD-03 §5). */}
        <TransmittalBody {...props} pending={pending} setPending={setPending} />
      </DialogContent>
    </Dialog>
  );
}

function TransmittalBody({ projectId, existing, onClose, pending, setPending }: TransmittalDialogProps & { pending: boolean; setPending: (pending: boolean) => void }) {
  const router = useRouter();
  const close = useDialogClose();
  const [options, setOptions] = React.useState<ProjectOptions | null>(null);
  const [documents, setDocuments] = React.useState<TransmittalDocumentOption[] | null>(null);
  const [values, setValues] = React.useState<FormValues>({});
  const [baseline, setBaseline] = React.useState<FormValues>({});
  const [selected, setSelected] = React.useState<Selected[]>(existing?.items ?? []);
  const [selectedBaseline, setSelectedBaseline] = React.useState<Selected[]>(existing?.items ?? []);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [outcomeText, setOutcomeText] = React.useState<string | null>(null);
  const running = React.useRef(false);

  React.useEffect(() => {
    void Promise.all([
      engineeringApi<ProjectOptions>(`/api/projects/${projectId}/engineering/options?for=document`).catch(() => ({ contractors: [], workPackages: [], members: [], reviewers: [] })),
      engineeringApi<TransmittalDocumentOption[]>(`/api/projects/${projectId}/transmittals/options`).catch(() => []),
    ]).then(([projectOptions, documentOptions]) => {
      setOptions(projectOptions);
      setDocuments(documentOptions);
      const loaded = valuesFor(transmittalHeaderFields(projectOptions), existing ?? { direction: "OUTGOING", purpose: "FOR_INFORMATION" });
      setValues(loaded);
      setBaseline(loaded);
    });
  }, [existing, projectId]);

  const fields = options ? transmittalHeaderFields(options) : [];

  // The header and the picked revisions against what the dialog opened with (AUD-03 §3).
  const run = React.useRef<(mode?: "normal" | "continue") => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({ module: "engineering", saveKind: existing ? "save" : "create", label: existing ? "Edit transmittal" : "New transmittal", save: () => run.current("continue") });
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
    running.current = true;
    setPending(true);
    setSaving(true);
    setError(null);
    setOutcomeText(null);
    setErrors({});
    const body = { ...payloadFor(fields, values), items: selected.map((item) => ({ ...item, remarks: item.remarks.trim() || null })) };
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
      setError(failureMessage(failure));
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

  return options && documents ? (
    <form onSubmit={submit} className="mt-4 space-y-5" noValidate>
      <fieldset disabled={pending} className="m-0 min-w-0 space-y-5 border-0 p-0">
        <FormFields fields={fields} values={values} onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))} errors={errors} idPrefix="transmittal" />
        <fieldset className="space-y-2">
          <legend className="text-meta font-medium text-fg-muted">Documents</legend>
          {documents.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-4 text-table text-fg-muted">No submitted revisions on this project yet.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {documents.map((doc) => {
                const chosen = selected.find((item) => item.engineeringDocumentId === doc.engineeringDocumentId);
                return (
                  <li key={doc.engineeringDocumentId} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="transmittal-document-option">
                    <label className="flex min-w-0 flex-1 items-center gap-2.5 text-table text-fg">
                      <Checkbox checked={Boolean(chosen)} onCheckedChange={() => toggle(doc, chosen?.engineeringRevisionId ?? doc.revisions[0].id)} aria-label={`Include ${doc.label}`} />
                      <span className="truncate">{doc.label}</span>
                    </label>
                    <select
                      aria-label={`Revision of ${doc.label}`}
                      className={`${selectClass} h-8 w-auto text-table`}
                      value={chosen?.engineeringRevisionId ?? doc.revisions[0].id}
                      onChange={(event) => chosen && toggle(doc, event.target.value)}
                      disabled={!chosen}
                    >
                      {doc.revisions.map((revision) => (
                        <option key={revision.id} value={revision.id}>
                          Rev {revision.code} · {REVIEW_STATUS_LABELS[revision.status]}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-meta text-fg-subtle">{selected.length} selected</p>
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
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : existing ? "Save draft" : "Create draft"}
        </Button>
      </DialogFooter>
    </form>
  ) : (
    <p className="mt-4 text-table text-fg-muted">Loading…</p>
  );
}
