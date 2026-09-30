"use client";

import * as React from "react";
import { Camera } from "lucide-react";

import { useDocumentsTranslations } from "@/components/documents/documents-text";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EvidenceCapture } from "./evidence-capture";

/**
 * "Add evidence" on a record (MOB-07 §46, §57, §91): photos or files, and
 * optionally a short text note, attached to the record the reader is already on.
 * No project or record picker — the record is the context.
 *
 * Files go to the canonical Document pipeline with the record as their parent;
 * the note is an ordinary comment on the same record, through the collaboration
 * API, so it shows in the same discussion everyone else sees. Whether evidence is
 * *required* to complete a task is the task state machine's rule, not this
 * control's (§47).
 */
export function RecordEvidence({ entityType, entityId, withNote = true }: { entityType: string; entityId: string; withNote?: boolean }) {
  const t = useDocumentsTranslations();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function addNote() {
    const body = note.trim();
    if (!body || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/collaboration/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!response.ok) throw new Error("rejected");
      setNote("");
      setMessage({ tone: "ok", text: t("capture.noteAdded") });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: t("capture.noteFailed") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="record-evidence">
      {open ? null : (
        <Button type="button" onClick={() => setOpen(true)} data-testid="add-evidence">
          <Camera aria-hidden="true" />
          {t("capture.addEvidence")}
        </Button>
      )}
      {open ? (
        <div className="space-y-4 rounded-md border border-line p-3">
          <EvidenceCapture
            parent={{ context: "record", entityType, entityId }}
            persistKey={`record-evidence:${entityType}:${entityId}`}
            onUploaded={() => router.refresh()}
          />
          {withNote ? (
            <div className="space-y-2">
              <label htmlFor={`evidence-note-${entityId}`} className="text-table font-medium text-fg">
                {t("capture.noteLabel")}
              </label>
              <Textarea id={`evidence-note-${entityId}`} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={5000} />
              <div className="flex items-center gap-3">
                <Button type="button" variant="secondary" onClick={addNote} disabled={!note.trim() || saving} data-testid="add-evidence-note">
                  {t("capture.addNote")}
                </Button>
                {message ? (
                  <p role={message.tone === "error" ? "alert" : "status"} className="text-meta text-fg-muted">
                    {message.text}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {t("capture.hideEvidence")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
