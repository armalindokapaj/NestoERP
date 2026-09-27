"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRouter } from "@/components/navigation/guarded-router";
import { CalendarPlus, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, RotateCw, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import type { CalendarEventDetailDTO, CalendarEventDTO, CalendarResponse, CalendarView } from "@/lib/modules/calendar/calendar.types";
import { cn } from "@/lib/utils/cn";
import { AgendaView } from "./agenda-view";
import { eventDays, isView, periodLabel, rangeFor, step, todayIn } from "./calendar-model";
import { CalendarFilters, MiniCalendar } from "./calendar-sidebar";
import { EventDrawer } from "./event-drawer";
import { EventFormDrawer, type EventFormMode } from "./event-form";
import { MonthView } from "./month-view";
import { TimeGridView } from "./time-grid-view";
import { EMPTY_FILTERS, readPreferences, useCalendarData, writePreferences, type CalendarFilterState } from "./use-calendar-data";
import { belowQuery } from "@/components/ui/use-breakpoint";
import { useIsPhone } from "./use-is-phone";
import { englishCalendar, useCalendarTranslations, useDayWords } from "./calendar-text";
import { HelpEntry } from "@/components/help/help-entry";

/**
 * The calendar workspace (PRD #39 §6, §7, §20-§22, §100, §106, §170).
 *
 * View and date live in the URL, so a link opens the same period; filters and
 * the sidebar are remembered per browser. Desktop opens on Week, a phone on
 * Agenda.
 */

// Labels stay here in English; the tabs read the reader's words by key.
const VIEWS: Array<{ key: CalendarView; label: string }> = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "day", label: "Day" },
  { key: "agenda", label: "Agenda" },
];

