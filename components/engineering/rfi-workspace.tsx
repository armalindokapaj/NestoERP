"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
import { ListPlus, MessageCircleQuestionMark, Paperclip, X } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RFI_REFERENCE_LABELS, RFI_REFERENCE_TYPES, type Option, type RfiDetailDTO, type RfiReferenceType } from "@/lib/modules/engineering/engineering.types";
import { cn } from "@/lib/utils/cn";
import { engineeringApi, failureMessage } from "./engineering-api";
import { formatDateTime, ReviewBadge } from "./engineering-ui";
import { FormDialog, type FormField } from "./form-kit";

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
  const [text, setText] = React.useState("");
  const [final, setFinal] = React.useState(true);
  const [pending, setPending] = React.useState(false);
  const [clarifying, setClarifying] = React.useState(false);
  const [referencing, setReferencing] = React.useState(false);
  const [creatingTask, setCreatingTask] = React.useState(false);
  const caps = rfi.capabilities;

  async function respond(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setPending(true);
    try {
      await engineeringApi(`/api/rfis/${rfi.id}/respond`, { body: { text, final } });
      setText("");
      toast({ title: "Response added.", tone: "success" });
      router.refresh();
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  async function removeReference(referenceId: string) {
    try {
      await engineeringApi(`/api/rfis/${rfi.id}/references/${referenceId}`, { method: "DELETE" });
      router.refresh();
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
    }
  }

  return (
    <div className="space-y-5">
      <section className="nesto-card p-5" aria-labelledby="rfi-thread-title" data-testid="rfi-thread">
        <h2 id="rfi-thread-title" className="sr-only">
          Question and responses
        </h2>
        <article className="border-l-2 border-accent pl-4">
          <p className="nesto-eyebrow text-fg-subtle">
            Question
            {rfi.raisedByText ? (
              ` · raised by ${rfi.raisedByText}`
            ) : rfi.raisedBy ? (
              <>
                {" · raised by "}
                <PersonLink memberId={rfi.raisedBy.id} name={rfi.raisedBy.name} />
              </>
            ) : null}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-body leading-relaxed text-fg" data-testid="rfi-question">
            {rfi.question}
          </p>
          <p className="mt-2 text-meta text-fg-subtle">{rfi.openedAt ? `Opened ${formatDateTime(rfi.openedAt, zone)}` : "Draft — not yet opened"}</p>
        </article>

        {rfi.responses.length ? (
          <ol className="mt-6 space-y-4">
            {rfi.responses.map((response) => (
              <li key={response.id} className={cn("rounded-lg border px-4 py-3", response.clarificationRequest ? "border-warning/40 bg-warning-soft/40" : "border-line bg-surface-muted/60")} data-testid={response.clarificationRequest ? "rfi-clarification" : "rfi-response"}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-table font-medium text-fg">{response.by ? <PersonLink memberId={response.by.id} name={response.by.name} /> : "Former member"}</span>
                  <span className="text-meta text-fg-subtle">{formatDateTime(response.at, zone)}</span>
                  {response.clarificationRequest ? <Badge tone="warning">Clarification requested</Badge> : response.final ? <Badge tone="success">Final response</Badge> : <Badge tone="default">Response</Badge>}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-body text-fg">{response.text}</p>
              </li>
            ))}
          </ol>
        ) : null}

        {rfi.status === "CLOSED" ? (
          <p className="mt-6 rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted" data-testid="rfi-closed-note">
            Closed {formatDateTime(rfi.closedAt, zone)}
            {rfi.closureNote ? ` — ${rfi.closureNote}` : ""}
          </p>
        ) : null}
        {rfi.status === "VOID" ? <p className="mt-6 rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">Voided{rfi.voidReason ? ` — ${rfi.voidReason}` : ""}</p> : null}

        {caps.canRespond ? (
          <form onSubmit={respond} className="mt-6 space-y-3 border-t border-line pt-5" data-testid="rfi-respond">
            <label htmlFor="rfi-response" className="text-table font-medium text-fg">
              {rfi.status === "ANSWERED" ? "Add to the answer" : "Your response"}
            </label>
            <Textarea id="rfi-response" rows={4} value={text} onChange={(event) => setText(event.target.value)} placeholder="Answer the question on the record. A sent response is never edited — add another to correct it." />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label htmlFor="rfi-final" className="flex items-center gap-2 text-table text-fg">
                <Checkbox id="rfi-final" checked={final} onCheckedChange={(checked) => setFinal(checked === true)} />
                This is the final response
              </label>
              <Button type="submit" size="sm" disabled={pending || !text.trim()}>
                {pending ? "Sending…" : "Send response"}
              </Button>
            </div>
          </form>
        ) : null}

        {caps.canRequestClarification ? (
          <div className="mt-4 flex justify-end">
            <Button type="button" size="sm" variant="secondary" onClick={() => setClarifying(true)} data-testid="rfi-clarify">
              <MessageCircleQuestionMark aria-hidden="true" />
              Request clarification
            </Button>
          </div>
        ) : null}
      </section>

      <section className="nesto-card p-5" aria-labelledby="rfi-references-title" data-testid="rfi-references">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="rfi-references-title" className="text-card font-semibold text-fg">
              References
            </h2>
            <p className="mt-0.5 text-table text-fg-muted">Drawings, documents, submittals, meetings and logs this RFI concerns.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {caps.canCreateTask ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => setCreatingTask(true)} data-testid="create-task">
                <ListPlus aria-hidden="true" />
                Follow-up task
              </Button>
            ) : null}
            {caps.canReference ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => setReferencing(true)} data-testid="add-reference">
                <Paperclip aria-hidden="true" />
                Add reference
              </Button>
            ) : null}
          </div>
        </div>
        {rfi.references.length === 0 && rfi.tasks.length === 0 ? (
          <p className="text-table text-fg-muted">No references yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {rfi.references.map((reference) => (
              <li key={reference.id} className="flex items-center justify-between gap-3 px-3 py-2" data-testid="rfi-reference">
                <div className="min-w-0">
                  <span className="mr-2 text-meta text-fg-subtle">{reference.typeLabel}</span>
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
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove reference to ${reference.label}`} onClick={() => void removeReference(reference.id)}>
                    <X aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
            {rfi.tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2" data-testid="rfi-task">
                <div className="min-w-0">
                  <span className="mr-2 text-meta text-fg-subtle">Task</span>
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
        title="Request clarification"
        description="Say what the answer leaves open. The RFI goes back to its assignee."
        fields={[{ name: "text", label: "What is still unclear", type: "textarea", required: true, rows: 4 }]}
        submitLabel="Send back"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/rfis/${rfi.id}/clarification`, { body: payload });
          toast({ title: "Sent back for clarification.", tone: "success" });
          router.refresh();
        }}
      />
      {referencing ? <ReferenceDialog rfiId={rfi.id} onClose={() => setReferencing(false)} /> : null}
      <FormDialog
        open={creatingTask}
        onOpenChange={setCreatingTask}
        title="Follow-up task"
        description="Raised in Tasks, with this RFI as where it came from. Finishing it does not close the RFI."
        fields={taskFields(assignees)}
        initial={{ priority: "MEDIUM", title: `Follow up ${rfi.rfiNumber}: ${rfi.subject}`.slice(0, 200) }}
        submitLabel="Create task"
        testId="task-form"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/rfis/${rfi.id}/tasks`, { body: payload });
          toast({ title: "Task created.", tone: "success" });
          router.refresh();
        }}
      />
    </div>
  );
}

function taskFields(assignees: Option[]): FormField[] {
  return [
    { name: "title", label: "Title", type: "text", required: true, wide: true },
    { name: "assigneeMemberId", label: "Assignee", type: "select", options: assignees.map((item) => ({ value: item.id, label: item.label })) },
    { name: "dueDate", label: "Due", type: "date" },
    { name: "priority", label: "Priority", type: "select", required: true, options: [{ value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" }, { value: "CRITICAL", label: "Critical" }] },
    { name: "description", label: "Description", type: "textarea", rows: 3 },
  ];
}

function ReferenceDialog({ rfiId, onClose }: { rfiId: string; onClose: () => void }) {
  const router = useRouter();
  const [type, setType] = React.useState<RfiReferenceType>("DRAWING");
  const [options, setOptions] = React.useState<Option[] | null>(null);
  const [referenceId, setReferenceId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await engineeringApi(`/api/rfis/${rfiId}/references`, { body: { referenceType: type, referenceId, note: note.trim() || null } });
      onClose();
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-lg" data-testid="reference-dialog">
        <DialogTitle>Add reference</DialogTitle>
        <DialogDescription>Only records on this RFI&apos;s project that you can open are offered.</DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="reference-type" className="text-meta font-medium text-fg-muted">
                Kind
              </label>
              <select id="reference-type" className={selectClass} value={type} onChange={(event) => setType(event.target.value as RfiReferenceType)}>
                {REFERENCE_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {RFI_REFERENCE_LABELS[choice]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="reference-record" className="text-meta font-medium text-fg-muted">
                Record
              </label>
              <select id="reference-record" className={selectClass} value={referenceId} onChange={(event) => setReferenceId(event.target.value)} disabled={options === null}>
                <option value="">{options === null ? "Loading…" : options.length ? "Choose" : "Nothing to reference"}</option>
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
              Note
            </label>
            <input id="reference-note" className={selectClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Grid, level or detail" />
          </div>
          {error ? (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !referenceId}>
              Add reference
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
