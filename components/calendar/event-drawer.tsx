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
import { calendarLabel, useCalendarTranslations, useDayWords } from "./calendar-text";
import type { Translate } from "@/lib/i18n/translator";

/**
 * The event drawer (PRD #39 §32-§34): right side on a desktop, a sheet on a
 * phone. A module's record opens in its module — the calendar offers "Open",
 * never an edit of somebody else's data. Calendar-owned events load their full
 * detail and offer edit, archive, a reply and reminders to whoever may.
 */

const FREQUENCY_LABEL: Record<string, string> = { DAILY: "Repeats every day", WEEKLY: "Repeats every week", MONTHLY: "Repeats every month", YEARLY: "Repeats every year" };
const REMINDER_LABEL = (t: Translate<"calendar">, minutes: number) =>
  minutes === 0 || minutes === 10 || minutes === 30 || minutes === 60 || minutes === 1440
    ? t(`labels.reminder.${minutes}`)
    : minutes < 60
      ? t("drawer.minutesBefore", { count: minutes })
      : minutes < 1440
        ? t("drawer.hourBefore", { count: minutes / 60 })
        : t("labels.reminder.10080");

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
  const t = useCalendarTranslations();
  const words = useDayWords();
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
  const when = describeWhen(new Date(event.startsAt), event.endsAt ? new Date(event.endsAt) : null, event.allDay, zone, { locale: words.locale, allDay: t("allDayLower") });

  async function respond(status: "ACCEPTED" | "DECLINED" | "TENTATIVE") {
    if (!detail) return;
    setPending(true);
    const response = await fetch(`/api/calendar/events/${detail.id}/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      toast({ title: t("drawer.replyFailed"), tone: "danger" });
      return;
    }
    setDetail(((await response.json()) as { data: CalendarEventDetailDTO }).data);
    toast({ title: status === "ACCEPTED" ? t("drawer.accepted") : status === "DECLINED" ? t("drawer.declined") : t("drawer.maybe"), tone: "success" });
  }

  async function archive() {
    if (!detail) return;
    setPending(true);
    const response = await fetch(`/api/calendar/events/${detail.id}`, { method: "DELETE" }).catch(() => null);
    setPending(false);
    setConfirmArchive(false);
    if (!response?.ok) {
      toast({ title: t("drawer.archiveFailed"), tone: "danger" });
      return;
    }
    toast({ title: t("drawer.archived"), tone: "success" });
    onChanged({ archived: detail.id });
    onOpenChange(false);
  }

  return (
    <Drawer open onOpenChange={onOpenChange}>
      <DrawerContent side={phone ? "bottom" : "right"} className={cn("bg-surface", phone === false && "sm:max-w-[460px]")} aria-describedby="event-drawer-when" data-testid="event-drawer">
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5" style={categoryStyle(event)}>
          <div className="min-w-0">
            {busy ? null : (
              <p className="mb-2 flex items-center gap-1.5 text-meta font-medium uppercase tracking-[0.08em] text-fg-subtle">
                <span aria-hidden="true" className="size-2 rounded-full bg-[var(--cal)]" />
                {event.metadata?.sourceLabel ?? calendarLabel(t, "category", event.category, meta.label)}
              </p>
            )}
            <DrawerTitle className="text-section font-semibold text-fg">{event.title}</DrawerTitle>
            <DrawerDescription id="event-drawer-when" className="mt-1.5 flex items-center gap-1.5 text-table text-fg-muted">
              <Clock aria-hidden="true" className="size-3.5" />
              {when}
            </DrawerDescription>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {event.status === "OVERDUE" ? <Badge tone="warning">{t("overdue")}</Badge> : null}
              {event.severity === "critical" ? <Badge tone="danger">{t("critical")}</Badge> : null}
              {event.occurrence?.recurring && detail?.recurrence ? <Badge tone="neutral">{calendarLabel(t, "repeats", detail.recurrence.frequency, FREQUENCY_LABEL[detail.recurrence.frequency])}</Badge> : null}
              {detail?.archived ? <Badge tone="neutral">{t("drawer.archivedBadge")}</Badge> : null}
            </div>
          </div>
          <button type="button" aria-label={t("drawer.close")} onClick={() => onOpenChange(false)} className="grid shrink-0 place-items-center rounded-md p-1 text-fg-subtle hover:bg-hover hover:text-fg touch:size-11 touch:p-0">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 text-table">
          {busy ? (
            <p className="text-fg-muted">{t("drawer.busyOnly")}</p>
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
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" /> {t("drawer.loading")}
                </p>
              ) : null}
              {owned && failed ? <p className="text-danger-strong">{t("drawer.unavailable")}</p> : null}
              {detail?.description ? <p className="whitespace-pre-wrap text-body text-fg">{detail.description}</p> : null}

              {detail ? (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">
                    <Users aria-hidden="true" className="size-3.5" /> {t("drawer.people")}
                  </h3>
                  <ul className="space-y-1">
                    <li className="flex justify-between gap-3 text-fg">
                      <PersonLink memberId={detail.createdBy.memberId} name={detail.createdBy.fullName} />
                      <span className="text-fg-subtle">{t("drawer.organiser")}</span>
                    </li>
                    {detail.participants.map((person) => (
                      <li key={person.memberId} className="flex justify-between gap-3 text-fg">
                        <PersonLink memberId={person.memberId} name={person.fullName} />
                        <span className="text-fg-subtle">{t(`labels.participantStatus.${person.status === "INVITED" || person.status === "ACCEPTED" || person.status === "TENTATIVE" ? person.status : "DECLINED"}`)}</span>
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
                  {detail.reminders.map((reminder) => REMINDER_LABEL(t, reminder.minutesBefore)).join(", ")}
                </p>
              ) : null}

              {detail?.capabilities.canRespond ? (
                <section>
                  <h3 className="mb-2 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{t("drawer.going")}</h3>
                  <div className="flex gap-2" role="group" aria-label={t("drawer.yourReply")}>
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
                        {t(`labels.reply.${status}`)}
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
                {t("drawer.archive")}
              </Button>
            ) : null}
            {detail?.capabilities.canEdit ? (
              <Button type="button" variant="secondary" onClick={() => onEdit(detail)} disabled={pending}>
                <Pencil aria-hidden="true" />
                {t("drawer.edit")}
              </Button>
            ) : null}
            {!owned && event.href ? (
              <Button asChild>
                <Link href={event.href}>
                  {t("drawer.open", { what: event.metadata?.sourceLabel ? event.metadata.sourceLabel.toLowerCase() : t("drawer.record") })}
                  <ArrowUpRight aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        <ConfirmDialog
          open={confirmArchive}
          onOpenChange={setConfirmArchive}
          title={t("drawer.archiveTitle")}
          description={detail?.recurrence ? t("drawer.archiveSeries") : t("drawer.archiveOne")}
          confirmLabel={t("drawer.archiveConfirm")}
          pending={pending}
          onConfirm={() => void archive()}
        />
      </DrawerContent>
    </Drawer>
  );
}