export function CalendarShell({
  initial,
  initialView,
  initialDate,
  explicitView,
  openEventId,
}: {
  initial: CalendarResponse;
  initialView: CalendarView;
  initialDate: string;
  explicitView: boolean;
  openEventId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // `undefined` until the browser answers (AUD-04 §3, SP-15); treated as "not a phone" for behaviour.
  const phone = useIsPhone() === true;
  const toast = useToast();
  const t = useCalendarTranslations();
  const words = useDayWords();
  const zone = initial.timezone;
  const today = todayIn(zone);

  const [view, setView] = React.useState<CalendarView>(initialView);
  const [date, setDate] = React.useState(initialDate);
  const [filters, setFilters] = React.useState<CalendarFilterState>(EMPTY_FILTERS);
  const [collapsed, setCollapsed] = React.useState(false);
  const [filterSheet, setFilterSheet] = React.useState(false);
  const [openEvent, setOpenEvent] = React.useState<CalendarEventDTO | null>(null);
  const [form, setForm] = React.useState<EventFormMode | null>(null);
  const hydrated = React.useRef(false);
  // Until the mount effect has chosen the phone's Agenda, the server's view is
  // kept out of sight on a phone, so the week grid never flashes there first
  // (AUD-04 §8, D-08-14, MW-17). A shared link (explicit view) is final at once.
  const [settled, setSettled] = React.useState(explicitView);

  // Remembered choices apply after hydration, and never override a shared link.
  React.useEffect(() => {
    const stored = readPreferences();
    if (stored.filters) setFilters({ ...EMPTY_FILTERS, ...stored.filters });
    if (stored.sidebarCollapsed) setCollapsed(true);
    if (!explicitView) {
      if (window.matchMedia(belowQuery("md")).matches) setView("agenda");
      else if (isView(stored.view)) setView(stored.view);
    }
    setSettled(true);
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const range = React.useMemo(() => rangeFor(view, date, zone), [view, date, zone]);
  const initialForRange =
    initial.range.from === range.from.toISOString() && initial.range.to === range.to.toISOString() ? initial : null;
  const { data, loading, error, reload, patchEvents } = useCalendarData(range, filters, initialForRange);
  const response = data ?? initial;
  const events = response.events;

  // URL state (PRD #39 §170).
  React.useEffect(() => {
    if (!hydrated.current) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    params.set("date", date);
    router.replace(`${pathname}?${params}`, { scroll: false });
    writePreferences({ view });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date]);

  React.useEffect(() => {
    if (hydrated.current) writePreferences({ filters, sidebarCollapsed: collapsed });
  }, [filters, collapsed]);

  // A link to one event (a reminder, a search result) opens it.
  React.useEffect(() => {
    if (!openEventId) return;
    const found = events.find((row) => row.sourceType === "calendar_event" && row.sourceId === openEventId);
    if (found) {
      setOpenEvent(found);
      return;
    }
    fetch(`/api/calendar/events/${openEventId}`)
      .then((result) => (result.ok ? result.json() : null))
      .then((json: { data: CalendarEventDetailDTO } | null) => {
        if (!json) return;
        const detail = json.data;
        setOpenEvent({
          id: `calendar:${detail.id}`,
          sourceType: "calendar_event",
          sourceId: detail.id,
          providerKey: "calendar",
          title: detail.title,
          startsAt: detail.startsAt,
          endsAt: detail.endsAt ?? undefined,
          allDay: detail.allDay,
          category: detail.eventType === "PERSONAL_EVENT" ? "PERSONAL" : detail.visibility === "PROJECT" ? "PROJECT" : "COMPANY",
          href: detail.href,
          editable: detail.capabilities.canEdit,
          draggable: false,
          resizable: false,
          occurrence: { seriesId: detail.id, recurring: Boolean(detail.recurrence) },
        });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEventId]);

  const canCreate = response.capabilities.canCreate;
  const startCreate = React.useCallback(
    (onDate?: string, time?: string, eventType?: string) => {
      if (!canCreate) return;
      setForm({ kind: "create", date: onDate ?? (date < today && view !== "day" ? today : date), time, eventType });
    },
    [canCreate, date, today, view],
  );

  // Keyboard: T for today, N for a new event (PRD #39 §100).
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (event.key === "t" || event.key === "T") setDate(today);
      if ((event.key === "n" || event.key === "N") && canCreate) {
        event.preventDefault();
        startCreate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [today, canCreate, startCreate]);

  async function move(event: CalendarEventDTO, startsAt: Date, endsAt: Date) {
    const before = { startsAt: event.startsAt, endsAt: event.endsAt };
    // Optimistic, then the server decides (PRD #39 §83, §171).
    patchEvents(event.sourceId, (row) => ({ ...row, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }));
    const result = await fetch(`/api/calendar/events/${event.sourceId}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }),
    }).catch(() => null);
    if (!result?.ok) {
      patchEvents(event.sourceId, (row) => ({ ...row, ...before }));
      const json = await result?.json().catch(() => null);
      toast({ title: json?.error?.message ?? t("shell.moveFailed"), tone: "danger" });
      return;
    }
    const json = (await result.json()) as { conflicts: Array<{ fullName: string }> };
    toast({
      title: t("shell.moved"),
      description: json.conflicts.length ? t("shell.busyThen", { names: json.conflicts.map((row) => row.fullName).join(", "), count: json.conflicts.length }) : undefined,
      tone: json.conflicts.length ? "warning" : "success",
    });
    reload();
  }

  const projectsForFilter = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const event of events) if (event.project) map.set(event.project.id, event.project.name);
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [events]);

  const busyDays = React.useMemo(() => {
    const set = new Set<string>();
    for (const event of events) for (const day of eventDays(event, zone)) set.add(day);
    return set;
  }, [events, zone]);

  const filtersActive = filters.myOnly || filters.categories.length > 0 || filters.projectIds.length > 0;
  const partial = response.meta.partialFailureProviders?.length;

  const newMenu = canCreate ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={phone ? "icon" : "md"} aria-label={t("shell.new")}>
          <CalendarPlus aria-hidden="true" />
          {phone ? null : t("shell.new")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("shell.create")}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => startCreate(undefined, undefined, "PERSONAL_EVENT")}>{t("labels.eventType.PERSONAL_EVENT")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => startCreate(undefined, undefined, "TEAM_EVENT")}>{t("labels.eventType.TEAM_EVENT")}</DropdownMenuItem>
        {response.capabilities.canCreateCompanyEvent ? (
          <>
            <DropdownMenuItem onSelect={() => startCreate(undefined, undefined, "COMPANY_EVENT")}>{t("labels.eventType.COMPANY_EVENT")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => startCreate(undefined, undefined, "COMPANY_HOLIDAY")}>{t("labels.eventType.COMPANY_HOLIDAY")}</DropdownMenuItem>
          </>
        ) : null}
        {/* Tasks and meetings are created in their own modules, with their own rules (PRD #39 §35, PRD #40 §9). */}
        {response.capabilities.canCreateMeeting ? (
          <DropdownMenuItem asChild>
            <Link href={`/meetings/new?date=${date}`}>{t("shell.meeting")}</Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/tasks/new">{t("shell.task")}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        // Week and Day scroll inside their card, so the grid can open at the working day.
        // The 620px floor only from lg: on a landscape phone it made the page and the grid both scroll (AUD-04 §8, D-08-17).
        view === "week" || view === "day" ? "h-[calc(100dvh-var(--nesto-topbar-height)-3rem)] min-h-[min(620px,calc(100dvh-var(--nesto-topbar-height)-3rem))] lg:min-h-[620px]" : "min-h-[calc(100dvh-var(--nesto-topbar-height)-3rem)]",
      )}
      data-testid="calendar"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-meta font-medium uppercase tracking-[0.12em] text-fg-subtle">{t("title")}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg md:text-[30px]" aria-live="polite">
            {periodLabel(view, date, zone, words.locale)}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HelpEntry moduleKey="calendar" moduleLabel={t("title")} />
          <Button variant="secondary" size="sm" onClick={() => setDate(today)} aria-label={t("shell.goToToday")}>
            {t("shell.today")}
          </Button>
          <div className="flex">
            <Button variant="ghost" size="icon-sm" aria-label={t("shell.previousPeriod")} onClick={() => setDate(step(view, date, -1))}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("shell.nextPeriod")} onClick={() => setDate(step(view, date, 1))}>
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
          <div role="tablist" aria-label={t("shell.viewLabel")} className="inline-flex rounded-lg border border-line bg-surface-muted p-0.5">
            {VIEWS.map((option) => (
              <button
                key={option.key}
                role="tab"
                type="button"
                aria-selected={view === option.key}
                onClick={() => setView(option.key)}
                className={cn(
                  // 44px under touch (AUD-04 §3, D-08-18, MW-19).
                  "rounded-md px-2.5 py-1 text-table font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:px-3 touch:min-h-11",
                  view === option.key ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg",
                )}
              >
                {t(`views.${option.key}`)}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => setFilterSheet(true)} aria-label={filtersActive ? t("shell.filtersApplied") : t("shell.filters")}>
            <SlidersHorizontal aria-hidden="true" />
            {filtersActive ? <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" /> : null}
          </Button>
          {newMenu}
        </div>
      </header>

      {error || partial ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-table text-warning-strong">
          {!error || error === englishCalendar("loadFailed") ? t("loadFailed") : error}
          <Button variant="ghost" size="sm" onClick={reload}>
            <RotateCw aria-hidden="true" />
            {t("shell.retry")}
          </Button>
        </div>
      ) : null}

      {response.meta.truncated ? (
        // A bounded read is said out loud, never shown as the whole period (AUD-08 §4, DT-05).
        <p role="status" data-testid="calendar-truncated" className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-table text-warning-strong">
          {t("truncated")}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4">
        <aside
          className={cn(
            "hidden shrink-0 flex-col gap-6 overflow-y-auto transition-[width] duration-200 ease-nesto motion-reduce:transition-none lg:flex",
            collapsed ? "w-10" : "w-[288px]",
          )}
          aria-label={t("shell.sidebarLabel")}
        >
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? t("shell.showSidebar") : t("shell.hideSidebar")}
            aria-expanded={!collapsed}
            className="grid size-8 place-items-center self-start rounded-md text-fg-subtle outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" className="size-4" /> : <PanelLeftClose aria-hidden="true" className="size-4" />}
          </button>
          {collapsed ? null : (
            <>
              <div className="nesto-card p-4">
                <MiniCalendar date={date} zone={zone} today={today} busyDays={busyDays} onSelect={(value) => setDate(value)} />
              </div>
              <div className="nesto-card p-4">
                <CalendarFilters filters={filters} onChange={setFilters} projects={projectsForFilter} />
              </div>
            </>
          )}
        </aside>

        <main
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            view === "month" && "min-h-[560px]",
            view === "agenda" || (view === "month" && phone) ? "" : "nesto-card",
            view === "agenda" && "nesto-card px-3 md:px-4",
            !settled && "max-md:invisible",
          )}
          aria-busy={loading || !settled}
        >
          {loading ? <div className="absolute inset-x-0 top-0 z-30 h-0.5 animate-pulse bg-accent/60" aria-hidden="true" /> : null}
          {view === "month" ? (
            <MonthView
              date={date}
              zone={zone}
              today={today}
              events={events}
              workingDays={response.workingHours.days}
              selectedDate={date}
              onSelectDate={(value) => (phone ? setDate(value) : (setDate(value), setView("day")))}
              onOpen={setOpenEvent}
              onCreate={canCreate ? (value) => startCreate(value) : undefined}
            />
          ) : view === "agenda" ? (
            <AgendaView date={date} zone={zone} today={today} events={events} onOpen={setOpenEvent} onCreate={canCreate ? () => startCreate() : undefined} />
          ) : (
            <TimeGridView
              view={view}
              date={date}
              zone={zone}
              today={today}
              events={events}
              workingHours={response.workingHours}
              onOpen={setOpenEvent}
              onCreate={canCreate ? (value, time) => startCreate(value, time) : undefined}
              onMove={(event, startsAt, endsAt) => void move(event, startsAt, endsAt)}
            />
          )}
          {!loading && events.length === 0 && view !== "agenda" && !(view === "month" && phone) ? (
            <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-body text-fg-muted" data-testid="calendar-empty">
              {t("nothingInPeriod")}
            </p>
          ) : null}
        </main>
      </div>

      <Drawer open={filterSheet} onOpenChange={setFilterSheet}>
        <DrawerContent side="bottom" className="bg-surface px-5 pb-8 pt-5">
          <DrawerTitle className="text-card font-semibold text-fg">{t("shell.filters")}</DrawerTitle>
          <DrawerDescription className="mb-4 text-table text-fg-muted">{t("shell.filtersNote")}</DrawerDescription>
          <MiniCalendar date={date} zone={zone} today={today} busyDays={busyDays} onSelect={(value) => { setDate(value); setFilterSheet(false); }} />
          <div className="mt-6">
            <CalendarFilters filters={filters} onChange={setFilters} projects={projectsForFilter} />
          </div>
        </DrawerContent>
      </Drawer>

      <EventDrawer
        event={openEvent}
        zone={zone}
        onOpenChange={(open) => {
          if (open) return;
          setOpenEvent(null);
          if (searchParams.get("event")) {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("event");
            router.replace(`${pathname}?${params}`, { scroll: false });
          }
        }}
        onEdit={(detail) => {
          setOpenEvent(null);
          setForm({ kind: "edit", event: detail });
        }}
        onChanged={({ archived }) => {
          if (archived) patchEvents(archived, () => null);
          reload();
        }}
      />

      <EventFormDrawer
        open={form !== null}
        mode={form}
        zone={zone}
        canViewAvailability={response.capabilities.canViewAvailability}
        onOpenChange={(open) => (open ? null : setForm(null))}
        onSaved={(_saved, conflicts) => {
          if (conflicts.length > 0) {
            toast({ title: t("shell.savedWithConflicts"), description: t("shell.alreadyBusy", { names: conflicts.map((row) => row.fullName).join(", "), count: conflicts.length }), tone: "warning" });
          }
          reload();
        }}
      />
    </div>
  );
}
