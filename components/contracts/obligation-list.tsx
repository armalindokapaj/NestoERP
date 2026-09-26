"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { ClipboardList, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { selectClass } from "@/components/forms/record-form";
import {
  closeObligationAction,
  createObligationTaskAction,
  saveObligationAction,
} from "@/lib/actions/contracts";
import type { ContractObligationDTO } from "@/lib/modules/contracts/contract.types";
import {
  OBLIGATION_TYPES,
  obligationTypeLabels,
} from "@/lib/modules/contracts/obligations/obligation.status";
import { formatDate } from "@/lib/utils/format";

/**
 * The obligation register on a contract (PRD #18 §148–§158).
 *
 * "Overdue" is a label the server derives from today and the due date, not a
 * status anybody sets — so an obligation becomes overdue overnight without
 * anything being written (PRD #18 §152).
 *
 * "Create task" hands the work to the canonical Tasks module. The obligation is
 * the legal requirement; the task is somebody doing something about it, and the
 * two are deliberately different records (PRD #18 §154).
 */
export function ContractObligationList({
  contractId,
  obligations,
  canCreate,
  members,
}: {
  contractId: string;
  obligations: ContractObligationDTO[];
  canCreate: boolean;
  members: { value: string; label: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = React.useState<ContractObligationDTO | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [taskFor, setTaskFor] = React.useState<ContractObligationDTO | null>(null);
  const [pending, startTransition] = React.useTransition();

  function close(obligation: ContractObligationDTO, action: "complete" | "cancel") {
    startTransition(async () => {
      const result = await closeObligationAction(contractId, obligation.id, action);
      if (result.ok) {
        toast({
          title: action === "complete" ? "Obligation completed." : "Obligation cancelled.",
          tone: "success",
        });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Record obligation
          </Button>
        </div>
      ) : null}

      {obligations.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title="No obligations recorded."
          description="Insurance certificates, renewal notices, deliverables and payment milestones the agreement requires."
        />
      ) : (
        <ul className="nesto-card divide-y divide-line">
          {obligations.map((obligation) => (
            <li key={obligation.id} className="space-y-2 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-table font-medium text-fg">{obligation.title}</p>
                  {obligation.description ? (
                    <p className="mt-0.5 text-meta text-fg-muted">{obligation.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">{obligationTypeLabels[obligation.type]}</Badge>
                  <StatusBadge status={obligation.status} />
                  {obligation.isOverdue ? (
                    <Badge tone="warning">
                      Overdue by {obligation.daysOverdue} day{obligation.daysOverdue === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                </div>
              </div>

              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-meta">
                <div className="flex gap-2">
                  <dt className="text-fg-subtle">Due</dt>
                  <dd className="text-fg">
                    {obligation.dueDate ? formatDate(obligation.dueDate) : "No due date"}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-fg-subtle">Responsible</dt>
                  <dd className={obligation.responsible?.active === false ? "text-warning-strong" : "text-fg"}>
                    {obligation.responsible ? (
                      <>
                        <PersonLink memberId={obligation.responsible.memberId} name={obligation.responsible.fullName} />
                        {obligation.responsible.active ? "" : " — no longer active"}
                      </>
                    ) : (
                      "Unassigned"
                    )}
                  </dd>
                </div>
                {obligation.sourceAmendmentId ? (
                  <div className="flex gap-2">
                    <dt className="text-fg-subtle">Source</dt>
                    <dd className="text-fg">Added by amendment</dd>
                  </div>
                ) : null}
              </dl>

              <div className="flex flex-wrap justify-end gap-2">
                {obligation.capabilities.canCreateTask ? (
                  <Button variant="ghost" size="sm" onClick={() => setTaskFor(obligation)}>
                    Create task
                  </Button>
                ) : null}
                {obligation.capabilities.canEdit ? (
                  <Button variant="secondary" size="sm" onClick={() => setEditing(obligation)}>
                    Edit
                  </Button>
                ) : null}
                {obligation.capabilities.canCancel ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => close(obligation, "cancel")}
                  >
                    Cancel
                  </Button>
                ) : null}
                {obligation.capabilities.canComplete ? (
                  <Button size="sm" disabled={pending} onClick={() => close(obligation, "complete")}>
                    Mark complete
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ObligationDialog
        open={adding || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditing(null);
          }
        }}
        contractId={contractId}
        obligation={editing}
        members={members}
        onSaved={() => {
          setAdding(false);
          setEditing(null);
          router.refresh();
        }}
      />

      <TaskDialog
        open={taskFor !== null}
        onOpenChange={(open) => (open ? undefined : setTaskFor(null))}
        contractId={contractId}
        obligation={taskFor}
        members={members}
        onSaved={() => {
          setTaskFor(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/**
 * The obligation and task dialogs hold forms registered with the unsaved-work
 * coordinator: the X, Escape, the backdrop and Cancel ask before throwing typed
 * input away, and a save has an explicit outcome (AUD-03 §3, §5).
 */
function ObligationDialog({
  open,
  onOpenChange,
  contractId,
  obligation,
  members,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  obligation: ContractObligationDTO | null;
  members: { value: string; label: string }[];
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{obligation ? "Edit obligation" : "Record an obligation"}</DialogTitle>
        <DialogDescription>
          What the agreement requires, and by when. Recording one against a live contract does not
          change its terms.
        </DialogDescription>
        <ObligationForm contractId={contractId} obligation={obligation} members={members} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  );
}

function ObligationForm({
  contractId,
  obligation,
  members,
  onSaved,
}: {
  contractId: string;
  obligation: ContractObligationDTO | null;
  members: { value: string; label: string }[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => saveObligationAction(contractId, obligation?.id ?? null, formData),
    module: "contracts",
    saveKind: obligation ? "save" : "create",
    label: obligation ? obligation.title : "New obligation",
    onCommitted: () => {
      toast({ title: obligation ? "Obligation updated." : "Obligation recorded.", tone: "success" });
      onSaved();
      return true;
    },
  });
  const { pending } = save;

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="mt-4 space-y-3">
      <SaveMessages save={save} />
      <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-3 border-0 p-0">
        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" defaultValue={obligation?.title ?? ""} required maxLength={250} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="obligationType">Type</Label>
            <select
              id="obligationType"
              name="obligationType"
              className={selectClass}
              defaultValue={obligation?.type ?? "DELIVERABLE"}
            >
              {OBLIGATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {obligationTypeLabels[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dueDate">Due date</Label>
            <Input id="dueDate" name="dueDate" type="date" defaultValue={obligation?.dueDate ?? ""} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="responsibleMemberId">Responsible</Label>
          <select
            id="responsibleMemberId"
            name="responsibleMemberId"
            className={selectClass}
            defaultValue={obligation?.responsible?.memberId ?? ""}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            maxLength={5000}
            defaultValue={obligation?.description ?? ""}
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <UnsavedIndicator save={save} />
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : obligation ? "Save obligation" : "Record obligation"}
        </Button>
      </div>
    </form>
  );
}

function TaskDialog({
  open,
  onOpenChange,
  contractId,
  obligation,
  members,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  obligation: ContractObligationDTO | null;
  members: { value: string; label: string }[];
  onSaved: () => void;
}) {
  // Kept through the closing animation, so the form does not vanish mid-fade.
  const last = React.useRef(obligation);
  if (obligation) last.current = obligation;
  const shown = obligation ?? last.current;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Create a task</DialogTitle>
        <DialogDescription>
          The task is a normal NESTO task. It appears in /tasks like any other work, and it points
          back at this obligation.
        </DialogDescription>
        {shown ? <TaskForm key={shown.id} contractId={contractId} obligation={shown} members={members} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  contractId,
  obligation,
  members,
  onSaved,
}: {
  contractId: string;
  obligation: ContractObligationDTO;
  members: { value: string; label: string }[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => createObligationTaskAction(contractId, obligation.id, formData),
    module: "contracts",
    saveKind: "create",
    label: "New task",
    onCommitted: () => {
      toast({ title: "Task created.", tone: "success" });
      onSaved();
      return true;
    },
  });
  const { pending } = save;

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="mt-4 space-y-3">
      <SaveMessages save={save} />
      <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-3 border-0 p-0">
        <div className="space-y-1.5">
          <Label htmlFor="task-title">Title</Label>
          <Input id="task-title" name="title" defaultValue={obligation.title} required maxLength={200} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="assigneeMemberId">Assignee</Label>
            <select
              id="assigneeMemberId"
              name="assigneeMemberId"
              className={selectClass}
              defaultValue={obligation.responsible?.memberId ?? ""}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.value} value={member.value}>
                  {member.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-due">Due date</Label>
            <Input id="task-due" name="dueDate" type="date" defaultValue={obligation.dueDate ?? ""} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="task-description">Description</Label>
          <Textarea id="task-description" name="description" rows={3} maxLength={2000} />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <UnsavedIndicator save={save} />
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create task"}
        </Button>
      </div>
    </form>
  );
}
