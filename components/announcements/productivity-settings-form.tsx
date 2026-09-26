"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { unsaved, type SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import type { ProductivitySettingsDTO } from "@/lib/modules/productivity/productivity.settings";
import { cn } from "@/lib/utils/cn";
import { announcementApi, announcementFailureOutcome, failureMessage } from "./announcement-api";

/** The company's switches for announcements, favorites and recent work (PRD #45 §247). */
export function ProductivitySettingsForm({ initial }: { initial: ProductivitySettingsDTO }) {
  const toast = useToast();
  const router = useRouter();
  const [state, setState] = React.useState(initial);
  const [baseline, setBaseline] = React.useState(initial);
  const [pending, setPending] = React.useState(false);

  // AUD-03 §3: the settings as saved are the baseline; Save and continue runs this same PUT.
  const run = React.useRef<() => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({ module: "announcements", saveKind: "save", label: "Announcement settings", save: () => run.current() });
  const { setDirty, setSaving, setUnresolved } = editor;
  const dirty = JSON.stringify(state) !== JSON.stringify(baseline);
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);

  run.current = async () => {
    if (pending) return { kind: "unknown" };
    if (unsaved.frozen) return { kind: "refused" };
    setPending(true);
    setSaving(true);
    try {
      await announcementApi("/api/productivity/settings", { method: "PUT", body: state });
      setBaseline(state);
      setDirty(false);
      setUnresolved(false);
      toast({ title: "Settings saved", tone: "success" });
      router.refresh();
      return { kind: "committed" };
    } catch (error) {
      const outcome = announcementFailureOutcome(error);
      setUnresolved(outcome.kind === "unknown");
      toast({ title: failureMessage(error), description: outcome.kind === "unknown" ? OUTCOME_COPY.unknown : OUTCOME_COPY.notSaved, tone: "danger" });
      return outcome;
    } finally {
      setPending(false);
      setSaving(false);
    }
  };

  function save(event: React.FormEvent) {
    event.preventDefault();
    void run.current();
  }

  const toggle = (key: keyof ProductivitySettingsDTO, title: string, hint: string) => (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={`setting-${key}`}>
        <span className="block text-table font-medium text-fg">{title}</span>
        <span className="block text-meta text-fg-muted">{hint}</span>
      </label>
      <Switch id={`setting-${key}`} checked={Boolean(state[key])} onCheckedChange={(value) => setState({ ...state, [key]: value })} />
    </div>
  );

  return (
    <form onSubmit={save} className="nesto-card divide-y divide-line px-5" aria-label="Announcement settings">
      {toggle("announcementsEnabled", "Announcements", "Company, department and project notices in NESTO.")}
      {toggle("notifyNormalAnnouncements", "Notify for ordinary announcements", "Important and critical ones always notify; ordinary ones otherwise stay in the feed.")}
      <label className="flex flex-col py-3">
        <span className="text-table font-medium text-fg">Acknowledgment reminders</span>
        <span className="text-meta text-fg-muted">How often people who have not acknowledged are reminded.</span>
        <select className={cn(selectClass, "mt-1.5 w-56")} value={state.announcementAckReminderDays} onChange={(event) => setState({ ...state, announcementAckReminderDays: Number(event.target.value) })}>
          {[1, 2, 3, 5, 7, 14].map((days) => (
            <option key={days} value={days}>
              Every {days === 1 ? "day" : `${days} days`}
            </option>
          ))}
        </select>
      </label>
      {toggle("favoritesEnabled", "Favorites", "People can star records they use often. Private to each person.")}
      {toggle("recentWorkEnabled", "Recent work", "People see the records they opened lately. Private to each person, never an activity record.")}
      <label className="flex flex-col py-3">
        <span className="text-table font-medium text-fg">Keep recent work for</span>
        <select className={cn(selectClass, "mt-1.5 w-56")} value={state.recentWorkRetentionDays} onChange={(event) => setState({ ...state, recentWorkRetentionDays: Number(event.target.value) })}>
          {[30, 60, 90, 180, 365].map((days) => (
            <option key={days} value={days}>
              {days} days
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-end gap-3 py-3">
        <UnsavedIndicator save={{ editor, pending, saved: null }} />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
