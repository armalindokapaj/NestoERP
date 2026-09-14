"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronDown, Loader2, MapPin, RotateCw, TriangleAlert, Users, Video, X } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { instantFromLocal } from "@/lib/modules/calendar/calendar.time";
import type { MeetingFormOptions } from "@/lib/modules/meetings/meeting.options";
import { isSafeMeetingUrl } from "@/lib/modules/meetings/meeting.schema";
import {
  defaultVisibilityFor,
  LOCATION_TYPE_LABELS,
  MEETING_TYPE_LABELS,
  MEETING_VISIBILITY_LABELS,
  PARTICIPANT_ROLE_LABELS,
  type MeetingConflictDTO,
  type MeetingDetailDTO,
  type MeetingWriteResult,
} from "@/lib/modules/meetings/meeting.types";
import { cn } from "@/lib/utils/cn";
import { failureMessage, meetingApi, type MeetingApiFailure } from "./meeting-api";
import { durationLabel, meetingClock, meetingDate, PersonAvatar } from "./meeting-ui";
import { PeoplePicker, type PickedPerson } from "./people-picker";

/**
 * Create and edit a meeting (PRD #40 §87-§89, §178, §179, §227).
 *
 * The first things asked are the ones every meeting needs — what, when, which
 * project, who, where. Purpose, visibility, repetition, reminders and an agenda
 * template sit under "More options". Conflicts are shown while people and time
 * are chosen, as a warning that never blocks (PRD #40 §29). The form offers only
 * what the service would accept, and the service checks again.
 */

type Role = "CHAIR" | "SECRETARY" | "ATTENDEE" | "OBSERVER";
type Participant = PickedPerson & { role: Role; required: boolean };

type State = {
  title: string;
  meetingType: string;
  visibility: string;
  visibilityTouched: boolean;
  date: string;
  startTime: string;
  endTime: string;
  projectId: string;
  departmentId: string;
  locationType: string;
  locationText: string;
  onlineUrl: string;
  description: string;
  participants: Participant[];
  agendaTemplate: string;
  frequency: "" | "DAILY" | "WEEKLY" | "MONTHLY";
  endMode: "count" | "until";
  count: string;
  until: string;
  reminders: number[];
  scope: "THIS" | "FUTURE";
};

const REMINDER_CHOICES = [
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
  { value: 1440, label: "1 day" },
];
const ROLES: Role[] = ["ATTENDEE", "CHAIR", "SECRETARY", "OBSERVER"];
const DURATIONS = [30, 45, 60, 90];

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

export type MeetingFormProps =
  | { mode: "create"; options: MeetingFormOptions; defaults: { date: string; startTime?: string; projectId?: string } }
  | { mode: "edit"; options: MeetingFormOptions; meeting: MeetingDetailDTO };

function initial(props: MeetingFormProps): State {
  if (props.mode === "edit") {
    const meeting = props.meeting;
    const zone = meeting.timezone;
    return {
      title: meeting.title,
      meetingType: meeting.meetingType,
      visibility: meeting.visibility,
      visibilityTouched: true,
      date: meetingDate(meeting.startsAt, zone),
      startTime: meetingClock(meeting.startsAt, zone),
      endTime: meetingClock(meeting.endsAt, zone),
      projectId: meeting.project?.id ?? "",
      departmentId: meeting.department?.id ?? "",
      locationType: meeting.locationType,
      locationText: meeting.locationText ?? "",
      onlineUrl: meeting.onlineUrl ?? "",
      description: meeting.description ?? "",
      participants: [],
      agendaTemplate: "",
      frequency: "",
      endMode: "count",
      count: "",
      until: "",
      reminders: meeting.reminders,
      scope: "THIS",
    };
  }
  const startTime = props.defaults.startTime ?? "10:00";
  const projectId = props.defaults.projectId && props.options.projects.some((project) => project.id === props.defaults.projectId) ? props.defaults.projectId : "";
  const meetingType = projectId ? "COORDINATION" : "INTERNAL";
  return {
    title: "",
    meetingType,
    visibility: defaultVisibilityFor(meetingType as never, Boolean(projectId)),
    visibilityTouched: false,
    date: props.defaults.date,
    startTime,
    endTime: addMinutes(startTime, 60),
    projectId,
    departmentId: props.options.myDepartmentId ?? "",
    locationType: "IN_PERSON",
    locationText: "",
    onlineUrl: "",
    description: "",
    participants: [],
    agendaTemplate: projectId ? "project-coordination" : "",
    frequency: "",
    endMode: "count",
    count: "8",
    until: "",
    reminders: [30],
    scope: "THIS",
  };
}

