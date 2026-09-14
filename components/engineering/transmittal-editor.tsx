"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { REVIEW_STATUS_LABELS } from "@/lib/modules/engineering/engineering.types";
import type { TransmittalDocumentOption } from "@/lib/modules/engineering/engineering.transmittals";
import { engineeringApi, failureMessage, fieldErrorsOf } from "./engineering-api";
import { FormFields, payloadFor, valuesFor, type FormValues } from "./form-kit";
import { transmittalHeaderFields, type ProjectOptions } from "./record-fields";

/**
 * Preparing a transmittal (PRD #46 §118-§123): who it goes to and why, and
 * which revisions of which register documents travel on it. It stays a draft
 * until issued; issuing fixes every item and the file version it carried.
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

function TransmittalDialog({ projectId, existing, onClose }: { projectId: string; existing?: Parameters<typeof EditTransmittalButton>[0]["transmittal"]; onClose: () => void }) {
  const router = useRouter();
  const [options, setOptions] = React.useState<ProjectOptions | null>(null);
  const [documents, setDocuments] = React.useState<TransmittalDocumentOption[] | null>(null);
  const [values, setValues] = React.useState<FormValues>({});
  const [selected, setSelected] = React.useState<Selected[]>(existing?.items ?? []);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    void Promise.all([
      engineeringApi<ProjectOptions>(`/api/projects/${projectId}/engineering/options?for=document`).catch(() => ({ contractors: [], workPackages: [], members: [], reviewers: [] })),
      engineeringApi<TransmittalDocumentOption[]>(`/api/projects/${projectId}/transmittals/options`).catch(() => []),
    ]).then(([projectOptions, documentOptions]) => {
      setOptions(projectOptions);
      setDocuments(documentOptions);
      setValues(valuesFor(transmittalHeaderFields(projectOptions), existing ?? { direction: "OUTGOING", purpose: "FOR_INFORMATION" }));
    });
  }, [existing, projectId]);

  const fields = options ? transmittalHeaderFields(options) : [];

  function toggle(doc: TransmittalDocumentOption, revisionId: string) {
    const revision = doc.revisions.find((item) => item.id === revisionId)!;
    setSelected((current) => {
      const withoutDoc = current.filter((item) => item.engineeringDocumentId !== doc.engineeringDocumentId);
      if (current.some((item) => item.engineeringRevisionId === revisionId)) return withoutDoc;
      return [...withoutDoc, { engineeringDocumentId: doc.engineeringDocumentId, engineeringRevisionId: revision.id, documentId: revision.documentId, remarks: "" }];
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setErrors({});
    const body = { ...payloadFor(fields, values), items: selected.map((item) => ({ ...item, remarks: item.remarks.trim() || null })) };
    try {
      if (existing) {
        await engineeringApi(`/api/transmittals/${existing.id}`, { method: "PATCH", body });
        onClose();
        router.refresh();
      } else {
        const created = await engineeringApi<{ id: string }>(`/api/projects/${projectId}/transmittals`, { body });
        router.push(`/projects/${projectId}/engineering/transmittals/${created.id}`);
      }
    } catch (failure) {
      setErrors(fieldErrorsOf(failure));
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto" data-testid="transmittal-form">
        <DialogTitle>{existing ? "Edit transmittal" : "New transmittal"}</DialogTitle>
        <DialogDescription>Saved as a draft. Issuing it fixes its contents and the file versions it carries.</DialogDescription>
        {options && documents ? (
          <form onSubmit={submit} className="mt-4 space-y-5" noValidate>
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
            {error ? (
              <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : existing ? "Save draft" : "Create draft"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <p className="mt-4 text-table text-fg-muted">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
