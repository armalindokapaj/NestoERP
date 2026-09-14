"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bold, ChevronDown, Heading2, Italic, Link2, List, ListOrdered, Quote } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { AnnouncementOptionsDTO } from "@/lib/modules/announcements/announcement.service";
import { ANNOUNCEMENT_PRIORITIES, AUDIENCE_LABELS, BODY_MAX, PRIORITY_LABELS, TITLE_MAX, type AnnouncementPriority, type AudienceType } from "@/lib/modules/announcements/announcement.types";
import { cn } from "@/lib/utils/cn";
import { announcementApi, failureMessage, isFailure } from "./announcement-api";
import { AnnouncementBody } from "./announcement-body";

/**
 * The announcement editor (PRD #45 §35, §36, §146-§153, §226).
 *
 * Title, audience, priority and body first; dates, pinning, acknowledgment and
 * the event behind a fold. The body is plain text with a handful of marks the
 * toolbar inserts, previewed exactly as readers will see it. The server
 * decides what may change — a published announcement's audience, and its
 * content once acknowledged, arrive here already locked.
 */

export type EditorValues = {
  title: string;
  body: string;
  priority: AnnouncementPriority;
  audienceType: AudienceType;
  projectId: string;
  departmentId: string;
  selectedMemberIds: string[];
  expiresAt: string;
  eventStartsAt: string;
  eventEndsAt: string;
  pinned: boolean;
  requiresAcknowledgment: boolean;
};

const TEMPLATES: Array<{ key: string; label: string; title: string; body: string; priority?: AnnouncementPriority; audienceType?: AudienceType; requiresAcknowledgment?: boolean }> = [
  { key: "general", label: "General notice", title: "", body: "## What is changing\n\n\n## What you need to do\n\n- \n" },
  { key: "project", label: "Project notice", title: "", body: "## Site update\n\n\n## Actions for the team\n\n- \n", audienceType: "PROJECT" },
  { key: "training", label: "Training", title: "Training: ", body: "## Session\n\n**When:** \n**Where:** \n\n## Who should attend\n\n- \n" },
  { key: "closure", label: "Office closure", title: "Office closed on ", body: "The office will be closed on **date**.\n\n> Site work continues as planned unless your project manager says otherwise.\n", priority: "IMPORTANT" },
  { key: "policy", label: "Policy update", title: "Policy update: ", body: "## Summary\n\n\n## What changes for you\n\n1. \n\nPlease read the attached policy and acknowledge below.\n", priority: "IMPORTANT", requiresAcknowledgment: true },
];