export function MeetingForm(props: MeetingFormProps) {
  const router = useRouter();
  const toast = useToast();
  const { options } = props;
  const zone = options.timezone;
  const editing = props.mode === "edit";
  const [state, setState] = React.useState<State>(() => initial(props));
  const [more, setMore] = React.useState(editing && Boolean(props.meeting.description));
  const [pending, setPending] = React.useState<"save" | "draft" | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [stale, setStale] = React.useState(false);
  const [conflicts, setConflicts] = React.useState<MeetingConflictDTO[]>([]);

  const set = <K extends keyof State>(key: K, value: State[K]) => setState((current) => ({ ...current, [key]: value }));
  const duration = minutesBetween(state.startTime, state.endTime);
  const visibilities = options.visibilities.includes(state.visibility as never) ? options.visibilities : [...options.visibilities, state.visibility as never];

  // Availability for the people chosen, as a warning (PRD #40 §27-§29, §255).
  const editingParticipants = editing ? props.meeting.participants.map((row) => row.memberId) : [];
  const people = editing ? editingParticipants : [options.me.memberId, ...state.participants.map((row) => row.memberId)];
  const conflictKey = `${people.join(",")}|${state.date}|${state.startTime}|${state.endTime}`;
  React.useEffect(() => {
    if (duration <= 0 || people.length === 0 || !state.date) {
      setConflicts([]);
      return;
    }
    const params = new URLSearchParams();
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const from = instantFromLocal(state.date, state.startTime, zone);
      const to = instantFromLocal(state.date, state.endTime, zone);
      if (to <= from) return;
      params.set("from", from.toISOString());
      params.set("to", to.toISOString());
      for (const memberId of people) params.append("memberIds", memberId);
      if (editing) params.set("excludeMeetingId", props.meeting.id);
      fetch(`/api/calendar/availability?${params}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((json) => {
          setConflicts(((json?.data ?? []) as MeetingConflictDTO[]).filter((row) => row.busy.length > 0));
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictKey]);

  function changeType(meetingType: string) {
    setState((current) => ({
      ...current,
      meetingType,
      visibility: current.visibilityTouched ? current.visibility : defaultVisibilityFor(meetingType as never, Boolean(current.projectId)),
    }));
  }

  function changeProject(projectId: string) {
    setState((current) => ({
      ...current,
      projectId,
      visibility: current.visibilityTouched ? current.visibility : defaultVisibilityFor(current.meetingType as never, Boolean(projectId)),
    }));
  }

  function clientErrors(): Record<string, string> {
    const found: Record<string, string> = {};
    if (!state.title.trim()) found.title = "Give the meeting a title.";
    if (duration <= 0) found.endTime = "The meeting must end after it starts.";
    if (state.visibility === "PROJECT" && !state.projectId) found.projectId = "Choose the project this meeting belongs to.";
    if (state.onlineUrl && !isSafeMeetingUrl(state.onlineUrl)) found.onlineUrl = "Use an https:// meeting link.";
    return found;
  }

  async function submit(event: React.FormEvent, draft = false) {
    event.preventDefault();
    const found = clientErrors();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(draft ? "draft" : "save");
    setStale(false);

    const shared = {
      title: state.title,
      description: state.description || null,
      meetingType: state.meetingType,
      visibility: state.visibility,
      date: state.date,
      startTime: state.startTime,
      endTime: state.endTime,
      projectId: state.projectId || null,
      departmentId: state.visibility === "DEPARTMENT" ? state.departmentId || options.myDepartmentId : null,
      locationType: state.locationType,
      locationText: state.locationType === "ONLINE" ? null : state.locationText || null,
      onlineUrl: state.locationType === "IN_PERSON" ? null : state.onlineUrl || null,
    };

    try {
      if (props.mode === "edit") {
        const result = await meetingApi<MeetingWriteResult>(`/api/meetings/${props.meeting.id}`, {
          method: "PATCH",
          body: { ...shared, version: props.meeting.version, scope: state.scope },
        });
        toast({ title: result.occurrences && result.occurrences > 1 ? `${result.occurrences} meetings updated` : "Meeting updated", tone: "success" });
        router.push(`/meetings/${props.meeting.id}`);
        router.refresh();
        return;
      }
      const result = await meetingApi<MeetingWriteResult>("/api/meetings", {
        body: {
          ...shared,
          participants: state.participants.map((row) => ({ memberId: row.memberId, role: row.role, required: row.required })),
          agendaTemplate: state.agendaTemplate || null,
          reminders: state.reminders,
          recurrence: state.frequency
            ? {
                frequency: state.frequency,
                interval: 1,
                ...(state.endMode === "count" && state.count ? { count: Number(state.count) } : {}),
                ...(state.endMode === "until" && state.until ? { until: state.until } : {}),
              }
            : null,
          saveAsDraft: draft,
        },
      });
      const busy = result.conflicts.length;
      toast({
        title: draft ? "Draft saved" : result.occurrences && result.occurrences > 1 ? `${result.occurrences} meetings scheduled` : "Meeting scheduled",
        description: busy ? `${busy === 1 ? "1 person has" : `${busy} people have`} something else at that time.` : undefined,
        tone: "success",
      });
      router.push(`/meetings/${result.meeting.id}`);
    } catch (error) {
      const failure = error as MeetingApiFailure;
      if (failure.detailCode === "STALE_VERSION") setStale(true);
      setErrors({ ...(failure.fields ?? {}), form: failureMessage(error, "The meeting could not be saved.") });
    } finally {
      setPending(null);
    }
  }

  const fieldError = (key: string) => (errors[key] ? <p className="text-meta text-danger-strong">{errors[key]}</p> : null);
  const cancelHref = editing ? `/meetings/${props.meeting.id}` : "/meetings";
  const project = options.projects.find((row) => row.id === state.projectId);

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" data-testid="meeting-form">
      <div className="min-w-0 space-y-5">
        <section className="nesto-card space-y-5 p-5 sm:p-6">
          <div className="space-y-1.5">
            <Label htmlFor="meeting-title">Title</Label>
            <Input id="meeting-title" autoFocus value={state.title} maxLength={180} onChange={(change) => set("title", change.target.value)} placeholder="Weekly design coordination" aria-invalid={Boolean(errors.title)} />
            {fieldError("title")}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="meeting-type">Type</Label>
              <select id="meeting-type" className={selectClass} value={state.meetingType} onChange={(change) => changeType(change.target.value)}>
                {options.meetingTypes.map((type) => (
                  <option key={type} value={type}>
                    {MEETING_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-project">Project</Label>
              <select id="meeting-project" className={selectClass} value={state.projectId} onChange={(change) => changeProject(change.target.value)} aria-invalid={Boolean(errors.projectId)}>
                <option value="">No project</option>
                {options.projects.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code} · {row.name}
                  </option>
                ))}
                {editing && props.meeting.project && !options.projects.some((row) => row.id === props.meeting.project!.id) ? (
                  <option value={props.meeting.project.id}>{props.meeting.project.name}</option>
                ) : null}
              </select>
              {fieldError("projectId")}
            </div>
          </div>
        </section>

        <section className="nesto-card space-y-4 p-5 sm:p-6" aria-labelledby="meeting-when">
          <h2 id="meeting-when" className="flex items-center gap-2 text-card font-semibold text-fg">
            <CalendarClock aria-hidden="true" className="size-4 text-fg-subtle" /> When
          </h2>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="meeting-date">Date</Label>
              <Input id="meeting-date" type="date" value={state.date} onChange={(change) => set("date", change.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-start">Start</Label>
              <Input
                id="meeting-start"
                type="time"
                step={300}
                value={state.startTime}
                onChange={(change) => {
                  const value = change.target.value;
                  setState((current) => ({ ...current, startTime: value, endTime: addMinutes(value, Math.max(15, minutesBetween(current.startTime, current.endTime))) }));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-end">End</Label>
              <Input id="meeting-end" type="time" step={300} value={state.endTime} onChange={(change) => set("endTime", change.target.value)} aria-invalid={Boolean(errors.endTime)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Length">
            {DURATIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                aria-pressed={duration === minutes}
                onClick={() => set("endTime", addMinutes(state.startTime, minutes))}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-meta transition-colors",
                  duration === minutes ? "border-accent/40 bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {minutes < 60 ? `${minutes} min` : minutes === 60 ? "1 h" : "1 h 30"}
              </button>
            ))}
            <span className="ml-1 text-meta text-fg-subtle">Times in {zone.replace("_", " ")}</span>
          </div>
          {fieldError("endTime")}
          {editing && props.meeting.series ? (
            <fieldset className="space-y-2 rounded-lg border border-line bg-surface-muted p-3">
              <legend className="px-1 text-meta font-medium text-fg-muted">This meeting repeats</legend>
              {(["THIS", "FUTURE"] as const).map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-table text-fg">
                  <input type="radio" name="meeting-scope" value={scope} checked={state.scope === scope} onChange={() => set("scope", scope)} className="accent-[var(--nesto-accent)]" />
                  {scope === "THIS" ? "Change this meeting only" : "Change this and every later meeting"}
                </label>
              ))}
              {state.scope === "FUTURE" ? <p className="text-meta text-fg-subtle">Later meetings keep their own day; the new times, place and details apply to all of them.</p> : null}
              {fieldError("date")}
            </fieldset>
          ) : null}
        </section>

        {!editing ? (
          <section className="nesto-card space-y-4 p-5 sm:p-6" aria-labelledby="meeting-people">
            <h2 id="meeting-people" className="flex items-center gap-2 text-card font-semibold text-fg">
              <Users aria-hidden="true" className="size-4 text-fg-subtle" /> People
            </h2>
            <ul className="divide-y divide-line rounded-lg border border-line">
              <li className="flex items-center gap-3 px-3 py-2.5">
                <PersonAvatar person={{ fullName: options.me.fullName, avatarUrl: null }} />
                <span className="min-w-0 flex-1 truncate text-table text-fg">{options.me.fullName}</span>
                <span className="text-meta text-fg-subtle">Organizer</span>
              </li>
              {state.participants.map((person) => (
                <li key={person.memberId} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-testid="form-participant">
                  <PersonAvatar person={person} />
                  <span className="min-w-0 flex-1 truncate text-table text-fg">{person.fullName}</span>
                  <select
                    aria-label={`Role for ${person.fullName}`}
                    className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-fg"
                    value={person.role}
                    onChange={(change) => set("participants", state.participants.map((row) => (row.memberId === person.memberId ? { ...row, role: change.target.value as Role } : row)))}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {PARTICIPANT_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-meta text-fg-muted">
                    <Checkbox
                      checked={!person.required}
                      onCheckedChange={(checked) => set("participants", state.participants.map((row) => (row.memberId === person.memberId ? { ...row, required: checked !== true } : row)))}
                    />
                    Optional
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove ${person.fullName}`}
                    onClick={() => set("participants", state.participants.filter((row) => row.memberId !== person.memberId))}
                    className="rounded-md p-1 text-fg-subtle hover:bg-hover hover:text-fg"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <PeoplePicker
              id="meeting-people-search"
              exclude={[options.me.memberId, ...state.participants.map((row) => row.memberId)]}
              onPick={(person) => set("participants", [...state.participants, { ...person, role: "ATTENDEE", required: true }])}
            />
            {fieldError("participants")}
          </section>
        ) : null}

        {conflicts.length > 0 ? (
          <div role="status" className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-table text-warning-strong" data-testid="meeting-conflicts">
            <p className="flex items-center gap-1.5 font-medium">
              <TriangleAlert aria-hidden="true" className="size-4" />
              {conflicts.length === 1 ? "1 person is busy then" : `${conflicts.length} people are busy then`}
            </p>
            <ul className="mt-1 space-y-0.5 text-meta">
              {conflicts.map((conflict) => (
                <li key={conflict.memberId}>
                  {conflict.fullName} — busy {conflict.busy.slice(0, 2).map((slot) => `${meetingClock(slot.startsAt, zone)}–${meetingClock(slot.endsAt, zone)}`).join(", ")}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-meta">You can still schedule it.</p>
          </div>
        ) : null}

        <section className="nesto-card space-y-4 p-5 sm:p-6" aria-labelledby="meeting-where">
          <h2 id="meeting-where" className="flex items-center gap-2 text-card font-semibold text-fg">
            <MapPin aria-hidden="true" className="size-4 text-fg-subtle" /> Where
          </h2>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Location type">
            {(["IN_PERSON", "ONLINE", "HYBRID", "UNSPECIFIED"] as const).map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={state.locationType === type}
                onClick={() => set("locationType", type)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-table transition-colors",
                  state.locationType === type ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {LOCATION_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {state.locationType === "IN_PERSON" || state.locationType === "HYBRID" ? (
              <div className="space-y-1.5">
                <Label htmlFor="meeting-location">Place</Label>
                <Input id="meeting-location" value={state.locationText} maxLength={200} onChange={(change) => set("locationText", change.target.value)} placeholder="Site office, room or address" />
              </div>
            ) : null}
            {state.locationType === "ONLINE" || state.locationType === "HYBRID" ? (
              <div className="space-y-1.5">
                <Label htmlFor="meeting-url">Meeting link</Label>
                <div className="relative">
                  <Video aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
                  <Input id="meeting-url" type="url" inputMode="url" value={state.onlineUrl} maxLength={500} onChange={(change) => set("onlineUrl", change.target.value)} placeholder="https://" className="pl-9" aria-invalid={Boolean(errors.onlineUrl)} />
                </div>
                {fieldError("onlineUrl")}
              </div>
            ) : null}
          </div>
        </section>

        <section className="nesto-card p-5 sm:p-6">
          <button
            type="button"
            onClick={() => setMore((value) => !value)}
            aria-expanded={more}
            className="flex w-full items-center justify-between gap-2 text-card font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            More options
            <ChevronDown aria-hidden="true" className={cn("size-4 text-fg-subtle transition-transform", more && "rotate-180")} />
          </button>
          {more ? (
            <div className="mt-5 space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="meeting-description">Purpose</Label>
                <Textarea id="meeting-description" rows={3} maxLength={5000} value={state.description} onChange={(change) => set("description", change.target.value)} placeholder="Why this meeting, and what should come out of it" />
                <p className="text-meta text-fg-subtle">The agenda is built separately, topic by topic.</p>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-table font-medium text-fg">Who can see it</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {visibilities.map((visibility) => (
                    <label
                      key={visibility}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-table transition-colors",
                        state.visibility === visibility ? "border-accent/40 bg-accent-soft" : "border-line hover:border-line-strong",
                      )}
                    >
                      <input
                        type="radio"
                        name="meeting-visibility"
                        value={visibility}
                        checked={state.visibility === visibility}
                        onChange={() => setState((current) => ({ ...current, visibility, visibilityTouched: true }))}
                        className="mt-0.5 accent-[var(--nesto-accent)]"
                      />
                      <span>
                        <span className="block font-medium text-fg">{MEETING_VISIBILITY_LABELS[visibility]}</span>
                        <span className="block text-meta text-fg-subtle">
                          {visibility === "PARTICIPANTS"
                            ? "The organizer and the people invited"
                            : visibility === "PROJECT"
                              ? project
                                ? `Everyone on ${project.name}`
                                : "Everyone on the chosen project"
                              : visibility === "DEPARTMENT"
                                ? "Members of the department"
                                : "Every member who can open meetings"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {state.visibility === "DEPARTMENT" && options.departments.length > 1 ? (
                  <select aria-label="Department" className={selectClass} value={state.departmentId} onChange={(change) => set("departmentId", change.target.value)}>
                    {options.departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                {fieldError("departmentId")}
              </fieldset>

              {!editing ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="meeting-template">Agenda template</Label>
                      <select id="meeting-template" className={selectClass} value={state.agendaTemplate} onChange={(change) => set("agendaTemplate", change.target.value)}>
                        <option value="">Start with an empty agenda</option>
                        {options.templates.map((template) => (
                          <option key={template.key} value={template.key}>
                            {template.label} · {template.count} items
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="meeting-repeat">Repeat</Label>
                      <select id="meeting-repeat" className={selectClass} value={state.frequency} onChange={(change) => set("frequency", change.target.value as State["frequency"])}>
                        <option value="">Does not repeat</option>
                        <option value="DAILY">Every day</option>
                        <option value="WEEKLY">Every week</option>
                        <option value="MONTHLY">Every month</option>
                      </select>
                    </div>
                  </div>
                  {state.frequency ? (
                    <div className="space-y-2 rounded-lg border border-line bg-surface-muted p-3">
                      <div className="flex flex-wrap items-center gap-3 text-table text-fg">
                        <label className="flex items-center gap-2">
                          <input type="radio" name="meeting-ends" checked={state.endMode === "count"} onChange={() => set("endMode", "count")} className="accent-[var(--nesto-accent)]" />
                          After
                          <Input aria-label="Number of meetings" type="number" min={2} max={100} value={state.count} onChange={(change) => set("count", change.target.value)} className="h-8 w-20" disabled={state.endMode !== "count"} />
                          meetings
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="radio" name="meeting-ends" checked={state.endMode === "until"} onChange={() => set("endMode", "until")} className="accent-[var(--nesto-accent)]" />
                          Until
                          <Input aria-label="Repeat until" type="date" min={state.date} value={state.until} onChange={(change) => set("until", change.target.value)} className="h-8 w-40" disabled={state.endMode !== "until"} />
                        </label>
                      </div>
                      <p className="text-meta text-fg-subtle">Each meeting keeps its own minutes, decisions and actions. Meetings are created up to 90 days ahead and topped up as time passes.</p>
                      {fieldError("recurrence")}
                    </div>
                  ) : null}
                  <fieldset className="space-y-2">
                    <legend className="text-table font-medium text-fg">Remind everyone</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {REMINDER_CHOICES.map((choice) => {
                        const on = state.reminders.includes(choice.value);
                        return (
                          <button
                            key={choice.value}
                            type="button"
                            aria-pressed={on}
                            disabled={!on && state.reminders.length >= 3}
                            onClick={() => set("reminders", on ? state.reminders.filter((value) => value !== choice.value) : [...state.reminders, choice.value])}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-meta transition-colors disabled:opacity-40",
                              on ? "border-accent/40 bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                            )}
                          >
                            {choice.label} before
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                </>
              ) : null}
            </div>
          ) : null}
        </section>

        {errors.form ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong">
            {errors.form}
            {stale ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => window.location.reload()}>
                <RotateCw aria-hidden="true" />
                Reload latest
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="nesto-card p-5">
          <p className="nesto-eyebrow text-fg-subtle">{MEETING_TYPE_LABELS[state.meetingType as keyof typeof MEETING_TYPE_LABELS]}</p>
          <p className="mt-1.5 break-words text-card font-semibold text-fg">{state.title.trim() || "Untitled meeting"}</p>
          <p className="mt-2 text-table text-fg-muted">
            {state.date ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${state.date}T12:00:00Z`)) : "—"}
          </p>
          <p className="text-table text-fg-muted">
            {state.startTime}–{state.endTime}
            {duration > 0 ? <span className="text-fg-subtle"> · {durationLabel(`2000-01-01T${state.startTime}:00Z`, `2000-01-01T${state.endTime}:00Z`)}</span> : null}
          </p>
          {project ? <p className="mt-2 text-table text-fg">{project.name}</p> : null}
          {!editing ? <p className="mt-2 text-meta text-fg-subtle">{state.participants.length + 1} {state.participants.length === 0 ? "person" : "people"}</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <Button type="submit" disabled={pending !== null}>
            {pending === "save" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {editing ? "Save changes" : "Schedule meeting"}
          </Button>
          {!editing && !state.frequency ? (
            <Button type="button" variant="secondary" disabled={pending !== null} onClick={(event) => void submit(event, true)}>
              {pending === "draft" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              Save as draft
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link href={cancelHref}>Cancel</Link>
          </Button>
          {!editing ? <p className="text-center text-meta text-fg-subtle">{state.participants.length > 0 ? "Participants are invited when it is scheduled." : "Add people now or later."}</p> : null}
        </div>
      </aside>
    </form>
  );
}
