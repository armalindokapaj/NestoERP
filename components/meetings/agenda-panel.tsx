"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Check, CornerUpRight, GripVertical, Loader2, Pencil, Plus, SkipForward, Trash2 } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { PersonLink } from "@/components/people/person-link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { AGENDA_STATUS_LABELS, AGENDA_TEMPLATES, type MeetingAgendaItemDTO, type MeetingDetailDTO } from "@/lib/modules/meetings/meeting.types";
import { cn } from "@/lib/utils/cn";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { failureMessage, meetingApi, meetingFailureOutcome } from "./meeting-api";
import { durationLabel, PlainText } from "./meeting-ui";
import { useMeetingDraft } from "./use-meeting-draft";

/**
 * The agenda (PRD #40 §34-§40, §96, §103, §218-§220, §243).
 *
 * Ordered cards. Order changes by dragging or by the arrow buttons — the
 * keyboard and screen-reader alternative — and is saved optimistically, rolled
 * back if the server refuses. During the meeting each item can be marked
 * discussed, skipped or deferred, and the first open item is the current one.
 */

type Draft = { title: string; description: string; presenterMemberId: string; plannedMinutes: string };
const EMPTY: Draft = { title: "", description: "", presenterMemberId: "", plannedMinutes: "" };
const sameDraft = (a: Draft, b: Draft) => a.title === b.title && a.description === b.description && a.presenterMemberId === b.presenterMemberId && a.plannedMinutes === b.plannedMinutes;

