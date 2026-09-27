"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { ListPlus, MessageCircleQuestionMark, Paperclip, X } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, useDialogClose } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RFI_REFERENCE_LABELS, RFI_REFERENCE_TYPES, type Option, type RfiDetailDTO, type RfiReferenceType } from "@/lib/modules/engineering/engineering.types";
import { cn } from "@/lib/utils/cn";
import { engineeringApi, failureMessage } from "./engineering-api";
import { formatDateTime, ReviewBadge } from "./engineering-ui";
import { useEngineeringTranslations } from "./engineering-text";
import { engineeringLabel } from "@/lib/i18n/modules/engineering/labels";
import type { Translate } from "@/lib/i18n/translator";
import { FormDialog, RequestMessages, useRequestEditor, type FormField } from "./form-kit";

/**
 * An RFI as a conversation on the record (PRD #46 §82-§93, §309, §313).
 *
 * The question, then every response and clarification in order — none of them
 * editable once sent. The assignee answers at the foot of the thread; whoever
 * raised it can send it back for clarification. References point at the
 * drawings, submittals, meetings and logs it concerns.
 */

const REFERENCE_CHOICES = RFI_REFERENCE_TYPES.filter((type) => type !== "OTHER");

export function RfiWorkspace({ rfi, zone, assignees }: { rfi: RfiDetailDTO; zone: string; assignees: Option[] }) {
  const router = useRouter();
  const toast = useToast();
  const t = useEngineeringTranslations();
  const [text, setText] = React.useState("");
  const [final, setFinal] = React.useState(true);
  const [clarifying, setClarifying] = React.useState(false);
  const [referencing, setReferencing] = React.useState(false);
  const [creatingTask, setCreatingTask] = React.useState(false);
  const caps = rfi.capabilities;

  // A response being written is unsaved work whose only way forward is
  // sending it: a workflow step the prompt never runs (AUD-03 §3).
  const response = useRequestEditor({
    module: "engineering",
    saveKind: "none",
    workflow: t("rfi.sendResponse"),
    label: t("rfi.yourResponse"),
    dirty: text !== "" || !final,
    request: () => engineeringApi(`/api/rfis/${rfi.id}/respond`, { body: { text, final } }),
    onCommitted: () => {
      setText("");
      setFinal(true);
      toast({ title: t("rfi.responseAdded"), tone: "success" });
      router.refresh();
    },
  });
  const pending = response.pending;

  function respond(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    void response.submit("normal");
  }

  async function removeReference(referenceId: string) {
    try {
      await engineeringApi(`/api/rfis/${rfi.id}/references/${referenceId}`, { method: "DELETE" });
      router.refresh();
    } catch (failure) {
      toast({ title: failureMessage(failure, t("ui.somethingWrong")), tone: "danger" });
    }
  }

  return (
    <div className="space-y-5">
      <section className="nesto-card p-5" aria-labelledby="rfi-thread-title" data-testid="rfi-thread">
        <h2 id="rfi-thread-title" className="sr-only">
          {t("rfi.threadTitle")}
        </h2>
        <article className="border-l-2 border-accent pl-4">
          <p className="nesto-eyebrow text-fg-subtle">
            {t("rfi.question")}
            {rfi.raisedByText ? (
              t("rfi.raisedBy", { name: rfi.raisedByText })
            ) : rfi.raisedBy ? (
              <>
                {t("rfi.raisedByPrefix")}
                <PersonLink memberId={rfi.raisedBy.id} name={rfi.raisedBy.name} />
              </>
            ) : null}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-body leading-relaxed text-fg" data-testid="rfi-question">
            {rfi.question}
          </p>
          <p className="mt-2 text-meta text-fg-subtle">{rfi.openedAt ? t("rfi.opened", { at: formatDateTime(rfi.openedAt, zone) }) : t("rfi.draftNotOpened")}</p>
        </article>

        {rfi.responses.length ? (
          <ol className="mt-6 space-y-4">
            {rfi.responses.map((response) => (
              <li key={response.id} className={cn("rounded-lg border px-4 py-3", response.clarificationRequest ? "border-warning/40 bg-warning-soft/40" : "border-line bg-surface-muted/60")} data-testid={response.clarificationRequest ? "rfi-clarification" : "rfi-response"}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-table font-medium text-fg">{response.by ? <PersonLink memberId={response.by.id} name={response.by.name} /> : t("rfi.formerMember")}</span>
                  <span className="text-meta text-fg-subtle">{formatDateTime(response.at, zone)}</span>
                  {response.clarificationRequest ? <Badge tone="warning">{t("rfi.clarificationRequested")}</Badge> : response.final ? <Badge tone="success">{t("rfi.finalResponse")}</Badge> : <Badge tone="default">{t("rfi.response")}</Badge>}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-body text-fg">{response.text}</p>
              </li>
            ))}
          </ol>
        ) : null}

        {rfi.status === "CLOSED" ? (
          <p className="mt-6 rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted" data-testid="rfi-closed-note">
            {t("rfi.closedAt", { at: formatDateTime(rfi.closedAt, zone) })}
            {rfi.closureNote ? ` — ${rfi.closureNote}` : ""}
          </p>
        ) : null}
        {rfi.status === "VOID" ? <p className="mt-6 rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">{t("rfi.voided")}{rfi.voidReason ? ` — ${rfi.voidReason}` : ""}</p> : null}

        {caps.canRespond ? (
          <form onSubmit={respond} className="mt-6 space-y-3 border-t border-line pt-5" data-testid="rfi-respond">
            <label htmlFor="rfi-response" className="text-table font-medium text-fg">
              {rfi.status === "ANSWERED" ? t("rfi.addToAnswer") : t("rfi.yourResponse")}
            </label>
            <Textarea id="rfi-response" rows={4} value={text} readOnly={pending} onChange={(event) => setText(event.target.value)} placeholder={t("rfi.responsePlaceholder")} />
            <RequestMessages error={response.error} outcomeText={response.outcomeText} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label htmlFor="rfi-final" className="flex items-center gap-2 text-table text-fg">
                <Checkbox id="rfi-final" checked={final} disabled={pending} onCheckedChange={(checked) => setFinal(checked === true)} />
                {t("rfi.isFinal")}
              </label>
              <Button type="submit" size="sm" disabled={pending || !text.trim()}>
                {pending ? t("rfi.sending") : t("rfi.sendResponse")}
              </Button>
            </div>
          </form>
        ) : null}

        {caps.canRequestClarification ? (
          <div className="mt-4 flex justify-end">
            <Button type="button" size="sm" variant="secondary" onClick={() => setClarifying(true)} data-testid="rfi-clarify">
              <MessageCircleQuestionMark aria-hidden="true" />
              {t("rfi.requestClarification")}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="nesto-card p-5" aria-labelledby="rfi-references-title" data-testid="rfi-references">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="rfi-references-title" className="text-card font-semibold text-fg">
              {t("rfi.references")}
            </h2>
            <p className="mt-0.5 text-table text-fg-muted">{t("rfi.referencesBody")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {caps.canCreateTask ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => setCreatingTask(true)} data-testid="create-task">
                <ListPlus aria-hidden="true" />
                {t("rfi.followUpTask")}
              </Button>
            ) : null}
            {caps.canReference ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => setReferencing(true)} data-testid="add-reference">
                <Paperclip aria-hidden="true" />
                {t("rfi.addReference")}
              </Button>
            ) : null}
          </div>
        </div>
        {rfi.references.length === 0 && rfi.tasks.length === 0 ? (
          <p className="text-table text-fg-muted">{t("rfi.noReferences")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {rfi.references.map((reference) => (
              <li key={reference.id} className="flex items-center justify-between gap-3 px-3 py-2" data-testid="rfi-reference">
                <div className="min-w-0">
                  <span className="mr-2 text-meta text-fg-subtle">{engineeringLabel(t, "reference", reference.type, reference.typeLabel)}</span>
                  {reference.href ? (
                    <Link href={reference.href} className="text-table text-fg underline-offset-4 hover:underline">
                      {reference.label}
                    </Link>
                  ) : (
                    <span className="text-table text-fg">{reference.label}</span>
                  )}
                  {reference.note ? <span className="ml-2 text-meta text-fg-muted">— {reference.note}</span> : null}
                </div>
                {caps.canReference ? (
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t("rfi.removeReference", { label: reference.label })} onClick={() => void removeReference(reference.id)}>
                    <X aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
            {rfi.tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2" data-testid="rfi-task">
                <div className="min-w-0">
                  <span className="mr-2 text-meta text-fg-subtle">{t("rfi.task")}</span>
                  <Link href={task.href} className="text-table text-fg underline-offset-4 hover:underline">
                    {task.label}
                  </Link>
                </div>
                <ReviewBadge status={task.status} testId="rfi-task-status" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <FormDialog
        open={clarifying}
        onOpenChange={setClarifying}
        title={t("rfi.requestClarification")}
        description={t("rfi.clarifyBody")}
        fields={[{ name: "text", label: t("rfi.stillUnclear"), type: "textarea", required: true, rows: 4 }]}
        submitLabel={t("rfi.sendBack")}
        saveKind="none"
        module="engineering"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/rfis/${rfi.id}/clarification`, { body: payload });
          toast({ title: t("rfi.sentBack"), tone: "success" });
          router.refresh();
        }}
      />
      {referencing ? <ReferenceDialog rfiId={rfi.id} onClose={() => setReferencing(false)} /> : null}
      <FormDialog
        open={creatingTask}
        onOpenChange={setCreatingTask}
        title={t("rfi.followUpTask")}
        description={t("rfi.taskBody")}
        fields={taskFields(assignees, t)}
        initial={{ priority: "MEDIUM", title: `Follow up ${rfi.rfiNumber}: ${rfi.subject}`.slice(0, 200) }}
        submitLabel={t("rfi.createTask")}
        saveKind="create"
        module="engineering"
        testId="task-form"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/rfis/${rfi.id}/tasks`, { body: payload });
          toast({ title: t("rfi.taskCreated"), tone: "success" });
          router.refresh();
        }}
      />
    </div>
  );
}

function taskFields(assignees: Option[], t: Translate<"engineering">): FormField[] {
  return [
    { name: "title", label: t("fields.title"), type: "text", required: true, wide: true },
    { name: "assigneeMemberId", label: t("fields.assignee"), type: "select", options: assignees.map((item) => ({ value: item.id, label: item.label })) },
    { name: "dueDate", label: t("fields.due"), type: "date" },
    { name: "priority", label: t("fields.priority"), type: "select", required: true, options: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => ({ value, label: t(`labels.priority.${value as "LOW"}`) })) },
    { name: "description", label: t("fields.description"), type: "textarea", rows: 3 },
  ];
}

function ReferenceDialog({ rfiId, onClose }: { rfiId: string; onClose: () => void }) {
  const [pending, setPending] = React.useState(false);
  const t = useEngineeringTranslations();
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-lg" data-testid="reference-dialog">
        <DialogTitle>{t("rfi.addReference")}</DialogTitle>
        <DialogDescription>{t("rfi.referenceBody")}</DialogDescription>
        {/* Inside the dialog, so the pick belongs to its guarded close (AUD-03 §5). */}
        <ReferenceForm rfiId={rfiId} onClose={onClose} onPending={setPending} />
      </DialogContent>
    </Dialog>
  );
}

function ReferenceForm({ rfiId, onClose, onPending }: { rfiId: string; onClose: () => void; onPending: (pending: boolean) => void }) {
  const router = useRouter();
  const close = useDialogClose();
  const t = useEngineeringTranslations();
  const [type, setType] = React.useState<RfiReferenceType>("DRAWING");
  const [options, setOptions] = React.useState<Option[] | null>(null);
  const [referenceId, setReferenceId] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    let live = true;
    setOptions(null);
    setReferenceId("");
    engineeringApi<Option[]>(`/api/rfis/${rfiId}/references?type=${type}`)
      .then((rows) => live && setOptions(rows))
      .catch(() => live && setOptions([]));
    return () => {
      live = false;
    };
  }, [rfiId, type]);

  const save = useRequestEditor({
    module: "engineering",
    saveKind: "create",
    label: t("rfi.addReference"),
    dirty: referenceId !== "" || note !== "",
    request: () => engineeringApi(`/api/rfis/${rfiId}/references`, { body: { referenceType: type, referenceId, note: note.trim() || null } }),
    onCommitted: () => {
      onClose();
      router.refresh();
    },
  });
  const { pending } = save;
  React.useEffect(() => onPending(pending), [onPending, pending]);

  return (
    <form onSubmit={save.onSubmit} className="mt-4 space-y-4">
      <fieldset disabled={pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="reference-type" className="text-meta font-medium text-fg-muted">
              {t("rfi.kind")}
            </label>
            <select id="reference-type" className={selectClass} value={type} onChange={(event) => setType(event.target.value as RfiReferenceType)}>
              {REFERENCE_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {engineeringLabel(t, "reference", choice, RFI_REFERENCE_LABELS[choice])}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="reference-record" className="text-meta font-medium text-fg-muted">
              {t("rfi.record")}
            </label>
            <select id="reference-record" className={selectClass} value={referenceId} onChange={(event) => setReferenceId(event.target.value)} disabled={options === null}>
              <option value="">{options === null ? t("ui.loading") : options.length ? t("rfi.choose") : t("rfi.nothingToReference")}</option>
              {(options ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="reference-note" className="text-meta font-medium text-fg-muted">
            {t("rfi.note")}
          </label>
          <input id="reference-note" className={selectClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("rfi.notePlaceholder")} />
        </div>
      </fieldset>
      <RequestMessages error={save.error} outcomeText={save.outcomeText} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close} disabled={pending}>
          {t("ui.cancel")}
        </Button>
        <Button type="submit" disabled={pending || !referenceId}>
          {t("rfi.addReference")}
        </Button>
      </DialogFooter>
    </form>
  );
}
