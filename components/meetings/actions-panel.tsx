"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { ArrowUpRight, ListPlus, Loader2, Plus, SquareCheckBig } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ACTION_STATUS_LABELS, type ActionTaskHandoff, type MeetingActionItemDTO, type MeetingDetailDTO } from "@/lib/modules/meetings/meeting.types";
import { statusLabel } from "@/lib/utils/status";
import { meetingsLabel } from "@/lib/i18n/modules/meetings/labels";
import { cn } from "@/lib/utils/cn";
import { ActionStatusToggle } from "./action-status-toggle";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { failureMessage, meetingApi, meetingFailureOutcome } from "./meeting-api";
import { PersonAvatar } from "./meeting-ui";
import { useMeetingsTranslations } from "./meetings-text";
import { useMeetingDraft } from "./use-meeting-draft";
import { FormSelect } from "@/components/ui/form-select";

/**
 * Action items (PRD #40 §53-§62, §106, §107, §213).
 *
 * A structured list — status, title, owner, due date, task — with a quick
 * capture that asks only for what the room decides: what, who, by when, and
 * whether it becomes a Task now. A handed-off action shows its task and
 * follows it; its own status control is replaced by the link.
 */

function dueLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function ActionsPanel({ meeting, onChange, openOnly = false, limit }: { meeting: MeetingDetailDTO; onChange: (detail: MeetingDetailDTO) => void; openOnly?: boolean; limit?: number }) {
  const toast = useToast();
  const t = useMeetingsTranslations();
  const caps = meeting.capabilities;
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [owner, setOwner] = React.useState("");
  const [ownerBase, setOwnerBase] = React.useState("");
  const [due, setDue] = React.useState("");
  const [createTask, setCreateTask] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);

  const owners = meeting.participants.filter((person) => person.active);
  const shown = (openOnly ? meeting.actions.filter((action) => action.status === "OPEN" || action.status === "IN_PROGRESS") : meeting.actions).slice(0, limit ?? undefined);
  const openCount = meeting.actions.filter((action) => action.status === "OPEN" || action.status === "IN_PROGRESS").length;

  async function send(key: string, url: string, init: { method?: string; body?: unknown }, success?: string): Promise<SaveOutcome> {
    setPending(key);
    try {
      const { taskHandoff, ...detail } = await meetingApi<MeetingDetailDTO & { taskHandoff?: ActionTaskHandoff | null }>(url, init);
      onChange(detail);
      // The action committed; a task that could not be created is said so, with why (AUD-10 §7).
      if (taskHandoff && !taskHandoff.created) toast({ title: t("actions.taskNotCreated"), description: taskHandoff.message, tone: "warning" });
      else if (success) toast({ title: success, tone: "success" });
      return { kind: "committed" };
    } catch (error) {
      toast({ title: failureMessage(error, t("actions.failed")), tone: "danger" });
      return meetingFailureOutcome(error);
    } finally {
      setPending(null);
    }
  }

  async function call(key: string, url: string, init: { method?: string; body?: unknown }, success?: string) {
    return (await send(key, url, init, success)).kind === "committed";
  }

  // The action being captured is unsaved work (AUD-03 §3). The owner stays
  // for the next one after an add, so it is part of the baseline then.
  const adder = useMeetingDraft({
    label: t("actions.editorLabel"),
    saveKind: "create",
    dirty: title !== "" || owner !== ownerBase || due !== "" || createTask,
    send: async () => {
      if (!title.trim()) return { kind: "invalid" };
      const outcome = await send(
        "add",
        `/api/meetings/${meeting.id}/actions`,
        { body: { title: title.trim(), description: null, ownerMemberId: owner || null, dueDate: due || null, createTask } },
        createTask ? t("actions.addedWithTask") : t("actions.added"),
      );
      if (outcome.kind === "committed") {
        setTitle("");
        setDue("");
        setCreateTask(false);
        setOwnerBase(owner);
      }
      return outcome;
    },
  });

  return (
    <section aria-labelledby={`actions-heading-${openOnly ? "open" : "all"}`} className="space-y-3" data-testid="actions-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`actions-heading-${openOnly ? "open" : "all"}`} className="text-card font-semibold text-fg">
          {openOnly ? t("actions.next") : t("actions.items")} <span className="ml-1 text-table font-normal text-fg-subtle">{openOnly ? openCount : meeting.actions.length}</span>
        </h2>
        {caps.canCreateAction && !open && !openOnly ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" />
            {t("actions.newItem")}
          </Button>
        ) : null}
      </div>

      {caps.canCreateAction && open ? (
        <form
          data-testid="action-form"
          className="space-y-3 rounded-xl border border-line bg-surface-muted p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim()) return;
            void adder.save();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="action-title">{t("actions.what")}</Label>
            <Input id="action-title" autoFocus value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} placeholder={t("actions.whatPlaceholder")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="action-owner">{t("actions.owner")}</Label>
              <FormSelect id="action-owner" className={selectClass} value={owner} onChange={(event) => setOwner(event.target.value)}>
                <option value="">{t("common.unassigned")}</option>
                {owners.map((person) => (
                  <option key={person.memberId} value={person.memberId}>
                    {person.fullName}
                  </option>
                ))}
              </FormSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="action-due">{t("actions.due")}</Label>
              <Input id="action-due" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {caps.canConvertToTask ? (
              <label className="flex items-center gap-2 text-table text-fg">
                <Switch checked={createTask} onCheckedChange={setCreateTask} aria-label={t("actions.createTask")} />
                {t("actions.createTask")}
              </label>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  void adder.dismiss(() => {
                    setOpen(false);
                    setTitle("");
                    setDue("");
                    setCreateTask(false);
                    setOwner(ownerBase);
                  })
                }
              >
                {t("common.done")}
              </Button>
              <Button type="submit" size="sm" disabled={pending === "add" || !title.trim()}>
                {pending === "add" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <ListPlus aria-hidden="true" />}
                {t("actions.addAction")}
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      {shown.length === 0 ? (
        <p className="text-table text-fg-subtle">{openOnly ? t("actions.nothingOpen") : t("actions.none")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {shown.map((action) => (
            <ActionRow key={action.id} meeting={meeting} action={action} pending={pending === action.id} onChange={onChange} onConvert={() => void call(action.id, `/api/meetings/${meeting.id}/actions/${action.id}/create-task`, { method: "POST" }, t("actions.taskCreated"))} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActionRow({
  meeting,
  action,
  pending,
  onChange,
  onConvert,
}: {
  meeting: MeetingDetailDTO;
  action: MeetingActionItemDTO;
  pending: boolean;
  onChange: (detail: MeetingDetailDTO) => void;
  onConvert: () => void;
}) {
  const t = useMeetingsTranslations();
  const closed = action.status === "DONE" || action.status === "CANCELLED";
  return (
    <li
      className="flex items-start gap-3 px-3.5 py-3 sm:px-4"
      data-testid="meeting-action"
      // A linked action's status, owner and due date are its task's (AUD-10 §5): shown, not edited here.
      title={action.capabilities.followsTask ? t("actions.followsTask") : undefined}
    >
      <span className="pt-0.5">
        <ActionStatusToggle
          meetingId={meeting.id}
          actionId={action.id}
          title={action.title}
          done={action.status === "DONE"}
          disabled={!action.capabilities.canChangeStatus}
          onChanged={(detail) => onChange(detail as MeetingDetailDTO)}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-body text-fg", closed && "text-fg-muted line-through")}>{action.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-muted">
          {action.owner ? (
            <span className="flex items-center gap-1.5">
              <PersonAvatar person={action.owner} className="size-5 text-micro" />
              <PersonLink memberId={action.owner.memberId} name={action.owner.fullName} />
            </span>
          ) : (
            <span className="text-fg-subtle">{t("common.unassigned")}</span>
          )}
          {action.dueDate ? <span className={cn("tabular-nums", action.overdue && "font-medium text-danger-strong")}>{action.overdue ? t("actions.overdueDate", { date: dueLabel(action.dueDate) }) : t("actions.dueDate", { date: dueLabel(action.dueDate) })}</span> : null}
          {action.status === "IN_PROGRESS" ? <Badge tone="info">{meetingsLabel(t, "actionStatus", "IN_PROGRESS", ACTION_STATUS_LABELS.IN_PROGRESS)}</Badge> : null}
          {action.status === "CANCELLED" ? <Badge>{meetingsLabel(t, "actionStatus", "CANCELLED", ACTION_STATUS_LABELS.CANCELLED)}</Badge> : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {action.task ? (
          action.task.href ? (
            <Link
              href={action.task.href}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-meta font-medium text-fg hover:border-line-strong"
              data-testid="action-task-link"
              aria-label={t("actions.linkedTask", { status: statusLabel(action.task.status) })}
            >
              <SquareCheckBig aria-hidden="true" className="size-3.5 text-fg-subtle" />
              {statusLabel(action.task.status)}
              <ArrowUpRight aria-hidden="true" className="size-3 text-fg-subtle" />
            </Link>
          ) : (
            <span className="text-meta text-fg-subtle">{t("actions.taskStatus", { status: statusLabel(action.task.status) })}</span>
          )
        ) : action.capabilities.canConvertToTask ? (
          <Button type="button" size="sm" variant="ghost" onClick={onConvert} disabled={pending}>
            {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <SquareCheckBig aria-hidden="true" />}
            {t("actions.convert")}
          </Button>
        ) : null}
      </span>
    </li>
  );
}
