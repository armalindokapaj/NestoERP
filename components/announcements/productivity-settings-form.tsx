"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { ProductivitySettingsDTO } from "@/lib/modules/productivity/productivity.settings";
import { cn } from "@/lib/utils/cn";
import { announcementApi, failureMessage } from "./announcement-api";

/** The company's switches for announcements, favorites and recent work (PRD #45 §247). */
export function ProductivitySettingsForm({ initial }: { initial: ProductivitySettingsDTO }) {
  const toast = useToast();
  const router = useRouter();
  const [state, setState] = React.useState(initial);
  const [pending, setPending] = React.useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await announcementApi("/api/productivity/settings", { method: "PUT", body: state });
      toast({ title: "Settings saved", tone: "success" });
      router.refresh();
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
    } finally {
      setPending(false);
    }
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
      <div className="flex justify-end py-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