/** A `datetime-local` value in the browser's zone, for an ISO instant. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const toIso = (value: string) => (value ? new Date(value).toISOString() : null);

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-meta font-medium text-fg-muted">
        {label}
      </label>
      {children}
      {error ? <p className="text-meta text-danger-strong">{error}</p> : hint ? <p className="text-meta text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

export function AnnouncementEditor({
  mode,
  announcementId,
  version,
  initial,
  options,
  lockedAudience = false,
  lockedContent = false,
  lockedAcknowledgment = false,
}: {
  mode: "create" | "edit";
  announcementId?: string;
  version?: number;
  initial: EditorValues;
  options: AnnouncementOptionsDTO;
  lockedAudience?: boolean;
  lockedContent?: boolean;
  lockedAcknowledgment?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"draft" | "publish" | null>(null);
  const [more, setMore] = React.useState(Boolean(initial.expiresAt || initial.eventStartsAt || initial.pinned || initial.requiresAcknowledgment));
  const [preview, setPreview] = React.useState(false);
  const [memberFilter, setMemberFilter] = React.useState("");
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const set = <K extends keyof EditorValues>(key: K, value: EditorValues[K]) => setValues((current) => ({ ...current, [key]: value }));

  function wrap(before: string, after = before, placeholder = "text") {
    const element = bodyRef.current;
    if (!element || lockedContent) return;
    const { selectionStart: start, selectionEnd: end } = element;
    const selected = values.body.slice(start, end) || placeholder;
    const next = `${values.body.slice(0, start)}${before}${selected}${after}${values.body.slice(end)}`;
    set("body", next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function prefixLines(prefix: (index: number) => string) {
    const element = bodyRef.current;
    if (!element || lockedContent) return;
    const start = values.body.lastIndexOf("\n", element.selectionStart - 1) + 1;
    const end = element.selectionEnd;
    const lines = values.body.slice(start, end).split("\n");
    const replaced = lines.map((line, index) => `${prefix(index)}${line}`).join("\n");
    set("body", `${values.body.slice(0, start)}${replaced}${values.body.slice(end)}`);
    requestAnimationFrame(() => element.focus());
  }

  async function save(publish: boolean) {
    setErrors({});
    setFormError(null);
    const found: Record<string, string> = {};
    if (!values.title.trim()) found.title = "Give it a title.";
    if (!values.body.trim()) found.body = "Write the announcement.";
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setPending(publish ? "publish" : "draft");
    const payload = {
      title: values.title,
      body: values.body,
      priority: values.priority,
      audienceType: values.audienceType,
      projectId: values.audienceType === "PROJECT" ? values.projectId || null : null,
      departmentId: values.audienceType === "DEPARTMENT" ? values.departmentId || null : null,
      selectedMemberIds: values.audienceType === "SELECTED_MEMBERS" ? values.selectedMemberIds : [],
      expiresAt: toIso(values.expiresAt),
      eventStartsAt: toIso(values.eventStartsAt),
      eventEndsAt: toIso(values.eventEndsAt),
      pinned: values.pinned,
      requiresAcknowledgment: values.requiresAcknowledgment,
    };
    try {
      let id = announcementId;
      let nextVersion = version;
      if (mode === "create") {
        const created = await announcementApi<{ id: string; version: number }>("/api/announcements", { body: payload });
        id = created.id;
        nextVersion = created.version;
      } else {
        const updated = await announcementApi<{ version: number }>(`/api/announcements/${announcementId}`, { method: "PATCH", body: { ...payload, expectedVersion: version } });
        nextVersion = updated.version;
      }
      if (publish) {
        await announcementApi(`/api/announcements/${id}/publish`, { body: { expectedVersion: nextVersion } });
        toast({ title: "Announcement published", tone: "success" });
      } else {
        toast({ title: mode === "create" ? "Draft saved" : "Changes saved", tone: "success" });
      }
      router.push(`/announcements/${id}`);
      router.refresh();
    } catch (error) {
      if (isFailure(error)) {
        const field: Record<string, string> = {};
        for (const [key, value] of Object.entries(error.details)) if (Array.isArray(value) && typeof value[0] === "string") field[key] = value[0];
        if (typeof error.details.field === "string") field[error.details.field] = error.message;
        setErrors(field);
      }
      setFormError(failureMessage(error, "The announcement could not be saved."));
    } finally {
      setPending(null);
    }
  }

  const members = options.members.filter((member) => !memberFilter || member.label.toLowerCase().includes(memberFilter.toLowerCase()));
  const tool = "inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-40";

  return (
    <form
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
      noValidate
      data-testid="announcement-editor"
    >
      <div className="space-y-5">
        {mode === "create" ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Start from a template">
            <span className="text-meta text-fg-subtle">Start from</span>
            {TEMPLATES.filter((template) => !template.audienceType || options.audiences.includes(template.audienceType)).map((template) => (
              <button
                key={template.key}
                type="button"
                className="rounded-full border border-line px-2.5 py-0.5 text-meta text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
                onClick={() => setValues((current) => ({ ...current, title: current.title || template.title, body: template.body, priority: template.priority ?? current.priority, audienceType: template.audienceType ?? current.audienceType, requiresAcknowledgment: template.requiresAcknowledgment ?? current.requiresAcknowledgment }))}
              >
                {template.label}
              </button>
            ))}
          </div>
        ) : null}

        <Field label="Title" htmlFor="announcement-title" error={errors.title}>
          <Input id="announcement-title" value={values.title} onChange={(event) => set("title", event.target.value)} maxLength={TITLE_MAX} disabled={lockedContent} className="h-11 text-body font-medium" autoFocus={mode === "create"} />
        </Field>

        <fieldset className="space-y-2" disabled={lockedAudience}>
          <legend className="text-meta font-medium text-fg-muted">Audience</legend>
          <div className="flex flex-wrap gap-1.5">
            {options.audiences.map((type) => (
              <label key={type} className={cn("cursor-pointer rounded-lg border px-3 py-1.5 text-table transition-colors", values.audienceType === type ? "border-accent/50 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong", lockedAudience && "cursor-not-allowed opacity-60")}>
                <input type="radio" name="audienceType" value={type} checked={values.audienceType === type} onChange={() => set("audienceType", type)} className="sr-only" />
                {AUDIENCE_LABELS[type]}
              </label>
            ))}
            {!options.audiences.includes(values.audienceType) ? <span className="rounded-lg border border-line px-3 py-1.5 text-table text-fg-muted">{AUDIENCE_LABELS[values.audienceType]}</span> : null}
          </div>
          {lockedAudience ? <p className="text-meta text-fg-subtle">A published announcement keeps its audience. Duplicate it to reach other people.</p> : null}
          {values.audienceType === "PROJECT" ? (
            <Field label="Project" htmlFor="announcement-project" error={errors.projectId}>
              <select id="announcement-project" className={selectClass} value={values.projectId} onChange={(event) => set("projectId", event.target.value)}>
                <option value="">Choose a project</option>
                {options.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {values.audienceType === "DEPARTMENT" ? (
            <Field label="Department" htmlFor="announcement-department" error={errors.departmentId}>
              <select id="announcement-department" className={selectClass} value={values.departmentId} onChange={(event) => set("departmentId", event.target.value)}>
                <option value="">Choose a department</option>
                {options.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {values.audienceType === "SELECTED_MEMBERS" ? (
            <div className="rounded-lg border border-line" data-testid="announcement-members">
              <div className="border-b border-line p-2">
                <Input aria-label="Find people" placeholder="Find people" value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} className="h-9" />
              </div>
              <ul className="max-h-48 overflow-y-auto p-1">
                {members.map((member) => (
                  <li key={member.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-table hover:bg-hover">
                      <Checkbox checked={values.selectedMemberIds.includes(member.id)} onCheckedChange={(checked) => set("selectedMemberIds", checked === true ? [...values.selectedMemberIds, member.id] : values.selectedMemberIds.filter((id) => id !== member.id))} aria-label={member.label} />
                      {member.label}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-3 py-1.5 text-meta text-fg-muted">{values.selectedMemberIds.length} selected</p>
              {errors.selectedMemberIds ? <p className="px-3 pb-2 text-meta text-danger-strong">{errors.selectedMemberIds}</p> : null}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-meta font-medium text-fg-muted">Priority</legend>
          <div className="flex flex-wrap gap-1.5">
            {ANNOUNCEMENT_PRIORITIES.map((priority) => (
              <label key={priority} className={cn("cursor-pointer rounded-lg border px-3 py-1.5 text-table transition-colors", values.priority === priority ? (priority === "CRITICAL" ? "border-danger/50 bg-danger-soft font-medium text-danger-strong" : priority === "IMPORTANT" ? "border-warning/50 bg-warning-soft font-medium text-warning-strong" : "border-accent/50 bg-accent-soft font-medium text-accent-strong") : "border-line text-fg-muted hover:border-line-strong")}>
                <input type="radio" name="priority" value={priority} checked={values.priority === priority} onChange={() => set("priority", priority)} className="sr-only" />
                {PRIORITY_LABELS[priority]}
              </label>
            ))}
          </div>
          <p className="text-meta text-fg-subtle">
            {values.priority === "CRITICAL" ? "For closures, outages and immediate safety restrictions: everyone addressed is notified and sees a banner." : values.priority === "IMPORTANT" ? "Everyone addressed is notified." : "Appears in the feed without a notification."}
          </p>
        </fieldset>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="announcement-body" className="text-meta font-medium text-fg-muted">
              Body
            </label>
            <button type="button" className="text-meta font-medium text-accent-strong lg:hidden" onClick={() => setPreview((value) => !value)}>
              {preview ? "Edit" : "Preview"}
            </button>
          </div>
          <div className={cn("rounded-lg border border-line bg-surface", preview && "hidden lg:block")}>
            <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1" role="toolbar" aria-label="Formatting">
              <button type="button" className={tool} aria-label="Heading" disabled={lockedContent} onClick={() => prefixLines(() => "## ")}>
                <Heading2 className="size-4" />
              </button>
              <button type="button" className={tool} aria-label="Bold" disabled={lockedContent} onClick={() => wrap("**")}>
                <Bold className="size-4" />
              </button>
              <button type="button" className={tool} aria-label="Italic" disabled={lockedContent} onClick={() => wrap("*")}>
                <Italic className="size-4" />
              </button>
              <button type="button" className={tool} aria-label="Bulleted list" disabled={lockedContent} onClick={() => prefixLines(() => "- ")}>
                <List className="size-4" />
              </button>
              <button type="button" className={tool} aria-label="Numbered list" disabled={lockedContent} onClick={() => prefixLines((index) => `${index + 1}. `)}>
                <ListOrdered className="size-4" />
              </button>
              <button type="button" className={tool} aria-label="Callout" disabled={lockedContent} onClick={() => prefixLines(() => "> ")}>
                <Quote className="size-4" />
              </button>
              <button type="button" className={tool} aria-label="Link" disabled={lockedContent} onClick={() => wrap("[", "](https://)", "link text")}>
                <Link2 className="size-4" />
              </button>
            </div>
            <Textarea ref={bodyRef} id="announcement-body" value={values.body} onChange={(event) => set("body", event.target.value)} rows={14} maxLength={BODY_MAX} disabled={lockedContent} className="min-h-72 rounded-t-none border-0 font-mono text-table leading-6 focus:ring-0" />
          </div>
          {errors.body ? <p className="text-meta text-danger-strong">{errors.body}</p> : lockedContent ? <p className="text-meta text-fg-subtle">People have acknowledged this announcement, so its content stays as they read it.</p> : <p className="text-meta text-fg-subtle"># heading, **bold**, *italic*, - list, 1. list, &gt; callout, [link](https://…)</p>}
        </div>

        <button type="button" onClick={() => setMore((value) => !value)} aria-expanded={more} className="flex items-center gap-1.5 text-table font-medium text-accent-strong">
          <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", !more && "-rotate-90")} />
          Dates, pinning and acknowledgment
        </button>
        {more ? (
          <div className="space-y-4 rounded-lg border border-line bg-surface-muted/40 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Expires" htmlFor="announcement-expires" error={errors.expiresAt} hint="Leaves the feed, stays in history.">
                <Input id="announcement-expires" type="datetime-local" value={values.expiresAt} onChange={(event) => set("expiresAt", event.target.value)} />
              </Field>
              <Field label="Event starts" htmlFor="announcement-event-start" error={errors.eventStartsAt} hint="Puts it on the calendar.">
                <Input id="announcement-event-start" type="datetime-local" value={values.eventStartsAt} onChange={(event) => set("eventStartsAt", event.target.value)} />
              </Field>
              <Field label="Event ends" htmlFor="announcement-event-end" error={errors.eventEndsAt}>
                <Input id="announcement-event-end" type="datetime-local" value={values.eventEndsAt} onChange={(event) => set("eventEndsAt", event.target.value)} />
              </Field>
            </div>
            <div className="flex flex-col gap-2">
              {options.canPin ? (
                <label className="flex items-center gap-2 text-table text-fg">
                  <Checkbox checked={values.pinned} onCheckedChange={(checked) => set("pinned", checked === true)} aria-label="Pin above other announcements" />
                  Pin above other announcements
                </label>
              ) : null}
              <label className={cn("flex items-center gap-2 text-table text-fg", lockedAcknowledgment && "opacity-60")}>
                <Checkbox checked={values.requiresAcknowledgment} disabled={lockedAcknowledgment} onCheckedChange={(checked) => set("requiresAcknowledgment", checked === true)} aria-label="Ask readers to acknowledge" />
                Ask readers to acknowledge they have read it
              </label>
              <p className="text-meta text-fg-subtle">An acknowledgment confirms someone read it. It is not a signature, a legal consent or a competence record.</p>
            </div>
          </div>
        ) : null}

        {formError ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-table text-danger-strong">
            {formError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant={options.canPublish && mode === "create" ? "secondary" : "primary"} disabled={Boolean(pending)}>
            {pending === "draft" ? "Saving…" : mode === "create" ? "Save draft" : "Save changes"}
          </Button>
          {options.canPublish && mode === "create" ? (
            <Button type="button" disabled={Boolean(pending)} onClick={() => void save(true)}>
              {pending === "publish" ? "Publishing…" : "Publish now"}
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link href={announcementId ? `/announcements/${announcementId}` : "/announcements?tab=manage"}>Cancel</Link>
          </Button>
        </div>
      </div>

      <aside className={cn("space-y-3 lg:sticky lg:top-24 lg:self-start", !preview && "hidden lg:block")} aria-label="Preview">
        <p className="text-meta font-medium uppercase tracking-[0.08em] text-fg-subtle">Preview</p>
        <article className="rounded-xl border border-line bg-surface px-6 py-5">
          <h2 className="text-section font-semibold tracking-tight text-fg">{values.title || "Untitled announcement"}</h2>
          <div className="mt-4">{values.body.trim() ? <AnnouncementBody body={values.body} /> : <p className="text-table text-fg-subtle">The body appears here as readers will see it.</p>}</div>
        </article>
      </aside>
    </form>
  );
}
