"use client";

import * as React from "react";
import { ChevronDown, Loader2, TriangleAlert, X } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatClock } from "@/lib/modules/calendar/calendar.format";
import type { CalendarFormOptions } from "@/lib/modules/calendar/calendar.options";
import { addLocalDays, instantFromLocal, localDate, localTime } from "@/lib/modules/calendar/calendar.time";
import type { CalendarEventDetailDTO, ConflictDTO, RecurrenceFrequency } from "@/lib/modules/calendar/calendar.types";
import { cn } from "@/lib/utils/cn";
import { useIsPhone } from "./use-is-phone";

/**
 * Create and edit a Calendar-owned event (PRD #39 §147-§150, §89, §90).
 *
 * The first screen asks only what every event needs — title, type, when, who
 * sees it. Project, department, people, place, notes, reminder and repetition
 * wait behind "More options". The drawer offers only types and visibilities
 * the server would accept, and the server checks again.
 */

const TYPE_LABEL: Record<string, string> = {
  PERSONAL_EVENT: "Personal event",
  TEAM_EVENT: "Team event",
  INTERNAL_DEADLINE: "Internal deadline",
  TRAINING: "Training",
  COMPANY_EVENT: "Company event",
  COMPANY_HOLIDAY: "Company holiday",
  OFFICE_CLOSURE: "Office closure",
};
const VISIBILITY_LABEL: Record<string, string> = {
  PRIVATE: "Only me",
  SELECTED_MEMBERS: "People I invite",
  PROJECT: "Project",
  DEPARTMENT: "Department",
  COMPANY: "Everyone in the company",
};
const SMART_VISIBILITY: Record<string, string> = {
  PERSONAL_EVENT: "PRIVATE",
  TEAM_EVENT: "SELECTED_MEMBERS",
  INTERNAL_DEADLINE: "DEPARTMENT",
  TRAINING: "COMPANY",
  COMPANY_EVENT: "COMPANY",
  COMPANY_HOLIDAY: "COMPANY",
  OFFICE_CLOSURE: "COMPANY",
};
const REMINDERS = [
  { value: "", label: "No reminder" },
  { value: "0", label: "At the time" },
  { value: "10", label: "10 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
  { value: "10080", label: "1 week before" },
];

export type EventFormMode =
  | { kind: "create"; date: string; time?: string; eventType?: string }
  | { kind: "edit"; event: CalendarEventDetailDTO };

type Person = { memberId: string; fullName: string };

type FormState = {
  title: string;
  eventType: string;
  visibility: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  projectId: string;
  departmentId: string;
  location: string;
  description: string;
  reminder: string;
  frequency: "" | RecurrenceFrequency;
  until: string;
  participants: Person[];
};

function initialState(mode: EventFormMode, zone: string): FormState {
  if (mode.kind === "edit") {
    const event = mode.event;
    const start = new Date(event.startsAt);
    const end = event.endsAt ? new Date(event.endsAt) : start;
    return {
      title: event.title,
      eventType: event.eventType,
      visibility: event.visibility,
      allDay: event.allDay,
      startDate: localDate(start, zone),
      endDate: event.allDay ? localDate(new Date(end.getTime() - 1), zone) : localDate(end, zone),
      startTime: event.allDay ? "09:00" : localTime(start, zone),
      endTime: event.allDay ? "10:00" : localTime(end, zone),
      projectId: event.project?.id ?? "",
      departmentId: event.department?.id ?? "",
      location: event.location ?? "",
      description: event.description ?? "",
      reminder: event.reminders[0] ? String(event.reminders[0].minutesBefore) : "",
      frequency: event.recurrence?.frequency ?? "",
      until: event.recurrence?.until ?? "",
      participants: event.participants.map((person) => ({ memberId: person.memberId, fullName: person.fullName })),
    };
  }
  const eventType = mode.eventType ?? "PERSONAL_EVENT";
  const startTime = mode.time ?? "09:00";
  const [h, m] = startTime.split(":").map(Number);
  const endMinutes = Math.min(23 * 60 + 45, h * 60 + m + 60);
  return {
    title: "",
    eventType,
    visibility: SMART_VISIBILITY[eventType],
    allDay: eventType === "COMPANY_HOLIDAY" || eventType === "OFFICE_CLOSURE",
    startDate: mode.date,
    endDate: mode.date,
    startTime,
    endTime: `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`,
    projectId: "",
    departmentId: "",
    location: "",
    description: "",
    reminder: "",
    frequency: "",
    until: "",
    participants: [],
  };
}

export function EventFormDrawer({
  open,
  mode,
  zone,
  canViewAvailability,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  mode: EventFormMode | null;
  zone: string;
  canViewAvailability: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (event: CalendarEventDetailDTO, conflicts: ConflictDTO[]) => void;
}) {
  const phone = useIsPhone();
  const toast = useToast();
  const [state, setState] = React.useState<FormState | null>(null);
  const [options, setOptions] = React.useState<CalendarFormOptions | null>(null);
  const [more, setMore] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [conflicts, setConflicts] = React.useState<ConflictDTO[]>([]);
  const [query, setQuery] = React.useState("");
  const [people, setPeople] = React.useState<Person[]>([]);

  React.useEffect(() => {
    if (!open || !mode) return;
    const next = initialState(mode, zone);
    setState(next);
    setMore(mode.kind === "edit" && Boolean(next.projectId || next.departmentId || next.participants.length || next.location || next.description || next.frequency));
    setErrors({});
    setConflicts([]);
    setQuery("");
    fetch("/api/calendar/options")
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => setOptions(json?.data ?? null))
      .catch(() => setOptions(null));
  }, [open, mode, zone]);

  React.useEffect(() => {
    if (!open || !query.trim()) {
      setPeople([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/calendar/options?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((json) => setPeople(json?.data ?? []))
        .catch(() => undefined);
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, open]);

  // Conflicts are a warning, fetched while the form is filled in (PRD #39 §89).
  const conflictKey = state
    ? `${state.participants.map((person) => person.memberId).join(",")}|${state.startDate}|${state.startTime}|${state.endDate}|${state.endTime}|${state.allDay}`
    : "";
  React.useEffect(() => {
    if (!open || !state || !canViewAvailability || state.allDay || state.participants.length === 0) {
      setConflicts([]);
      return;
    }
    const startsAt = instantFromLocal(state.startDate, state.startTime, zone);
    const endsAt = instantFromLocal(state.endDate || state.startDate, state.endTime, zone);
    if (endsAt <= startsAt) return;
    const params = new URLSearchParams({ from: startsAt.toISOString(), to: endsAt.toISOString() });
    for (const person of state.participants) params.append("memberIds", person.memberId);
    if (mode?.kind === "edit") params.set("excludeEventId", mode.event.id);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/calendar/availability?${params}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((json) => setConflicts(((json?.data ?? []) as ConflictDTO[]).filter((row) => row.busy.length > 0)))
        .catch(() => undefined);
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictKey, open, canViewAvailability]);

  if (!state || !mode) return null;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((current) => (current ? { ...current, [key]: value } : current));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!state || !mode) return;
    setPending(true);
    setErrors({});
    const body = {
      title: state.title,
      eventType: state.eventType,
      visibility: state.visibility,
      allDay: state.allDay,
      startDate: state.startDate,
      endDate: state.endDate || state.startDate,
      startTime: state.allDay ? undefined : state.startTime,
      endTime: state.allDay ? undefined : state.endTime,
      projectId: state.visibility === "PROJECT" || state.projectId ? state.projectId || null : null,
      departmentId: state.visibility === "DEPARTMENT" ? state.departmentId || options?.myDepartmentId || null : null,
      location: state.location || null,
      description: state.description || null,
      participantIds: state.participants.map((person) => person.memberId),
      reminders: state.reminder === "" ? [] : [{ minutesBefore: Number(state.reminder), channel: "IN_APP" }],
      recurrence: state.frequency ? { frequency: state.frequency, interval: 1, until: state.until || undefined } : null,
    };
    try {
      const response = await fetch(mode.kind === "edit" ? `/api/calendar/events/${mode.event.id}` : "/api/calendar/events", {
        method: mode.kind === "edit" ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        const details = (json?.error?.details ?? {}) as Record<string, unknown>;
        const fieldErrors: Record<string, string> = {};
        for (const [key, value] of Object.entries(details)) if (Array.isArray(value) && typeof value[0] === "string") fieldErrors[key] = value[0];
        setErrors({ form: json?.error?.message ?? "The event could not be saved.", ...fieldErrors });
        return;
      }
      toast({ title: mode.kind === "edit" ? "Event updated" : "Event created", tone: "success" });
      onSaved(json.event as CalendarEventDetailDTO, (json.conflicts ?? []) as ConflictDTO[]);
      onOpenChange(false);
    } catch {
      setErrors({ form: "The event could not be saved. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  const types = options?.eventTypes ?? [state.eventType];
  const visibilities = options?.visibilities ?? [state.visibility];
  const fieldError = (key: string) => (errors[key] ? <p className="text-meta text-danger-strong">{errors[key]}</p> : null);

  return (
    <Drawer open={open} onOpenChange={(next) => (pending ? null : onOpenChange(next))}>
      <DrawerContent side={phone ? "bottom" : "right"} className={cn("bg-surface", !phone && "sm:max-w-[480px]")} aria-describedby="event-form-description">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
            <div>
              <DrawerTitle className="text-section font-semibold text-fg">{mode.kind === "edit" ? "Edit event" : "New event"}</DrawerTitle>
              <DrawerDescription id="event-form-description" className="mt-1 text-table text-fg-muted">
                Times are in the company&apos;s time zone ({zone.replace("_", " ")}).
              </DrawerDescription>
            </div>
            <button type="button" aria-label="Close" onClick={() => onOpenChange(false)} className="rounded-md p-1 text-fg-subtle hover:bg-hover hover:text-fg">
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="event-title">Title</Label>
              <Input id="event-title" autoFocus value={state.title} maxLength={180} onChange={(change) => set("title", change.target.value)} placeholder="What is happening?" />
              {fieldError("title")}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="event-type">Type</Label>
                <select
                  id="event-type"
                  className={selectClass}
                  value={state.eventType}
                  onChange={(change) => {
                    const eventType = change.target.value;
                    const suggested = SMART_VISIBILITY[eventType];
                    setState((current) =>
                      current
                        ? {
                            ...current,
                            eventType,
                            visibility: visibilities.includes(suggested as never) ? suggested : current.visibility,
                            allDay: eventType === "COMPANY_HOLIDAY" || eventType === "OFFICE_CLOSURE" ? true : current.allDay,
                          }
                        : current,
                    );
                  }}
                >
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-visibility">Who can see it</Label>
                <select id="event-visibility" className={selectClass} value={state.visibility} onChange={(change) => set("visibility", change.target.value)}>
                  {visibilities.map((visibility) => (
                    <option key={visibility} value={visibility}>
                      {VISIBILITY_LABEL[visibility]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-line p-4">
              <label className="flex items-center justify-between gap-3">
                <span className="text-table font-medium text-fg">All day</span>
                <Switch checked={state.allDay} onCheckedChange={(checked) => set("allDay", checked)} aria-label="All day" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="event-start-date">{state.allDay ? "From" : "Date"}</Label>
                  <Input
                    id="event-start-date"
                    type="date"
                    value={state.startDate}
                    onChange={(change) => {
                      const value = change.target.value;
                      setState((current) => (current ? { ...current, startDate: value, endDate: !current.endDate || current.endDate < value ? value : current.endDate } : current));
                    }}
                  />
                </div>
                {state.allDay ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="event-end-date">To</Label>
                    <Input id="event-end-date" type="date" min={state.startDate} value={state.endDate} onChange={(change) => set("endDate", change.target.value)} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="event-start-time">Start</Label>
                      <Input id="event-start-time" type="time" step={900} value={state.startTime} onChange={(change) => set("startTime", change.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="event-end-time">End</Label>
                      <Input id="event-end-time" type="time" step={900} value={state.endTime} onChange={(change) => set("endTime", change.target.value)} />
                    </div>
                  </div>
                )}
              </div>
              {fieldError("endDate")}
            </div>

            {state.visibility === "PROJECT" ? (
              <ProjectField state={state} options={options} set={set} error={fieldError("projectId")} />
            ) : null}
            {state.visibility === "DEPARTMENT" && options && options.departments.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="event-department">Department</Label>
                <select id="event-department" className={selectClass} value={state.departmentId || options.myDepartmentId || ""} onChange={(change) => set("departmentId", change.target.value)}>
                  {options.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
                {fieldError("departmentId")}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setMore((value) => !value)}
              aria-expanded={more}
              className="flex items-center gap-1.5 text-table font-medium text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", more && "rotate-180")} />
              More options
            </button>

            {more ? (
              <div className="space-y-5">
                {state.visibility !== "PROJECT" && options && options.projects.length > 0 ? (
                  <ProjectField state={state} options={options} set={set} optional error={fieldError("projectId")} />
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor="event-people">People</Label>
                  {state.participants.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {state.participants.map((person) => (
                        <li key={person.memberId} className="flex items-center gap-1 rounded-full border border-line bg-surface-muted py-0.5 pl-2.5 pr-1 text-table">
                          {person.fullName}
                          <button
                            type="button"
                            aria-label={`Remove ${person.fullName}`}
                            onClick={() => set("participants", state.participants.filter((row) => row.memberId !== person.memberId))}
                            className="rounded-full p-0.5 text-fg-subtle hover:bg-hover hover:text-fg"
                          >
                            <X aria-hidden="true" className="size-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Input id="event-people" value={query} onChange={(change) => setQuery(change.target.value)} placeholder="Add people by name" autoComplete="off" />
                  {people.length > 0 ? (
                    <ul role="listbox" aria-label="People you can invite" className="max-h-48 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-menu">
                      {people
                        .filter((person) => !state.participants.some((row) => row.memberId === person.memberId))
                        .map((person) => (
                          <li key={person.memberId}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={false}
                              onClick={() => {
                                set("participants", [...state.participants, person]);
                                setQuery("");
                              }}
                              className="w-full rounded px-2 py-1.5 text-left text-table text-fg hover:bg-hover"
                            >
                              {person.fullName}
                            </button>
                          </li>
                        ))}
                    </ul>
                  ) : null}
                  {fieldError("participantIds")}
                </div>

                {conflicts.length > 0 ? (
                  <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5 text-table text-warning-strong">
                    <p className="flex items-center gap-1.5 font-medium">
                      <TriangleAlert aria-hidden="true" className="size-4" />
                      {conflicts.length === 1 ? "1 person has a conflict" : `${conflicts.length} people have conflicts`}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[12px]">
                      {conflicts.map((conflict) => (
                        <li key={conflict.memberId}>
                          {conflict.fullName} — Busy{" "}
                          {conflict.busy
                            .slice(0, 2)
                            .map((slot) => `${formatClock(new Date(slot.startsAt), zone)}–${formatClock(new Date(slot.endsAt), zone)}`)
                            .join(", ")}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor="event-location">Location</Label>
                  <Input id="event-location" value={state.location} maxLength={200} onChange={(change) => set("location", change.target.value)} placeholder="Site, room or link" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="event-description">Description</Label>
                  <Textarea id="event-description" rows={3} maxLength={5000} value={state.description} onChange={(change) => set("description", change.target.value)} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="event-reminder">Reminder</Label>
                    <select id="event-reminder" className={selectClass} value={state.reminder} onChange={(change) => set("reminder", change.target.value)}>
                      {REMINDERS.map((reminder) => (
                        <option key={reminder.value} value={reminder.value}>
                          {reminder.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="event-repeat">Repeat</Label>
                    <select id="event-repeat" className={selectClass} value={state.frequency} onChange={(change) => set("frequency", change.target.value as FormState["frequency"])}>
                      <option value="">Does not repeat</option>
                      <option value="DAILY">Every day</option>
                      <option value="WEEKLY">Every week</option>
                      <option value="MONTHLY">Every month</option>
                      <option value="YEARLY">Every year</option>
                    </select>
                  </div>
                </div>
                {state.frequency ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="event-until">Repeat until</Label>
                    <Input id="event-until" type="date" min={addLocalDays(state.startDate, 1)} value={state.until} onChange={(change) => set("until", change.target.value)} />
                    <p className="text-meta text-fg-subtle">Changes to a repeating event apply to the whole series.</p>
                    {fieldError("recurrence")}
                  </div>
                ) : null}
              </div>
            ) : null}

            {errors.form ? (
              <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
                {errors.form}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !state.title.trim()}>
              {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {mode.kind === "edit" ? "Save changes" : "Create event"}
            </Button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function ProjectField({
  state,
  options,
  set,
  optional,
  error,
}: {
  state: FormState;
  options: CalendarFormOptions | null;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  optional?: boolean;
  error: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="event-project">Project{optional ? " (optional)" : ""}</Label>
      <select id="event-project" className={selectClass} value={state.projectId} onChange={(change) => set("projectId", change.target.value)}>
        <option value="">{optional ? "No project" : "Choose a project"}</option>
        {(options?.projects ?? []).map((project) => (
          <option key={project.id} value={project.id}>
            {project.code} · {project.name}
          </option>
        ))}
      </select>
      {error}
    </div>
  );
}
