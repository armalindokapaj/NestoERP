"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { Archive, ArrowUpRight, Bell, Clock, FolderKanban, Loader2, MapPin, Pencil, Users, X } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { describeWhen } from "@/lib/modules/calendar/calendar.format";
import type { CalendarEventDetailDTO, CalendarEventDTO } from "@/lib/modules/calendar/calendar.types";
import { cn } from "@/lib/utils/cn";
import { CATEGORY_META } from "./calendar-model";
import { categoryStyle } from "./event-card";
import { useIsPhone } from "./use-is-phone";

/**
 * The event drawer (PRD #39 §32-§34): right side on a desktop, a sheet on a
 * phone. A module's record opens in its module — the calendar offers "Open",
 * never an edit of somebody else's data. Calendar-owned events load their full
 * detail and offer edit, archive, a reply and reminders to whoever may.
 */

const FREQUENCY_LABEL: Record<string, string> = { DAILY: "Repeats every day", WEEKLY: "Repeats every week", MONTHLY: "Repeats every month", YEARLY: "Repeats every year" };
const REMINDER_LABEL = (minutes: number) =>
  minutes === 0 ? "At the time" : minutes < 60 ? `${minutes} minutes before` : minutes < 1440 ? `${minutes / 60} hour before` : minutes === 1440 ? "1 day before" : "1 week before";

