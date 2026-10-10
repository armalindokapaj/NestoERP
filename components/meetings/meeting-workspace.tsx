"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { usePathname, useRouter as useNextRouter, useSearchParams } from "next/navigation";
import { useRouter } from "@/components/navigation/guarded-router";
import {
  Ban,
  CalendarDays,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Play,
  Printer,
  Repeat,
  Send,
  Users,
  Video,
} from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { UnsavedScope, useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { unsaved, type SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import {
  LOCATION_TYPE_LABELS,
  MEETING_TYPE_LABELS,
  MEETING_VISIBILITY_LABELS,
  PARTICIPANT_ROLE_LABELS,
  type MeetingDetailDTO,
  type MeetingWriteResult,
} from "@/lib/modules/meetings/meeting.types";
import { meetingsLabel } from "@/lib/i18n/modules/meetings/labels";
import { cn } from "@/lib/utils/cn";
import { ActionsPanel } from "./actions-panel";
import { AgendaPanel } from "./agenda-panel";
import { DecisionsPanel } from "./decisions-panel";
import { failureMessage, meetingApi, meetingFailureOutcome } from "./meeting-api";
import { durationLabel, meetingClock, meetingDate, meetingDay, MeetingStatusBadge, PlainText } from "./meeting-ui";
import { MinutesPanel } from "./minutes-panel";
import { useMeetingsTranslations } from "./meetings-text";
import { ParticipantsPanel } from "./participants-panel";
import { FormSelect } from "@/components/ui/form-select";

/**
 * The meeting workspace (PRD #40 §93-§102, §125-§128, §210-§219).
 *
 * Header — what, when, where, status — with only the commands this reader may
 * give. Below it, either the calm record (tabs and a context rail) or, while
 * the meeting is in progress, meeting mode: agenda, notes, decisions and
 * actions side by side with the people in the room, and nothing else.
 *
 * Every write returns the whole meeting as the server now sees it, and the page
 * shows that — capabilities included — so a control never outlives the right
 * to use it.
 */

export type ActivityEntry = { id: string; action: string; message: string | null; actor: string | null; actorMemberId: string | null; createdAt: string };

const TABS = ["overview", "agenda", "minutes", "actions", "documents", "activity"] as const;
type Tab = (typeof TABS)[number];

/** The panels a tab switch destroys, and the ones leaving or entering meeting mode destroys (AUD-03 §5). */
const TAB_SCOPE = "meeting-tab";
const VIEW_SCOPE = "meeting-view";

/**
 * Swapping panels in place destroys the editors in them — a note being
 * written, a decision half-typed. Asks about those, and only those, first —
 * even inside another departure's leaving window: the page stays.
 */
function dismissPanels(scope: string, apply: () => void) {
  const intent = { kind: "dismiss", scope } as const;
  if (!unsaved.hasBlocking(intent)) {
    apply();
    return;
  }
  void unsaved.requestDeparture(intent).then((approval) => {
    // The page stays: the approval covers this swap and nothing after it.
    if (approval?.run(apply)) approval.release();
  });
}

export function MeetingWorkspace({
  initial,
  activity,
  documents,
  discussion,
  favorite,
}: {
  initial: MeetingDetailDTO;
  activity: ActivityEntry[];
  documents: React.ReactNode;
  discussion: React.ReactNode;
  /** The star, rendered by the page (PRD #45 §75). */
  favorite?: React.ReactNode;
}) {
  const router = useRouter();
  const nextRouter = useNextRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const t = useMeetingsTranslations();
  const [meeting, setMeeting] = React.useState(initial);
  const [pending, setPending] = React.useState<string | null>(null);
  const [focus, setFocus] = React.useState(initial.status === "IN_PROGRESS");
  const [cancelling, setCancelling] = React.useState(false);
  const [duplicating, setDuplicating] = React.useState(false);
  const [completing, setCompleting] = React.useState(false);
  const [mobilePane, setMobilePane] = React.useState<"agenda" | "notes" | "decide" | "people">("notes");
  const requested = searchParams.get("tab");
  const [tab, setTab] = React.useState<Tab>(TABS.includes(requested as Tab) ? (requested as Tab) : "overview");

  // A refresh can land after a later write has already answered; the newer version wins.
  React.useEffect(() => {
    setMeeting((current) => (current.id !== initial.id || initial.version > current.version ? initial : current));
  }, [initial]);
  const caps = meeting.capabilities;
  const zone = meeting.timezone;
  const live = meeting.status === "IN_PROGRESS";
  const inFocus = live && focus;
  /*
   * The phone's sticky bar, only when it has a control: Schedule joins it (an
   * organizer on a phone could not send the invitations), and "meeting mode
   * with action rights" no longer draws an empty bar — Add action lives in the
   * actions pane (AUD-04 §6, D-08-19, D-08-20, MW-08).
   */
  const stickyBar = caps.canSchedule || caps.canStart || caps.canComplete || caps.canRespond;

  const change = React.useCallback((detail: MeetingDetailDTO) => setMeeting(detail), []);

  function showTab(next: Tab) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    const query = params.toString();
    // The same page with the same workspace mounted: only the tab's own
    // editors go, and they were asked about already.
    nextRouter.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function selectTab(next: Tab) {
    if (next === tab) return;
    dismissPanels(TAB_SCOPE, () => showTab(next));
  }

  function toggleFocus() {
    dismissPanels(VIEW_SCOPE, () => setFocus((value) => !value));
  }

  async function command(key: string, url: string, body: unknown, success: string) {
    setPending(key);
    try {
      const result = await meetingApi<MeetingWriteResult | MeetingDetailDTO>(url, { body: body ?? {} });
      const detail = "meeting" in result ? result.meeting : result;
      setMeeting(detail);
      toast({ title: success, tone: "success" });
      if (key === "start") dismissPanels(VIEW_SCOPE, () => setFocus(true));
      router.refresh();
      return detail;
    } catch (error) {
      toast({ title: failureMessage(error, t("workspace.failed")), tone: "danger" });
      return null;
    } finally {
      setPending(null);
    }
  }

  const openActions = meeting.actions.filter((action) => action.status === "OPEN" || action.status === "IN_PROGRESS").length;
  const counts: Partial<Record<Tab, number>> = { agenda: meeting.agenda.length, actions: openActions };
  const visibleTabs = TABS.filter((key) => key !== "documents" || caps.canViewDocuments);

  const breadcrumbs = [
    { label: t("workspace.breadcrumbMeetings"), href: "/meetings" },
    ...(meeting.project?.href ? [{ label: meeting.project.name, href: `${meeting.project.href}/meetings` }] : []),
    { label: meeting.title },
  ];

  const whenLine = `${meetingDay(meeting.startsAt, zone)} · ${meetingClock(meeting.startsAt, zone)}–${meetingClock(meeting.endsAt, zone)}`;

  const respond = caps.canRespond ? (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5" role="group" aria-label={t("workspace.yourReply")}>
      {(
        [
          ["ACCEPTED", t("workspace.accept")],
          ["TENTATIVE", t("workspace.tentative")],
          ["DECLINED", t("workspace.decline")],
        ] as const
      ).map(([response, label]) => (
        <button
          key={response}
          type="button"
          aria-pressed={meeting.myResponse === response}
          disabled={pending === "respond"}
          onClick={async () => {
            const previous = meeting;
            setMeeting({ ...meeting, myResponse: response });
            setPending("respond");
            try {
              setMeeting(await meetingApi<MeetingDetailDTO>(`/api/meetings/${meeting.id}/respond`, { body: { response } }));
            } catch (error) {
              setMeeting(previous);
              toast({ title: failureMessage(error, t("workspace.replyFailed")), tone: "danger" });
            } finally {
              setPending(null);
            }
          }}
          className={cn(
            "h-8 rounded-md px-3 text-table font-medium transition-colors touch:h-11",
            meeting.myResponse === response
              ? response === "ACCEPTED"
                ? "bg-success-soft text-success-strong"
                : response === "TENTATIVE"
                  ? "bg-warning-soft text-warning-strong"
                  : "bg-hover text-fg"
              : "text-fg-muted hover:bg-hover hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null;

  const primary = (
    <>
      {caps.canSchedule ? (
        <Button type="button" size="sm" onClick={() => void command("schedule", `/api/meetings/${meeting.id}/schedule`, {}, t("workspace.scheduled"))} disabled={pending !== null}>
          {pending === "schedule" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
          {t("workspace.schedule")}
        </Button>
      ) : null}
      {caps.canStart ? (
        <Button type="button" size="sm" onClick={() => void command("start", `/api/meetings/${meeting.id}/start`, {}, t("workspace.started"))} disabled={pending !== null}>
          {pending === "start" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Play aria-hidden="true" />}
          {t("workspace.startMeeting")}
        </Button>
      ) : null}
      {caps.canComplete ? (
        <Button type="button" size="sm" onClick={() => setCompleting(true)} disabled={pending !== null}>
          <CheckCircle2 aria-hidden="true" />
          {t("workspace.completeMeeting")}
        </Button>
      ) : null}
    </>
  );

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon-sm" variant="secondary" aria-label={t("workspace.moreActions")}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/calendar?view=day&date=${meetingDate(meeting.startsAt, zone)}`}>
            <CalendarDays aria-hidden="true" /> {t("workspace.openInCalendar")}
          </Link>
        </DropdownMenuItem>
        {meeting.minutesStatus === "FINAL" || meeting.minutes.length > 0 ? (
          <DropdownMenuItem asChild>
            <Link href={`/meetings/${meeting.id}/print`} target="_blank">
              <Printer aria-hidden="true" /> {t("workspace.printMinutes")}
            </Link>
          </DropdownMenuItem>
        ) : null}
        {caps.canDuplicate ? (
          <DropdownMenuItem onSelect={() => setDuplicating(true)}>
            <Copy aria-hidden="true" /> {t("workspace.duplicate")}
          </DropdownMenuItem>
        ) : null}
        {caps.canCancel ? (
          <DropdownMenuItem onSelect={() => setCancelling(true)} className="text-danger-strong">
            <Ban aria-hidden="true" /> {t("workspace.cancelMeeting")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className={cn("space-y-5", stickyBar && "pb-20 md:pb-0")} data-testid="meeting-workspace">
      <header className="space-y-4">
        <Breadcrumbs items={breadcrumbs} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <p className="nesto-eyebrow flex flex-wrap items-center gap-x-2 text-fg-subtle">
              {t("workspace.typeMeeting", { type: meetingsLabel(t, "type", meeting.meetingType, MEETING_TYPE_LABELS[meeting.meetingType]) })}
              {meeting.series?.recurrence ? (
                <span className="inline-flex items-center gap-1">
                  <Repeat aria-hidden="true" className="size-3" /> {meetingsLabel(t, "repeat", meeting.series.recurrence.frequency, meeting.series.recurrence.frequency)}
                </span>
              ) : null}
            </p>
            <h1 className={cn("mt-1.5 break-words text-page font-semibold text-fg", meeting.status === "CANCELLED" && "text-fg-muted")}>{meeting.title}</h1>
            <p className="mt-2 text-body text-fg">
              {whenLine}
              <span className="text-fg-subtle"> · {durationLabel(meeting.startsAt, meeting.endsAt)}</span>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-table text-fg-muted">
              {meeting.locationText ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin aria-hidden="true" className="size-3.5 text-fg-subtle" />
                  {meeting.locationText}
                </span>
              ) : null}
              {meeting.onlineUrl ? (
                <a href={meeting.onlineUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 text-accent-strong hover:underline">
                  <Video aria-hidden="true" className="size-3.5" />
                  {t("workspace.joinOnline")}
                  <ExternalLink aria-hidden="true" className="size-3" />
                </a>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <Users aria-hidden="true" className="size-3.5 text-fg-subtle" />
                {t("common.people", { count: meeting.participants.length })}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <MeetingStatusBadge status={meeting.status} />
              {meeting.minutesStatus === "FINAL" ? <Badge tone="success">{t("workspace.minutesFinal")}</Badge> : meeting.status === "COMPLETED" ? <Badge tone="warning">{t("workspace.minutesDraft")}</Badge> : null}
              {meeting.myRole && meeting.myRole !== "ATTENDEE" ? <Badge>{t("workspace.youAre", { role: meetingsLabel(t, "roleLower", meeting.myRole, PARTICIPANT_ROLE_LABELS[meeting.myRole].toLowerCase()) })}</Badge> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {favorite}
            {respond}
            <span className="hidden items-center gap-2 md:flex">{primary}</span>
            {caps.canEdit ? (
              <Button asChild size="sm" variant="secondary">
                <Link href={`/meetings/${meeting.id}/edit`}>
                  <Pencil aria-hidden="true" />
                  {t("workspace.edit")}
                </Link>
              </Button>
            ) : null}
            {menu}
          </div>
        </div>
        {meeting.status === "CANCELLED" ? (
          <p className="rounded-lg border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
            {meeting.cancelReason ? t("workspace.cancelledWithReason", { reason: meeting.cancelReason }) : t("workspace.cancelled")} {caps.canDuplicate ? t("workspace.duplicateHint") : ""}
          </p>
        ) : null}
      </header>

      {live ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-info/30 bg-info-soft px-4 py-2.5 text-table text-info-strong" data-testid="meeting-live-banner">
          <span className="flex items-center gap-2 font-medium">
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-info-strong" />
            {t("workspace.inProgress")}{meeting.startedAt ? t("workspace.startedAt", { time: meetingClock(meeting.startedAt, zone) }) : ""}
            <Elapsed since={meeting.startedAt} />
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={toggleFocus} className="text-info-strong hover:bg-info/10">
            {inFocus ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            {inFocus ? t("workspace.fullWorkspace") : t("workspace.meetingMode")}
          </Button>
        </div>
      ) : null}

      <UnsavedScope id={VIEW_SCOPE}>
      {inFocus ? (
        <MeetingMode meeting={meeting} onChange={change} pane={mobilePane} onPane={setMobilePane} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            <div role="tablist" aria-label={t("workspace.sections")} className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
              {visibleTabs.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`meeting-tab-${key}`}
                  aria-selected={tab === key}
                  aria-controls={`meeting-panel-${key}`}
                  onClick={() => selectTab(key)}
                  className={cn(
                    "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-table font-medium transition-colors touch:min-h-11",
                    tab === key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
                  )}
                >
                  {t(`workspace.tabs.${key}`)}
                  {counts[key] ? <span className="ml-1.5 rounded-full bg-surface-muted px-1.5 text-micro text-fg-muted">{counts[key]}</span> : null}
                </button>
              ))}
            </div>

            <UnsavedScope id={TAB_SCOPE}>
            <div role="tabpanel" id={`meeting-panel-${tab}`} aria-labelledby={`meeting-tab-${tab}`}>
              {tab === "overview" ? (
                <div className="space-y-5">
                  <section className="nesto-card space-y-3 p-5">
                    <h2 className="text-card font-semibold text-fg">{t("workspace.purpose")}</h2>
                    {meeting.description ? <PlainText text={meeting.description} className="text-body text-fg-muted" /> : <p className="text-table text-fg-subtle">{t("workspace.noPurpose")}</p>}
                  </section>
                  <div className="grid gap-5 xl:grid-cols-2">
                    <div className="nesto-card p-5">
                      <ActionsPanel meeting={meeting} onChange={change} openOnly limit={5} />
                    </div>
                    <div className="nesto-card p-5">
                      <DecisionsPanel meeting={meeting} onChange={change} limit={4} />
                    </div>
                  </div>
                  {meeting.agenda.length > 0 ? (
                    <section className="nesto-card p-5">
                      <div className="flex items-center justify-between">
                        <h2 className="text-card font-semibold text-fg">{t("workspace.agenda")}</h2>
                        <button type="button" onClick={() => selectTab("agenda")} className="text-table font-medium text-accent-strong">
                          {t("workspace.viewAll")}
                        </button>
                      </div>
                      <ol className="mt-3 space-y-1.5">
                        {meeting.agenda.slice(0, 6).map((item, index) => (
                          <li key={item.id} className="flex gap-3 text-table">
                            <span className="w-5 shrink-0 text-right tabular-nums text-fg-subtle">{index + 1}.</span>
                            <span className="min-w-0 flex-1 truncate text-fg">{item.title}</span>
                            {item.plannedMinutes ? <span className="text-meta text-fg-subtle">{t("common.minutes", { count: item.plannedMinutes })}</span> : null}
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}
                  {discussion}
                </div>
              ) : null}
              {tab === "agenda" ? (
                <div className="nesto-card p-5">
                  <AgendaPanel meeting={meeting} onChange={change} />
                </div>
              ) : null}
              {tab === "minutes" ? (
                <div className="space-y-5">
                  <div className="nesto-card p-5">
                    <MinutesPanel meeting={meeting} onChange={change} />
                  </div>
                  <div className="nesto-card p-5">
                    <DecisionsPanel meeting={meeting} onChange={change} />
                  </div>
                </div>
              ) : null}
              {tab === "actions" ? (
                <div className="nesto-card p-5">
                  <ActionsPanel meeting={meeting} onChange={change} />
                </div>
              ) : null}
              {tab === "documents" ? <div className="nesto-card p-5">{documents}</div> : null}
              {tab === "activity" ? (
                <section className="nesto-card p-5">
                  <h2 className="text-card font-semibold text-fg">{t("workspace.activity")}</h2>
                  {activity.length === 0 ? (
                    <p className="mt-3 text-table text-fg-subtle">{t("workspace.nothingRecorded")}</p>
                  ) : (
                    <ol className="mt-4 space-y-3 border-l border-line pl-4">
                      {activity.map((entry) => (
                        <li key={entry.id} className="relative text-table">
                          <span aria-hidden="true" className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-line-strong" />
                          <p className="text-fg">
                            {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("workspace.someone")}</span>} {entry.message ?? entry.action}
                          </p>
                          <p className="text-meta text-fg-subtle">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(entry.createdAt))}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              ) : null}
            </div>
            </UnsavedScope>
          </div>

          <aside className="space-y-5" aria-label={t("workspace.context")}>
            <ParticipantsPanel meeting={meeting} onChange={change} />
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("workspace.details")}</h2>
              <dl className="mt-3 space-y-3 text-table">
                <Detail label={t("workspace.organizer")} value={<PersonLink memberId={meeting.organizer.memberId} name={meeting.organizer.fullName} />} />
                {meeting.project ? (
                  <Detail
                    label={t("workspace.project")}
                    value={
                      meeting.project.href ? (
                        <Link href={meeting.project.href} className="text-fg hover:text-accent-strong">
                          {meeting.project.name}
                        </Link>
                      ) : (
                        meeting.project.name
                      )
                    }
                  />
                ) : null}
                {meeting.department ? <Detail label={t("workspace.department")} value={meeting.department.name} /> : null}
                <Detail label={t("workspace.location")} value={[meetingsLabel(t, "location", meeting.locationType, LOCATION_TYPE_LABELS[meeting.locationType]), meeting.locationText].filter(Boolean).join(" · ")} />
                <Detail label={t("workspace.visibleTo")} value={meetingsLabel(t, "visibility", meeting.visibility, MEETING_VISIBILITY_LABELS[meeting.visibility])} />
                <Detail
                  label={t("workspace.calendar")}
                  value={
                    <Link href={`/calendar?view=day&date=${meetingDate(meeting.startsAt, zone)}`} className="inline-flex items-center gap-1 text-accent-strong hover:underline">
                      {t("workspace.openDay", { day: meetingDay(meeting.startsAt, zone, { day: "numeric", month: "short" }) })}
                    </Link>
                  }
                />
                {meeting.reminders.length ? <Detail label={t("workspace.yourReminders")} value={t("workspace.remindersBefore", { list: meeting.reminders.map((minutes) => (minutes >= 1440 ? t("workspace.oneDay") : minutes >= 60 ? t("workspace.hours", { count: minutes / 60 }) : t("common.minutes", { count: minutes }))).join(", ") })} /> : null}
              </dl>
              {caps.canViewDocuments ? (
                <button type="button" onClick={() => selectTab("documents")} className="mt-4 text-table font-medium text-accent-strong">
                  {t("workspace.documents")}
                </button>
              ) : null}
            </section>
          </aside>
        </div>
      )}
      </UnsavedScope>

      {/* Sticky actions on a phone, only the ones this reader may take (PRD #40 §126). */}
      {stickyBar ? (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-line bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden" data-testid="meeting-sticky-actions" data-sticky-action-bar>
          {caps.canSchedule ? (
            <Button type="button" className="flex-1" onClick={() => void command("schedule", `/api/meetings/${meeting.id}/schedule`, {}, t("workspace.scheduled"))} disabled={pending !== null}>
              {pending === "schedule" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />} {t("workspace.schedule")}
            </Button>
          ) : null}
          {caps.canStart ? (
            <Button type="button" className="flex-1" onClick={() => void command("start", `/api/meetings/${meeting.id}/start`, {}, t("workspace.started"))} disabled={pending !== null}>
              <Play aria-hidden="true" /> {t("workspace.start")}
            </Button>
          ) : null}
          {caps.canComplete ? (
            <Button type="button" className="flex-1" onClick={() => setCompleting(true)} disabled={pending !== null}>
              <CheckCircle2 aria-hidden="true" /> {t("workspace.complete")}
            </Button>
          ) : null}
          {!caps.canStart && !caps.canComplete && caps.canRespond ? <div className="flex flex-1 justify-center">{respond}</div> : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={completing}
        onOpenChange={setCompleting}
        title={t("workspace.completeTitle")}
        description={t("workspace.completeDescription")}
        confirmLabel={t("workspace.completeMeeting")}
        destructive={false}
        pending={pending === "complete"}
        onConfirm={async () => {
          if (await command("complete", `/api/meetings/${meeting.id}/complete`, {}, t("workspace.completed"))) {
            setCompleting(false);
            // Leaving meeting mode for the minutes tab destroys the panels: it asks first.
            dismissPanels(VIEW_SCOPE, () => {
              setFocus(false);
              showTab("minutes");
            });
          }
        }}
      />
      <CancelDialog open={cancelling} onOpenChange={setCancelling} meeting={meeting} onDone={change} />
      <DuplicateDialog open={duplicating} onOpenChange={setDuplicating} meeting={meeting} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-right text-fg">{value}</dd>
    </div>
  );
}

function Elapsed({ since }: { since: string | null }) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!since || now === null) return null;
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  return <span className="font-normal tabular-nums"> · {minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`}</span>;
}

/**
 * Meeting mode (PRD #40 §97, §98, §127, §216-§218): the current topic and the
 * agenda, the notes, decisions and actions, the people in the room. On a phone
 * one pane at a time, switched with a thumb.
 */
function MeetingMode({
  meeting,
  onChange,
  pane,
  onPane,
}: {
  meeting: MeetingDetailDTO;
  onChange: (detail: MeetingDetailDTO) => void;
  pane: "agenda" | "notes" | "decide" | "people";
  onPane: (pane: "agenda" | "notes" | "decide" | "people") => void;
}) {
  const t = useMeetingsTranslations();
  const panes = [
    ["agenda", t("workspace.panes.agenda")],
    ["notes", t("workspace.panes.notes")],
    ["decide", t("workspace.panes.decide")],
    ["people", t("workspace.panes.people")],
  ] as const;
  return (
    <div data-testid="meeting-mode">
      <div role="tablist" aria-label={t("workspace.panes.label")} className="mb-4 grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface p-1 lg:hidden">
        {panes.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={pane === key}
            onClick={() => onPane(key)}
            className={cn("h-10 rounded-lg text-table font-medium transition-colors", pane === key ? "bg-accent-soft text-accent-strong" : "text-fg-muted hover:bg-hover")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)_280px]">
        <div className={cn("nesto-card p-4 lg:block", pane === "agenda" ? "block" : "hidden")}>
          <AgendaPanel meeting={meeting} onChange={onChange} variant="focus" />
        </div>
        <div className={cn("min-w-0 space-y-5 lg:block", pane === "notes" || pane === "decide" ? "block" : "hidden")}>
          <div className={cn("nesto-card p-5 lg:block", pane === "notes" ? "block" : "hidden")}>
            <MinutesPanel meeting={meeting} onChange={onChange} compact />
          </div>
          <div className={cn("nesto-card p-5 lg:block", pane === "decide" ? "block" : "hidden")}>
            <DecisionsPanel meeting={meeting} onChange={onChange} />
          </div>
          <div className={cn("nesto-card p-5 lg:block", pane === "decide" ? "block" : "hidden")}>
            <ActionsPanel meeting={meeting} onChange={onChange} />
          </div>
        </div>
        <div className={cn("nesto-card p-4 lg:block", pane === "people" ? "block" : "hidden")}>
          <ParticipantsPanel meeting={meeting} onChange={onChange} variant="attendance" />
        </div>
      </div>
    </div>
  );
}

function CancelDialog({ open, onOpenChange, meeting, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; meeting: MeetingDetailDTO; onDone: (detail: MeetingDetailDTO) => void }) {
  const t = useMeetingsTranslations();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("cancel.title")}</DialogTitle>
        <DialogDescription>{meeting.status === "DRAFT" ? t("cancel.draft") : t("cancel.scheduled")}</DialogDescription>
        {/* Inside the dialog, so the reason belongs to its guarded close (AUD-03 §5). */}
        <CancelForm meeting={meeting} onDone={onDone} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CancelForm({ meeting, onDone, onClose }: { meeting: MeetingDetailDTO; onDone: (detail: MeetingDetailDTO) => void; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const t = useMeetingsTranslations();
  const [reason, setReason] = React.useState("");
  const [scope, setScope] = React.useState<"THIS" | "FUTURE">("THIS");
  const [pending, setPending] = React.useState(false);

  // Cancelling is a workflow step: the prompt never cancels a meeting (AUD-03 §3).
  const editor = useUnsavedEditor({ module: "meetings", saveKind: "none", workflow: t("cancel.workflow"), label: t("cancel.label") });
  const { setDirty, setSaving, setUnresolved } = editor;
  React.useEffect(() => setDirty(reason !== "" || scope !== "THIS"), [reason, scope, setDirty]);

  async function cancel() {
    if (pending) return;
    setPending(true);
    setSaving(true);
    try {
      const result = await meetingApi<MeetingWriteResult>(`/api/meetings/${meeting.id}/cancel`, { body: { reason: reason.trim() || null, scope } });
      setDirty(false);
      setUnresolved(false);
      setSaving(false);
      onDone(result.meeting);
      toast({ title: scope === "FUTURE" ? t("cancel.doneMany") : t("cancel.doneOne"), tone: "success" });
      onClose();
      router.refresh();
    } catch (error) {
      setUnresolved(meetingFailureOutcome(error).kind === "unknown");
      toast({ title: failureMessage(error, t("cancel.failed")), tone: "danger" });
    } finally {
      setPending(false);
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">{t("cancel.reason")}</Label>
          <Textarea id="cancel-reason" rows={2} maxLength={1000} value={reason} readOnly={pending} onChange={(event) => setReason(event.target.value)} placeholder={t("cancel.reasonPlaceholder")} />
        </div>
        {meeting.series ? (
          <div className="space-y-1.5">
            <Label htmlFor="cancel-scope">{t("cancel.scope")}</Label>
            <FormSelect id="cancel-scope" className={selectClass} value={scope} disabled={pending} onChange={(event) => setScope(event.target.value as "THIS" | "FUTURE")}>
              <option value="THIS">{t("cancel.thisOnly")}</option>
              <option value="FUTURE">{t("cancel.future")}</option>
            </FormSelect>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {t("cancel.keep")}
          </Button>
        </DialogClose>
        <Button type="button" variant="danger" onClick={() => void cancel()} disabled={pending}>
          {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {t("cancel.confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}

function DuplicateDialog({ open, onOpenChange, meeting }: { open: boolean; onOpenChange: (open: boolean) => void; meeting: MeetingDetailDTO }) {
  const t = useMeetingsTranslations();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{t("duplicate.title")}</DialogTitle>
        <DialogDescription>{t("duplicate.description")}</DialogDescription>
        {/* Inside the dialog, so the new date belongs to its guarded close (AUD-03 §5). */}
        <DuplicateForm meeting={meeting} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DuplicateForm({ meeting, onClose }: { meeting: MeetingDetailDTO; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const t = useMeetingsTranslations();
  // Mounted when the dialog opens: a week after the later of now and this meeting.
  const [initialDate] = React.useState(() => meetingDate(new Date(Math.max(Date.now(), new Date(meeting.startsAt).getTime()) + 7 * 86_400_000).toISOString(), meeting.timezone));
  const initialTime = meetingClock(meeting.startsAt, meeting.timezone);
  const [date, setDate] = React.useState(initialDate);
  const [time, setTime] = React.useState(initialTime);
  const [pending, setPending] = React.useState(false);
  const running = React.useRef(false);

  const run = React.useRef<(mode: "normal" | "continue") => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({ module: "meetings", saveKind: "create", label: t("duplicate.label"), save: () => run.current("continue") });
  const { setDirty, setSaving, setUnresolved } = editor;
  React.useEffect(() => setDirty(date !== initialDate || time !== initialTime), [date, time, initialDate, initialTime, setDirty]);

  run.current = async (mode) => {
    if (running.current || !date) return { kind: running.current ? "unknown" : "invalid" };
    if (unsaved.frozen) return { kind: "refused" };
    running.current = true;
    setPending(true);
    setSaving(true);
    try {
      const result = await meetingApi<MeetingWriteResult>(`/api/meetings/${meeting.id}/duplicate`, { body: { date, startTime: time } });
      setDirty(false);
      setUnresolved(false);
      setSaving(false);
      toast({ title: t("duplicate.done"), description: t("duplicate.doneDescription"), tone: "success" });
      onClose();
      if (mode === "normal") router.push(`/meetings/${result.meeting.id}`);
      return { kind: "committed" };
    } catch (error) {
      const outcome = meetingFailureOutcome(error);
      setUnresolved(outcome.kind === "unknown");
      toast({ title: failureMessage(error, t("duplicate.failed")), description: outcome.kind === "unknown" ? OUTCOME_COPY.unknown : undefined, tone: "danger" });
      return outcome;
    } finally {
      running.current = false;
      setPending(false);
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="duplicate-date">{t("duplicate.date")}</Label>
          <Input id="duplicate-date" type="date" value={date} readOnly={pending} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="duplicate-time">{t("duplicate.start")}</Label>
          <Input id="duplicate-time" type="time" step={300} value={time} readOnly={pending} onChange={(event) => setTime(event.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="button" onClick={() => void run.current("normal")} disabled={pending || !date}>
          {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Copy aria-hidden="true" />}
          {t("duplicate.confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
