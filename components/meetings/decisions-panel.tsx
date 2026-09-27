"use client";

import * as React from "react";
import { Gavel, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { MeetingDecisionDTO, MeetingDetailDTO } from "@/lib/modules/meetings/meeting.types";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { failureMessage, meetingApi, meetingFailureOutcome } from "./meeting-api";
import { PlainText } from "./meeting-ui";
import { useMeetingsTranslations } from "./meetings-text";
import { useMeetingDraft } from "./use-meeting-draft";

/**
 * Decisions (PRD #40 §50-§52, §105, §214): numbered cards, fast to record in
 * the room — a title is enough, the detail can follow. A decision never
 * becomes a task by itself; that is what an action is for.
 */
export function DecisionsPanel({ meeting, onChange, limit }: { meeting: MeetingDetailDTO; onChange: (detail: MeetingDetailDTO) => void; limit?: number }) {
  const toast = useToast();
  const t = useMeetingsTranslations();
  const canRecord = meeting.capabilities.canRecordDecision;
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState({ title: "", description: "" });
  const [editBase, setEditBase] = React.useState({ title: "", description: "" });
  const [archiving, setArchiving] = React.useState<MeetingDecisionDTO | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);

  async function send(key: string, url: string, init: { method?: string; body?: unknown }, success?: string): Promise<SaveOutcome> {
    setPending(key);
    try {
      onChange(await meetingApi<MeetingDetailDTO>(url, init));
      if (success) toast({ title: success, tone: "success" });
      return { kind: "committed" };
    } catch (error) {
      toast({ title: failureMessage(error, t("decisions.failed")), tone: "danger" });
      return meetingFailureOutcome(error);
    } finally {
      setPending(null);
    }
  }

  async function call(key: string, url: string, init: { method?: string; body?: unknown }, success?: string) {
    return (await send(key, url, init, success)).kind === "committed";
  }

  // The decision being recorded and the one being edited are unsaved work (AUD-03 §3).
  const adder = useMeetingDraft({
    label: t("decisions.newLabel"),
    saveKind: "create",
    dirty: title !== "" || description !== "",
    send: async () => {
      if (!title.trim()) return { kind: "invalid" };
      const outcome = await send("add", `/api/meetings/${meeting.id}/decisions`, { body: { title: title.trim(), description: description.trim() || null } }, t("decisions.recorded"));
      if (outcome.kind === "committed") {
        setTitle("");
        setDescription("");
        setOpen(false);
      }
      return outcome;
    },
  });
  const editor = useMeetingDraft({
    label: () => t("decisions.editing", { title: edit.title.trim() || editBase.title }),
    saveKind: "save",
    dirty: editing !== null && (edit.title !== editBase.title || edit.description !== editBase.description),
    send: async () => {
      if (editing === null) return { kind: "committed" };
      if (!edit.title.trim()) return { kind: "invalid" };
      const outcome = await send(editing, `/api/meetings/${meeting.id}/decisions/${editing}`, { method: "PATCH", body: { title: edit.title.trim(), description: edit.description.trim() || null } });
      if (outcome.kind === "committed") setEditing(null);
      return outcome;
    },
  });

  const decisions = limit ? meeting.decisions.slice(-limit) : meeting.decisions;

  return (
    <section aria-labelledby="decisions-heading" className="space-y-3" data-testid="decisions-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 id="decisions-heading" className="text-card font-semibold text-fg">
          {t("decisions.title")} <span className="ml-1 text-table font-normal text-fg-subtle">{meeting.decisions.length}</span>
        </h2>
        {canRecord && !open ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" />
            {t("decisions.record")}
          </Button>
        ) : null}
      </div>

      {canRecord && open ? (
        <form
          className="space-y-3 rounded-xl border border-line bg-surface-muted p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim()) return;
            void adder.save();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="decision-title">{t("decisions.what")}</Label>
            <Input id="decision-title" autoFocus value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} placeholder={t("decisions.whatPlaceholder")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="decision-description">{t("decisions.detail")}</Label>
            <Textarea id="decision-description" rows={2} maxLength={10_000} value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                void adder.dismiss(() => {
                  setOpen(false);
                  setTitle("");
                  setDescription("");
                })
              }
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={pending === "add" || !title.trim()}>
              {pending === "add" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {t("decisions.recordButton")}
            </Button>
          </div>
        </form>
      ) : null}

      {decisions.length === 0 ? (
        <p className="text-table text-fg-subtle">{t("decisions.none")}</p>
      ) : (
        <ol className="space-y-2">
          {decisions.map((decision) => (
            <li key={decision.id} className="group flex gap-3 rounded-xl border border-line bg-surface p-3.5" data-testid="decision-card">
              <span className="flex h-6 shrink-0 items-center rounded-md bg-surface-muted px-1.5 font-mono text-meta font-semibold text-fg-muted">{decision.label}</span>
              {editing === decision.id ? (
                <form
                  className="min-w-0 flex-1 space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void editor.save();
                  }}
                >
                  <Input aria-label={t("decisions.decision")} value={edit.title} maxLength={300} onChange={(event) => setEdit({ ...edit, title: event.target.value })} />
                  <Textarea aria-label={t("decisions.detailLabel")} rows={2} value={edit.description} maxLength={10_000} onChange={(event) => setEdit({ ...edit, description: event.target.value })} />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => void editor.dismiss(() => setEditing(null))}>
                      {t("common.cancel")}
                    </Button>
                    <Button type="submit" size="sm" disabled={!edit.title.trim() || pending === decision.id}>
                      {t("common.save")}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-fg">{decision.title}</p>
                  {decision.description ? <PlainText text={decision.description} className="mt-1 text-table text-fg-muted" /> : null}
                  <p className="mt-1 text-meta text-fg-subtle">{t("decisions.recordedBy")}{decision.recordedByMemberId ? <PersonLink memberId={decision.recordedByMemberId} name={decision.recordedBy} /> : decision.recordedBy}</p>
                </div>
              )}
              {canRecord && editing !== decision.id ? (
                <span className="flex shrink-0 items-start gap-0.5 opacity-70 group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label={t("decisions.edit", { label: decision.label })}
                    onClick={() => {
                      const value = { title: decision.title, description: decision.description ?? "" };
                      // Opening another decision replaces the one being edited: ask first.
                      void editor.dismiss(() => {
                        setEditing(decision.id);
                        setEdit(value);
                        setEditBase(value);
                      });
                    }}
                    className="rounded-md p-1.5 text-fg-subtle hover:bg-hover hover:text-fg"
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </button>
                  <button type="button" aria-label={t("decisions.withdraw", { label: decision.label })} onClick={() => setArchiving(decision)} className="rounded-md p-1.5 text-fg-subtle hover:bg-hover hover:text-danger-strong">
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {limit && meeting.decisions.length > limit ? <p className="text-meta text-fg-subtle">{t("decisions.earlier", { count: meeting.decisions.length - limit })}</p> : null}

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(value) => (value ? null : setArchiving(null))}
        title={t("decisions.withdrawTitle", { label: archiving?.label ?? t("decisions.thisDecision") })}
        description={t("decisions.withdrawDescription")}
        confirmLabel={t("decisions.withdrawConfirm")}
        pending={pending !== null}
        onConfirm={async () => {
          if (archiving && (await call(archiving.id, `/api/meetings/${meeting.id}/decisions/${archiving.id}`, { method: "DELETE" }))) setArchiving(null);
        }}
      />
    </section>
  );
}

export function DecisionIcon() {
  return <Gavel aria-hidden="true" className="size-4" />;
}