export function EventDrawer({
  event,
  zone,
  onOpenChange,
  onEdit,
  onChanged,
}: {
  event: CalendarEventDTO | null;
  zone: string;
  onOpenChange: (open: boolean) => void;
  onEdit: (detail: CalendarEventDetailDTO) => void;
  onChanged: (change: { archived?: string }) => void;
}) {
  const phone = useIsPhone();
  const toast = useToast();
  const [detail, setDetail] = React.useState<CalendarEventDetailDTO | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const owned = event?.sourceType === "calendar_event";

  React.useEffect(() => {
    setDetail(null);
    setFailed(false);
    if (!event || !owned) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/calendar/events/${event.sourceId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        setDetail(((await response.json()) as { data: CalendarEventDetailDTO }).data);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setFailed(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [event, owned]);

  if (!event) return null;
  const busy = event.privacyMode === "BUSY_ONLY";
  const meta = CATEGORY_META[event.category];
  const when = describeWhen(new Date(event.startsAt), event.endsAt ? new Date(event.endsAt) : null, event.allDay, zone);

  async function respond(status: "ACCEPTED" | "DECLINED" | "TENTATIVE") {
    if (!detail) return;
    setPending(true);
    const response = await fetch(`/api/calendar/events/${detail.id}/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      toast({ title: "Your reply could not be saved.", tone: "danger" });
      return;
    }
    setDetail(((await response.json()) as { data: CalendarEventDetailDTO }).data);
    toast({ title: status === "ACCEPTED" ? "Accepted" : status === "DECLINED" ? "Declined" : "Marked as maybe", tone: "success" });
  }

  async function archive() {
    if (!detail) return;
    setPending(true);
    const response = await fetch(`/api/calendar/events/${detail.id}`, { method: "DELETE" }).catch(() => null);
    setPending(false);
    setConfirmArchive(false);
    if (!response?.ok) {
      toast({ title: "The event could not be archived.", tone: "danger" });
      return;
    }
    toast({ title: "Event archived", tone: "success" });
    onChanged({ archived: detail.id });
    onOpenChange(false);
  }

  return (
    <Drawer open onOpenChange={onOpenChange}>
      <DrawerContent side={phone ? "bottom" : "right"} className={cn("bg-surface", !phone && "sm:max-w-[460px]")} aria-describedby="event-drawer-when" data-testid="event-drawer">
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5" style={categoryStyle(event)}>
          <div className="min-w-0">
            {busy ? null : (
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
                <span aria-hidden="true" className="size-2 rounded-full bg-[var(--cal)]" />
                {event.metadata?.sourceLabel ?? meta.label}
              </p>
            )}
            <DrawerTitle className="text-section font-semibold text-fg">{event.title}</DrawerTitle>
            <DrawerDescription id="event-drawer-when" className="mt-1.5 flex items-center gap-1.5 text-table text-fg-muted">
              <Clock aria-hidden="true" className="size-3.5" />
              {when}
            </DrawerDescription>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {event.status === "OVERDUE" ? <Badge tone="warning">Overdue</Badge> : null}
              {event.severity === "critical" ? <Badge tone="danger">Critical</Badge> : null}
              {event.occurrence?.recurring && detail?.recurrence ? <Badge tone="neutral">{FREQUENCY_LABEL[detail.recurrence.frequency]}</Badge> : null}
              {detail?.archived ? <Badge tone="neutral">Archived</Badge> : null}
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={() => onOpenChange(false)} className="rounded-md p-1 text-fg-subtle hover:bg-hover hover:text-fg">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 text-table">
          {busy ? (
            <p className="text-fg-muted">This person is unavailable at this time. Details are private.</p>
          ) : (
            <>
              {event.subtitle && !owned ? <p className="text-body text-fg">{event.subtitle}</p> : null}
              {event.project || detail?.project ? (
                <p className="flex items-center gap-2 text-fg">
                  <FolderKanban aria-hidden="true" className="size-4 text-fg-subtle" />
                  {(detail?.project ?? event.project)!.name}
                </p>
              ) : null}
              {(detail?.location ?? event.location) ? (
                <p className="flex items-center gap-2 text-fg">
                  <MapPin aria-hidden="true" className="size-4 text-fg-subtle" />
                  {detail?.location ?? event.location}
                </p>
              ) : null}
              {owned && loading ? (
                <p className="flex items-center gap-2 text-fg-subtle">
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Loading details…
                </p>
              ) : null}
              {owned && failed ? <p className="text-danger-strong">This event is no longer available.</p> : null}
              {detail?.description ? <p className="whitespace-pre-wrap text-body text-fg">{detail.description}</p> : null}

              {detail ? (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-subtle">
                    <Users aria-hidden="true" className="size-3.5" /> People
                  </h3>
                  <ul className="space-y-1">
                    <li className="flex justify-between gap-3 text-fg">
                      <PersonLink memberId={detail.createdBy.memberId} name={detail.createdBy.fullName} />
                      <span className="text-fg-subtle">Organiser</span>
                    </li>
                    {detail.participants.map((person) => (
                      <li key={person.memberId} className="flex justify-between gap-3 text-fg">
                        <PersonLink memberId={person.memberId} name={person.fullName} />
                        <span className="text-fg-subtle">{person.status === "INVITED" ? "Invited" : person.status === "ACCEPTED" ? "Going" : person.status === "TENTATIVE" ? "Maybe" : "Declined"}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : event.participants?.length ? (
                <p className="flex items-center gap-2 text-fg">
                  <Users aria-hidden="true" className="size-4 text-fg-subtle" />
                  <span>
                    {event.participants.map((person, index) => (
                      <React.Fragment key={person.memberId}>
                        {index > 0 ? ", " : null}
                        <PersonLink memberId={person.memberId} name={person.name} />
                      </React.Fragment>
                    ))}
                  </span>
                </p>
              ) : null}

              {detail?.reminders.length ? (
                <p className="flex items-center gap-2 text-fg-muted">
                  <Bell aria-hidden="true" className="size-4 text-fg-subtle" />
                  {detail.reminders.map((reminder) => REMINDER_LABEL(reminder.minutesBefore)).join(", ")}
                </p>
              ) : null}

              {detail?.capabilities.canRespond ? (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-subtle">Going?</h3>
                  <div className="flex gap-2" role="group" aria-label="Your reply">
                    {(["ACCEPTED", "TENTATIVE", "DECLINED"] as const).map((status) => (
                      <Button
                        key={status}
                        type="button"
                        size="sm"
                        variant={detail.myStatus === status ? "primary" : "secondary"}
                        aria-pressed={detail.myStatus === status}
                        disabled={pending}
                        onClick={() => void respond(status)}
                      >
                        {status === "ACCEPTED" ? "Yes" : status === "TENTATIVE" ? "Maybe" : "No"}
                      </Button>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>

        {!busy ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">
            {detail?.capabilities.canArchive ? (
              <Button type="button" variant="ghost" onClick={() => setConfirmArchive(true)} disabled={pending}>
                <Archive aria-hidden="true" />
                Archive
              </Button>
            ) : null}
            {detail?.capabilities.canEdit ? (
              <Button type="button" variant="secondary" onClick={() => onEdit(detail)} disabled={pending}>
                <Pencil aria-hidden="true" />
                Edit
              </Button>
            ) : null}
            {!owned && event.href ? (
              <Button asChild>
                <Link href={event.href}>
                  Open {(event.metadata?.sourceLabel ?? "record").toLowerCase()}
                  <ArrowUpRight aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        <ConfirmDialog
          open={confirmArchive}
          onOpenChange={setConfirmArchive}
          title="Archive this event?"
          description={detail?.recurrence ? "Every occurrence of the series is removed from calendars. People on it are told." : "It is removed from calendars, and people on it are told."}
          confirmLabel="Archive event"
          pending={pending}
          onConfirm={() => void archive()}
        />
      </DrawerContent>
    </Drawer>
  );
}
