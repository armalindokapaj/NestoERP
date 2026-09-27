"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { instantFromLocal } from "@/lib/modules/calendar/calendar.time";
import type { CalendarCategory } from "@/lib/modules/calendar/calendar.types";
import { cn } from "@/lib/utils/cn";
import { addMonths, CATEGORY_META, dayHeading, FILTER_CATEGORIES, visibleDays } from "./calendar-model";
import type { CalendarFilterState } from "./use-calendar-data";

/**
 * The sidebar: a mini month and the filters (PRD #39 §21, §23, §105).
 * On a phone the same filters open in a bottom sheet.
 */

export function MiniCalendar({
  date,
  zone,
  today,
  onSelect,
  busyDays,
}: {
  date: string;
  zone: string;
  today: string;
  onSelect: (date: string) => void;
  busyDays: Set<string>;
}) {
  const [month, setMonth] = React.useState(date.slice(0, 7) + "-01");
  React.useEffect(() => setMonth(date.slice(0, 7) + "-01"), [date]);
  const days = visibleDays("month", month, zone);
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: zone, month: "long", year: "numeric" }).format(instantFromLocal(month, "12:00", zone));

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-table font-semibold text-fg">{label}</span>
        <div className="flex gap-0.5">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))} className="grid size-7 place-items-center rounded-md text-fg-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring touch:size-11">
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <button type="button" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))} className="grid size-7 place-items-center rounded-md text-fg-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring touch:size-11">
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center" role="grid" aria-label={label}>
        {["M", "T", "W", "T", "F", "S", "S"].map((weekday, index) => (
          <span key={index} className="py-1 text-[11px] font-medium text-fg-subtle">
            {weekday}
          </span>
        ))}
        {days.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => onSelect(day)}
            aria-label={dayHeading(day, zone, today)}
            aria-current={day === date ? "date" : undefined}
            className={cn(
              "relative mx-auto grid size-8 place-items-center rounded-full text-[12px] tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              day.slice(0, 7) !== month.slice(0, 7) ? "text-fg-subtle/70" : "text-fg",
              day === date ? "bg-primary text-primary-fg" : day === today ? "font-semibold text-accent-strong" : "hover:bg-hover",
            )}
          >
            {Number(day.slice(8))}
            {busyDays.has(day) && day !== date ? <span aria-hidden="true" className="absolute bottom-1 size-1 rounded-full bg-fg-subtle/60" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CalendarFilters({
  filters,
  onChange,
  projects,
}: {
  filters: CalendarFilterState;
  onChange: (filters: CalendarFilterState) => void;
  projects: Array<{ id: string; name: string }>;
}) {
  const toggleCategory = (category: CalendarCategory, checked: boolean) => {
    const all = filters.categories.length === 0 ? FILTER_CATEGORIES : filters.categories;
    const next = checked ? [...new Set([...all, category])] : all.filter((value) => value !== category);
    onChange({ ...filters, categories: next.length === FILTER_CATEGORIES.length ? [] : next });
  };
  const toggleProject = (projectId: string, checked: boolean) => {
    const next = checked ? [...filters.projectIds, projectId] : filters.projectIds.filter((value) => value !== projectId);
    onChange({ ...filters, projectIds: next });
  };

  return (
    <div className="flex flex-col gap-6">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-table font-medium text-fg">My calendar</span>
          <span className="block text-meta text-fg-subtle">Only what is assigned to me or I am on</span>
        </span>
        <Switch checked={filters.myOnly} onCheckedChange={(checked) => onChange({ ...filters, myOnly: checked })} aria-label="My calendar" />
      </label>

      <fieldset>
        <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-subtle">Categories</legend>
        <div className="flex flex-col gap-1">
          {FILTER_CATEGORIES.map((category) => {
            const meta = CATEGORY_META[category];
            const checked = filters.categories.length === 0 || filters.categories.includes(category);
            const id = `calendar-category-${category}`;
            return (
              <label key={category} htmlFor={id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 hover:bg-hover">
                <Checkbox id={id} checked={checked} onCheckedChange={(value) => toggleCategory(category, value === true)} />
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: meta.token }} />
                <meta.icon aria-hidden="true" className="size-3.5 text-fg-subtle" />
                <span className="text-table text-fg">{meta.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {projects.length > 0 ? (
        <fieldset>
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-subtle">Projects</legend>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {projects.map((project) => {
              const id = `calendar-project-${project.id}`;
              return (
                <label key={project.id} htmlFor={id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 hover:bg-hover">
                  <Checkbox id={id} checked={filters.projectIds.includes(project.id)} onCheckedChange={(value) => toggleProject(project.id, value === true)} />
                  <span className="truncate text-table text-fg">{project.name}</span>
                </label>
              );
            })}
          </div>
          {filters.projectIds.length > 0 ? (
            <button type="button" onClick={() => onChange({ ...filters, projectIds: [] })} className="mt-2 text-meta font-medium text-accent-strong hover:underline">
              Show all projects
            </button>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}
