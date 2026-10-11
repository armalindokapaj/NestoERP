"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { FileCheck2, Loader2, LockOpen, Plus, Printer, Trash2 } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import type { MeetingDetailDTO, MeetingMinutesSectionDTO } from "@/lib/modules/meetings/meeting.types";
import { meetingsLabel } from "@/lib/i18n/modules/meetings/labels";
import { cn } from "@/lib/utils/cn";
import { failureMessage, meetingApi, meetingFailureOutcome } from "./meeting-api";
import { PlainText } from "./meeting-ui";
import { useMeetingsTranslations } from "./meetings-text";

/**
 * Minutes (PRD #40 §42-§49, §108-§110, §215, §250).
 *
 * While a draft, sections save as they are written — on a pause and when the
 * field loses focus — with a quiet "Saved". Plain text only: what is typed is
 * what is shown, never interpreted as markup. Once final the minutes read as a
 * formal record, locked; reopening asks why and is audited. Text typed but
 * not yet saved counts as unsaved work, so leaving asks first (AUD-03 §3).
 */

/** The sections a draft can start from, by their key under `labels.minutesSection`. */
const SUGGESTED = ["Summary", "Discussion", "Key Points", "Risks / Issues", "Follow-Up Notes"];

export function MinutesPanel({ meeting, onChange, compact = false }: { meeting: MeetingDetailDTO; onChange: (detail: MeetingDetailDTO) => void; compact?: boolean }) {
  const toast = useToast();
  const t = useMeetingsTranslations();
  const caps = meeting.capabilities;
  const final = meeting.minutesStatus === "FINAL";
  const [pending, setPending] = React.useState<string | null>(null);
  const [confirmFinal, setConfirmFinal] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);
  const [deleting, setDeleting] = React.useState<MeetingMinutesSectionDTO | null>(null);

  async function call(key: string, url: string, init: { method?: string; body?: unknown }, success?: string) {
    setPending(key);
    try {
      onChange(await meetingApi<MeetingDetailDTO>(url, init));
      if (success) toast({ title: success, tone: "success" });
      return true;
    } catch (error) {
      toast({ title: failureMessage(error, t("minutes.failed")), tone: "danger" });
      return false;
    } finally {
      setPending(null);
    }
  }

  // A new section takes its title in the language of whoever adds it; it is the record's own text from then on.
  const titled = (key: string) => meetingsLabel(t, "minutesSection", key, key);
  const existing = new Set(meeting.minutes.map((section) => section.title));
  // Spent once a section carries the title: in English, as earlier minutes do, or as this reader would add it.
  const suggestions = SUGGESTED.filter((title) => !existing.has(title) && !existing.has(titled(title)));

  return (
    <section aria-labelledby="minutes-heading" className="space-y-4" data-testid="minutes-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="minutes-heading" className="flex items-center gap-2 text-card font-semibold text-fg">
            {t("minutes.title")}
            {final ? (
              <Badge tone="success" data-testid="minutes-status">
                <FileCheck2 aria-hidden="true" className="size-3" /> {t("minutes.final")}
              </Badge>
            ) : (
              <Badge data-testid="minutes-status">{t("minutes.draft")}</Badge>
            )}
          </h2>
          <p className="mt-1 text-meta text-fg-subtle">
            {final && meeting.minutesFinalizedAt ? (
              <>
                {t("minutes.finalizedAt", { when: new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: meeting.timezone }).format(new Date(meeting.minutesFinalizedAt)) })}
                {meeting.minutesFinalizedBy ? <>{t("minutes.by")}<PersonLink memberId={meeting.minutesFinalizedByMemberId} name={meeting.minutesFinalizedBy} /></> : null}
              </>
            ) : caps.canEditMinutes
                ? meeting.status === "COMPLETED"
                  ? t("minutes.hintCompleted")
                  : t("minutes.hintOpen")
                : t("minutes.notFinal")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {final ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/meetings/${meeting.id}/print`} target="_blank">
                <Printer aria-hidden="true" />
                {t("minutes.print")}
              </Link>
            </Button>
          ) : null}
          {caps.canReopenMinutes ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setReopening(true)}>
              <LockOpen aria-hidden="true" />
              {t("minutes.reopen")}
            </Button>
          ) : null}
          {caps.canFinalizeMinutes ? (
            <Button type="button" size="sm" onClick={() => setConfirmFinal(true)} disabled={meeting.minutes.every((section) => !section.body.trim())}>
              <FileCheck2 aria-hidden="true" />
              {t("minutes.finalize")}
            </Button>
          ) : null}
        </div>
      </div>

      {meeting.minutes.length === 0 && !caps.canEditMinutes ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface-muted px-5 py-8 text-center text-table text-fg-muted">{t("minutes.noneWritten")}</p>
      ) : null}

      {caps.canEditMinutes ? (
        <div className="space-y-3">
          {meeting.minutes.map((section) => (
            <SectionEditor key={section.id} meetingId={meeting.id} section={section} onChange={onChange} onDelete={() => setDeleting(section)} compact={compact} />
          ))}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-meta text-fg-subtle">{t("minutes.addSection")}</span>
            {[...suggestions, "Other"].map((title) => (
              <button
                key={title}
                type="button"
                disabled={pending !== null}
                onClick={() => void call(`add-${title}`, `/api/meetings/${meeting.id}/minutes/sections`, { body: { title: titled(title === "Other" ? "Notes" : title), body: "" } })}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-line px-2.5 text-meta text-fg-muted transition-colors hover:border-line-strong hover:text-fg disabled:opacity-50"
              >
                {pending === `add-${title}` ? <Loader2 aria-hidden="true" className="size-3 animate-spin" /> : <Plus aria-hidden="true" className="size-3" />}
                {titled(title)}
              </button>
            ))}
          </div>
        </div>
      ) : meeting.minutes.length > 0 ? (
        <article className={cn("rounded-xl border border-line bg-surface", final ? "px-6 py-6 sm:px-8" : "px-5 py-5")} data-testid="minutes-record">
          <div className="space-y-6">
            {meeting.minutes.map((section) => (
              <div key={section.id}>
                <h3 className="text-meta font-semibold uppercase tracking-[0.1em] text-fg-subtle">{section.title}</h3>
                {section.body.trim() ? <PlainText text={section.body} className="mt-2 text-body leading-relaxed text-fg" /> : <p className="mt-2 text-table text-fg-subtle">—</p>}
              </div>
            ))}
          </div>
        </article>
      ) : null}

      <ConfirmDialog
        open={confirmFinal}
        onOpenChange={setConfirmFinal}
        title={t("minutes.finalizeTitle")}
        description={t("minutes.finalizeDescription")}
        confirmLabel={t("minutes.finalizeConfirm")}
        destructive={false}
        pending={pending === "finalize"}
        onConfirm={async () => {
          if (await call("finalize", `/api/meetings/${meeting.id}/minutes/finalize`, { method: "POST" }, t("minutes.finalized"))) setConfirmFinal(false);
        }}
      />

      <Dialog open={reopening} onOpenChange={setReopening}>
        <DialogContent>
          <DialogTitle>{t("minutes.reopenTitle")}</DialogTitle>
          <DialogDescription>{t("minutes.reopenDescription")}</DialogDescription>
          {/* Inside the dialog, so the reason belongs to its guarded close (AUD-03 §5). */}
          <ReopenForm pending={pending === "reopen"} reopen={(reason) => call("reopen", `/api/meetings/${meeting.id}/minutes/reopen`, { body: { reason } }, t("minutes.reopened"))} onDone={() => setReopening(false)} />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? null : setDeleting(null))}
        title={t("minutes.removeTitle")}
        description={t("minutes.removeDescription", { title: deleting?.title ?? "" })}
        confirmLabel={t("minutes.removeConfirm")}
        pending={pending !== null}
        onConfirm={async () => {
          if (deleting && (await call(deleting.id, `/api/meetings/${meeting.id}/minutes/sections/${deleting.id}`, { method: "DELETE" }))) setDeleting(null);
        }}
      />
    </section>
  );
}

/** Reopening is a workflow step with a reason: the prompt never reopens (AUD-03 §3). */
function ReopenForm({ pending, reopen, onDone }: { pending: boolean; reopen: (reason: string) => Promise<boolean>; onDone: () => void }) {
  const t = useMeetingsTranslations();
  const [reason, setReason] = React.useState("");
  const editor = useUnsavedEditor({ module: "meetings", saveKind: "none", workflow: t("minutes.reopenWorkflow"), label: t("minutes.reopenLabel") });
  const { setDirty, setSaving } = editor;
  React.useEffect(() => setDirty(reason !== ""), [reason, setDirty]);
  React.useEffect(() => setSaving(pending), [pending, setSaving]);

  return (
    <>
      <div className="mt-4 space-y-1.5">
        <Label htmlFor="reopen-reason">{t("minutes.reason")}</Label>
        <Textarea id="reopen-reason" rows={3} maxLength={1000} value={reason} readOnly={pending} onChange={(event) => setReason(event.target.value)} placeholder={t("minutes.reasonPlaceholder")} />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button
          type="button"
          disabled={reason.trim().length < 3 || pending}
          onClick={async () => {
            if (await reopen(reason)) {
              setDirty(false);
              setReason("");
              onDone();
            }
          }}
        >
          {t("minutes.reopenConfirm")}
        </Button>
      </DialogFooter>
    </>
  );
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type SectionText = { title: string; body: string };

function SectionEditor({
  meetingId,
  section,
  onChange,
  onDelete,
  compact,
}: {
  meetingId: string;
  section: MeetingMinutesSectionDTO;
  onChange: (detail: MeetingDetailDTO) => void;
  onDelete: () => void;
  compact: boolean;
}) {
  const t = useMeetingsTranslations();
  const [title, setTitle] = React.useState(section.title);
  const [body, setBody] = React.useState(section.body);
  const [state, setState] = React.useState<SaveState>("idle");
  // What the server last confirmed, as state too, so what is unsent shows.
  const [saved, setSavedState] = React.useState<SectionText>({ title: section.title, body: section.body });
  const savedRef = React.useRef(saved);
  const latest = React.useRef<SectionText>({ title, body });
  latest.current = { title, body };
  const timer = React.useRef<number | null>(null);
  const inflight = React.useRef(0);

  /** What a save would send now: a cleared title keeps the saved one. */
  const outgoing = (text: SectionText): SectionText => ({ title: text.title.trim() || savedRef.current.title, body: text.body });
  const differs = (text: SectionText) => {
    const next = outgoing(text);
    return next.title !== savedRef.current.title || next.body !== savedRef.current.body;
  };

  // AUD-03 §3: an autosaving editor is dirty while a change is typed but not
  // yet sent (the 1.2 s pause) or failed to save, and saving while one is in
  // flight — the pause timer dies with the page, so leaving asks first.
  const run = React.useRef<() => Promise<SaveOutcome>>(async () => ({ kind: "committed" }));
  const editor = useUnsavedEditor({ module: "meetings", saveKind: "save", label: () => t("minutes.editorLabel", { title: latest.current.title.trim() || savedRef.current.title }), save: () => run.current() });
  const { setDirty, setSaving, setUnresolved } = editor;
  const unsent = (title.trim() || saved.title) !== saved.title || body !== saved.body;
  React.useEffect(() => setDirty(unsent), [unsent, setDirty]);

  run.current = async () => {
    if (timer.current) window.clearTimeout(timer.current);
    const next = outgoing(latest.current);
    if (!differs(latest.current)) return { kind: "committed" };
    setState("saving");
    inflight.current += 1;
    setSaving(true);
    try {
      const detail = await meetingApi<MeetingDetailDTO>(`/api/meetings/${meetingId}/minutes/sections/${section.id}`, { method: "PATCH", body: next });
      savedRef.current = next;
      setSavedState(next);
      if (!differs(latest.current)) setDirty(false);
      setUnresolved(false);
      // Typing that arrived while this was on its way still has to go.
      setState(differs(latest.current) ? "dirty" : "saved");
      onChange(detail);
      return { kind: "committed" };
    } catch (error) {
      const outcome = meetingFailureOutcome(error);
      setUnresolved(outcome.kind === "unknown");
      setState("error");
      return outcome;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setSaving(false);
    }
  };
  const save = React.useCallback(() => run.current(), []);

  React.useEffect(() => {
    if (state !== "dirty") return;
    timer.current = window.setTimeout(() => void save(), 1200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [title, body, state, save]);

  return (
    <div className="rounded-xl border border-line bg-surface p-4 focus-within:border-accent/40" data-testid="minutes-section">
      <div className="flex items-center gap-2">
        <Label htmlFor={`section-title-${section.id}`} className="sr-only">
          {t("minutes.sectionTitle")}
        </Label>
        <Input
          id={`section-title-${section.id}`}
          value={title}
          maxLength={180}
          onChange={(event) => {
            setTitle(event.target.value);
            setState("dirty");
          }}
          onBlur={() => void save()}
          className="h-8 border-transparent px-1 text-meta font-semibold uppercase tracking-[0.1em] text-fg-muted shadow-none hover:border-line focus:border-accent"
        />
        <span className={cn("shrink-0 text-meta", state === "error" ? "text-danger-strong" : "text-fg-subtle")} aria-live="polite">
          {state === "saving" ? t("minutes.saving") : state === "saved" ? t("minutes.saved") : state === "error" ? t("minutes.notSaved") : ""}
        </span>
        <button type="button" aria-label={t("minutes.removeSection", { title: section.title })} onClick={onDelete} className="rounded-md p-1.5 text-fg-subtle hover:bg-hover hover:text-danger-strong">
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      </div>
      <Label htmlFor={`section-body-${section.id}`} className="sr-only">
        {section.title}
      </Label>
      <Textarea
        id={`section-body-${section.id}`}
        rows={compact ? 4 : 6}
        maxLength={50_000}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          setState("dirty");
        }}
        onBlur={() => void save()}
        placeholder={t("minutes.placeholder")}
        className="mt-2 min-h-[120px] resize-y border-transparent px-1 text-body leading-relaxed shadow-none hover:border-line focus:border-accent"
      />
    </div>
  );
}