export function AgendaPanel({ meeting, onChange, variant = "full" }: { meeting: MeetingDetailDTO; onChange: (detail: MeetingDetailDTO) => void; variant?: "full" | "focus" }) {
  const toast = useToast();
  const editable = meeting.capabilities.canManageAgenda;
  const live = meeting.status === "IN_PROGRESS";
  const [items, setItems] = React.useState(meeting.agenda);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState<Draft>(EMPTY);
  const [editBase, setEditBase] = React.useState<Draft>(EMPTY);
  const [deleting, setDeleting] = React.useState<MeetingAgendaItemDTO | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [dragged, setDragged] = React.useState<string | null>(null);
  const [template, setTemplate] = React.useState(AGENDA_TEMPLATES[0].key);
  const [announcement, setAnnouncement] = React.useState("");
  React.useEffect(() => setItems(meeting.agenda), [meeting.agenda]);

  const planned = items.reduce((total, item) => total + (item.plannedMinutes ?? 0), 0);
  const length = Math.round((new Date(meeting.endsAt).getTime() - new Date(meeting.startsAt).getTime()) / 60_000);
  const current = live ? items.find((item) => item.status === "PENDING") ?? null : null;
  const presenters = meeting.participants.filter((person) => person.active);

  async function send(key: string, url: string, init: { method?: string; body?: unknown }, success?: string): Promise<SaveOutcome> {
    setPending(key);
    try {
      const detail = await meetingApi<MeetingDetailDTO>(url, init);
      onChange(detail);
      if (success) toast({ title: success, tone: "success" });
      return { kind: "committed" };
    } catch (error) {
      toast({ title: failureMessage(error, "The agenda could not be saved."), tone: "danger" });
      return meetingFailureOutcome(error);
    } finally {
      setPending(null);
    }
  }

  async function call(key: string, url: string, init: { method?: string; body?: unknown }, success?: string) {
    return (await send(key, url, init, success)).kind === "committed";
  }

  const bodyOf = (value: Draft) => ({
    title: value.title.trim(),
    description: value.description.trim() || null,
    presenterMemberId: value.presenterMemberId || null,
    // Empty is "no length"; text that is not a number goes as typed, for the server to refuse (AUD-09 §4).
    plannedMinutes: value.plannedMinutes.trim() === "" ? null : Number.isFinite(Number(value.plannedMinutes)) ? Number(value.plannedMinutes) : value.plannedMinutes.trim(),
  });

  // The topic being added and the one being edited are unsaved work (AUD-03 §3).
  const adder = useMeetingDraft({
    label: "New agenda topic",
    saveKind: "create",
    dirty: !sameDraft(draft, EMPTY),
    send: async () => {
      if (!draft.title.trim()) return { kind: "invalid" };
      const outcome = await send("add", `/api/meetings/${meeting.id}/agenda`, { body: bodyOf(draft) });
      if (outcome.kind === "committed") setDraft(EMPTY);
      return outcome;
    },
  });
  const editor = useMeetingDraft({
    label: () => `Agenda topic: ${edit.title.trim() || editBase.title}`,
    saveKind: "save",
    dirty: editing !== null && !sameDraft(edit, editBase),
    send: async () => {
      if (editing === null) return { kind: "committed" };
      if (!edit.title.trim()) return { kind: "invalid" };
      const outcome = await send(editing, `/api/meetings/${meeting.id}/agenda/${editing}`, { method: "PATCH", body: bodyOf(edit) });
      if (outcome.kind === "committed") setEditing(null);
      return outcome;
    },
  });

  function add(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return;
    void adder.save();
  }

  function startEdit(item: MeetingAgendaItemDTO) {
    const value = { title: item.title, description: item.description ?? "", presenterMemberId: item.presenter?.memberId ?? "", plannedMinutes: item.plannedMinutes ? String(item.plannedMinutes) : "" };
    // Opening another topic replaces the one being edited: ask first.
    void editor.dismiss(() => {
      setEditing(item.id);
      setEdit(value);
      setEditBase(value);
    });
  }

  async function reorder(next: MeetingAgendaItemDTO[], moved?: MeetingAgendaItemDTO) {
    const previous = items;
    setItems(next);
    if (moved) setAnnouncement(`${moved.title} moved to position ${next.findIndex((item) => item.id === moved.id) + 1} of ${next.length}.`);
    const ok = await call("reorder", `/api/meetings/${meeting.id}/agenda/reorder`, { body: { itemIds: next.map((item) => item.id) } });
    if (!ok) setItems(previous);
  }

  function move(index: number, by: number) {
    const target = index + by;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    void reorder(next, item);
  }

  function drop(overId: string) {
    if (!dragged || dragged === overId) return;
    const next = [...items];
    const from = next.findIndex((item) => item.id === dragged);
    const to = next.findIndex((item) => item.id === overId);
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setDragged(null);
    void reorder(next, item);
  }

  const form = (value: Draft, change: (value: Draft) => void, idPrefix: string) => (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_110px]">
      <div className="space-y-1 sm:col-span-3">
        <Label htmlFor={`${idPrefix}-title`}>Topic</Label>
        <Input id={`${idPrefix}-title`} autoFocus value={value.title} maxLength={180} onChange={(event) => change({ ...value, title: event.target.value })} placeholder="Site progress" />
      </div>
      <div className="space-y-1 sm:col-span-1">
        <Label htmlFor={`${idPrefix}-description`}>Notes (optional)</Label>
        <Textarea id={`${idPrefix}-description`} rows={1} maxLength={5000} value={value.description} onChange={(event) => change({ ...value, description: event.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-presenter`}>Presenter</Label>
        <select id={`${idPrefix}-presenter`} className={selectClass} value={value.presenterMemberId} onChange={(event) => change({ ...value, presenterMemberId: event.target.value })}>
          <option value="">No presenter</option>
          {presenters.map((person) => (
            <option key={person.memberId} value={person.memberId}>
              {person.fullName}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-minutes`}>Minutes</Label>
        <Input id={`${idPrefix}-minutes`} type="number" min={1} max={1440} value={value.plannedMinutes} onChange={(event) => change({ ...value, plannedMinutes: event.target.value })} />
      </div>
    </div>
  );

  return (
    <section aria-labelledby={`agenda-${variant}`} className={cn(variant === "full" && "space-y-4")} data-testid="agenda-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={`agenda-${variant}`} className="text-card font-semibold text-fg">
            Agenda
          </h2>
          {items.length > 0 ? (
            <p className={cn("text-meta", planned > length ? "text-warning-strong" : "text-fg-subtle")}>
              {items.length} {items.length === 1 ? "topic" : "topics"}
              {planned > 0 ? ` · ${durationLabel("2000-01-01T00:00:00Z", new Date(Date.UTC(2000, 0, 1, 0, planned)).toISOString())} planned of ${durationLabel(meeting.startsAt, meeting.endsAt)}` : ""}
            </p>
          ) : null}
        </div>
        {editable && !adding && variant === "full" ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add topic
          </Button>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface-muted px-5 py-8 text-center">
          <p className="text-table font-medium text-fg">No agenda yet.</p>
          <p className="mt-1 text-meta text-fg-muted">Structured topics keep a meeting on time. Start from a template or add topics one by one.</p>
          {editable ? (
            <div className="mx-auto mt-4 flex max-w-sm flex-col gap-2 sm:flex-row">
              <select aria-label="Agenda template" className={selectClass} value={template} onChange={(event) => setTemplate(event.target.value)}>
                {AGENDA_TEMPLATES.map((row) => (
                  <option key={row.key} value={row.key}>
                    {row.label}
                  </option>
                ))}
              </select>
              <Button type="button" variant="secondary" disabled={pending !== null} onClick={() => void call("template", `/api/meetings/${meeting.id}/agenda/template`, { body: { template } }, "Template added")}>
                {pending === "template" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                Use template
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <ol className={cn("space-y-2", variant === "focus" && "mt-3")} aria-label="Agenda topics">
          {items.map((item, index) => {
            const isCurrent = current?.id === item.id;
            const done = item.status !== "PENDING";
            return (
              <li
                key={item.id}
                draggable={editable && editing === null && variant === "full"}
                onDragStart={() => setDragged(item.id)}
                onDragOver={(event) => {
                  if (dragged) event.preventDefault();
                }}
                onDrop={() => drop(item.id)}
                onDragEnd={() => setDragged(null)}
                data-testid="agenda-item"
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "group rounded-xl border bg-surface transition-[border-color,box-shadow,opacity]",
                  isCurrent ? "border-accent/50 shadow-[0_0_0_3px_color-mix(in_oklab,var(--nesto-accent)_12%,transparent)]" : "border-line",
                  dragged === item.id && "opacity-50",
                )}
              >
                {editing === item.id ? (
                  <form
                    className="space-y-3 p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void editor.save();
                    }}
                  >
                    {form(edit, setEdit, `agenda-edit-${item.id}`)}
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => void editor.dismiss(() => setEditing(null))}>
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={pending === item.id || !edit.title.trim()}>
                        Save
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-start gap-3 p-3.5 sm:p-4">
                    {editable && variant === "full" ? (
                      <span aria-hidden="true" className="hidden cursor-grab pt-0.5 text-fg-subtle opacity-40 group-hover:opacity-100 sm:block">
                        <GripVertical className="size-4" />
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-meta font-semibold tabular-nums",
                        item.status === "DISCUSSED" ? "bg-success-soft text-success-strong" : isCurrent ? "bg-accent text-accent-fg" : "bg-surface-muted text-fg-muted",
                      )}
                    >
                      {item.status === "DISCUSSED" ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-body font-medium text-fg", (item.status === "SKIPPED" || item.status === "DEFERRED") && "text-fg-muted")}>
                        {item.title}
                        {done ? <span className="ml-2 text-meta font-normal text-fg-subtle">{AGENDA_STATUS_LABELS[item.status]}</span> : null}
                        {isCurrent ? <span className="ml-2 text-meta font-medium text-accent-strong">Now</span> : null}
                      </p>
                      <p className="mt-0.5 text-meta text-fg-subtle">
                        {item.presenter ? <PersonLink memberId={item.presenter.memberId} name={item.presenter.fullName} /> : null}
                        {item.presenter && item.plannedMinutes ? " · " : null}
                        {item.plannedMinutes ? `${item.plannedMinutes} min` : null}
                      </p>
                      {item.description ? <PlainText text={item.description} className="mt-1.5 text-table text-fg-muted" /> : null}

                      {editable && (live || meeting.status === "COMPLETED") ? (
                        <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label={`Mark ${item.title}`}>
                          {(
                            [
                              ["DISCUSSED", "Discussed", Check],
                              ["SKIPPED", "Skip", SkipForward],
                              ["DEFERRED", "Defer", CornerUpRight],
                            ] as const
                          ).map(([status, label, Icon]) => (
                            <button
                              key={status}
                              type="button"
                              aria-pressed={item.status === status}
                              disabled={pending === item.id}
                              onClick={() => void call(item.id, `/api/meetings/${meeting.id}/agenda/${item.id}`, { method: "PATCH", body: { status: item.status === status ? "PENDING" : status } })}
                              className={cn(
                                "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-meta transition-colors",
                                item.status === status ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                              )}
                            >
                              <Icon aria-hidden="true" className="size-3.5" />
                              {label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {editable && variant === "full" ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button type="button" aria-label={`Move ${item.title} up`} disabled={index === 0 || pending === "reorder"} onClick={() => move(index, -1)} className="rounded-md p-1.5 text-fg-subtle hover:bg-hover hover:text-fg disabled:opacity-30">
                          <ArrowUp aria-hidden="true" className="size-4" />
                        </button>
                        <button type="button" aria-label={`Move ${item.title} down`} disabled={index === items.length - 1 || pending === "reorder"} onClick={() => move(index, 1)} className="rounded-md p-1.5 text-fg-subtle hover:bg-hover hover:text-fg disabled:opacity-30">
                          <ArrowDown aria-hidden="true" className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Edit ${item.title}`}
                          onClick={() => startEdit(item)}
                          className="rounded-md p-1.5 text-fg-subtle hover:bg-hover hover:text-fg"
                        >
                          <Pencil aria-hidden="true" className="size-4" />
                        </button>
                        <button type="button" aria-label={`Remove ${item.title}`} onClick={() => setDeleting(item)} className="rounded-md p-1.5 text-fg-subtle hover:bg-hover hover:text-danger-strong">
                          <Trash2 aria-hidden="true" className="size-4" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {editable && adding && variant === "full" ? (
        <form onSubmit={add} className="space-y-3 rounded-xl border border-line bg-surface-muted p-4" data-testid="agenda-add-form">
          {form(draft, setDraft, "agenda-new")}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                void adder.dismiss(() => {
                  setAdding(false);
                  setDraft(EMPTY);
                })
              }
            >
              Done
            </Button>
            <Button type="submit" size="sm" disabled={pending === "add" || !draft.title.trim()}>
              {pending === "add" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Plus aria-hidden="true" />}
              Add topic
            </Button>
          </div>
        </form>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? null : setDeleting(null))}
        title="Remove this topic?"
        description={`“${deleting?.title ?? ""}” comes off the agenda.`}
        confirmLabel="Remove topic"
        pending={pending !== null}
        onConfirm={async () => {
          if (deleting && (await call(deleting.id, `/api/meetings/${meeting.id}/agenda/${deleting.id}`, { method: "DELETE" }))) setDeleting(null);
        }}
      />
    </section>
  );
}
