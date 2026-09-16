"use client";

import * as React from "react";
import { LayoutGrid, List, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { SearchField } from "@/components/ui/search-field";
import { ASSIGNED_ROLE_VALUE, type PortfolioUrlUpdate } from "@/lib/modules/projects/project.portfolio-url";
import type { PortfolioQuery } from "@/lib/modules/projects/project.schema";
import type { PortfolioFilterOptionsDTO } from "@/lib/modules/projects/project.types";
import type { ProjectsView } from "@/lib/modules/projects/project.view-preference";
import { cn } from "@/lib/utils/cn";

const SEARCH_DEBOUNCE_MS = 300;

const QUICK_FILTERS = [
  { key: "all", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "PENDING", label: "Pending" },
  { key: "FINISHED", label: "Finished" },
  { key: "favorites", label: "Favorites" },
] as const;

const SORTS: Array<{ value: PortfolioQuery["sort"]; label: string }> = [
  { value: "recommended", label: "Recommended" },
  { value: "activity", label: "Recently active" },
  { value: "name-asc", label: "Project name A–Z" },
  { value: "name-desc", label: "Project name Z–A" },
  { value: "company-asc", label: "Company A–Z" },
  { value: "newest", label: "Newest project" },
  { value: "oldest", label: "Oldest project" },
];

const selectClass =
  "h-9 w-full rounded-md border border-line bg-surface px-2.5 text-table text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20 md:w-auto md:min-w-[10.5rem]";

/**
 * Search, quick filters, filters, sort and view (E-05A §6, §16-§21, §24).
 *
 * Every value lives in the URL, so a filtered page can be shared, refreshed and
 * returned to with Back. Search waits for a pause in typing before it asks. On a
 * phone the four filters move into a bottom sheet; nothing depends on hover.
 */
export function ProjectsToolbar({
  query,
  options,
  view,
  filterCount,
  onNavigate,
  onViewChange,
}: {
  query: PortfolioQuery;
  options: PortfolioFilterOptionsDTO;
  view: ProjectsView;
  filterCount: number;
  onNavigate: (update: PortfolioUrlUpdate, mode?: "push" | "replace") => void;
  onViewChange: (view: ProjectsView) => void;
}) {
  const [text, setText] = React.useState(query.q ?? "");
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const lastSent = React.useRef(query.q ?? "");

  // A search cleared or changed from outside (Clear filters, Back) shows here.
  React.useEffect(() => {
    lastSent.current = query.q ?? "";
    setText(query.q ?? "");
  }, [query.q]);

  React.useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === lastSent.current) return;
    const timer = window.setTimeout(() => {
      lastSent.current = trimmed;
      onNavigate({ q: trimmed || null }, "replace");
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, onNavigate]);

  const activeQuick = query.favorites ? "favorites" : (query.status ?? "all");
  const advancedCount = [query.companyId, query.role, query.projectType, query.location].filter(Boolean).length;

  const filters = (
    <>
      {options.companies.length > 1 ? (
        <FilterSelect label="Company" value={query.companyId} onChange={(value) => onNavigate({ company: value })}>
          <option value="">All companies</option>
          {options.companies.map((company) => (
            <option key={company.id} value={company.id}>{company.name}</option>
          ))}
        </FilterSelect>
      ) : null}
      <FilterSelect label="My role" value={query.role} onChange={(value) => onNavigate({ role: value })}>
        <option value="">Any role</option>
        <option value={ASSIGNED_ROLE_VALUE}>All my assignments</option>
        {options.roles.map((role) => (
          <option key={role.value} value={role.value}>{role.label}</option>
        ))}
      </FilterSelect>
      <FilterSelect label="Project type" value={query.projectType} onChange={(value) => onNavigate({ type: value })}>
        <option value="">All types</option>
        {options.projectTypes.map((type) => (
          <option key={type.value} value={type.value}>{type.label}</option>
        ))}
      </FilterSelect>
      <FilterSelect label="Location" value={query.location} onChange={(value) => onNavigate({ location: value })}>
        <option value="">All locations</option>
        {options.locations.countries.length > 0 ? (
          <optgroup label="Countries">
            {options.locations.countries.map((place) => (
              <option key={place.value} value={place.value}>{place.label}</option>
            ))}
          </optgroup>
        ) : null}
        {options.locations.cities.length > 0 ? (
          <optgroup label="Cities">
            {options.locations.cities.map((place) => (
              <option key={place.value} value={place.value}>{place.label}</option>
            ))}
          </optgroup>
        ) : null}
      </FilterSelect>
    </>
  );

  const sort = (
    <FilterSelect label="Sort" value={query.sort === "recommended" ? undefined : query.sort} onChange={(value) => onNavigate({ sort: value })}>
      {SORTS.map((option) => (
        <option key={option.value} value={option.value === "recommended" ? "" : option.value}>{option.label}</option>
      ))}
    </FilterSelect>
  );

  return (
    <div className="space-y-3" data-testid="projects-toolbar">
      <SearchField
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Search projects…"
        aria-label="Search projects"
        className="md:max-w-md"
        maxLength={200}
      />

      <div className="-mx-1 overflow-x-auto px-1">
        <div role="group" aria-label="Show projects" className="flex min-w-max items-center gap-1.5">
          {QUICK_FILTERS.map((filter) => {
            const active = activeQuick === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onNavigate(
                    filter.key === "all"
                      ? { status: null, favorites: null }
                      : filter.key === "favorites"
                        ? { status: null, favorites: "1" }
                        : { status: filter.key, favorites: null },
                  )
                }
                className={cn(
                  "h-8 rounded-full border px-3.5 text-table font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary bg-primary text-primary-fg" : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="hidden flex-wrap items-end gap-2 md:flex">{filters}</div>

        <Button type="button" variant="secondary" size="sm" className="md:hidden" onClick={() => setSheetOpen(true)} data-testid="projects-filters-open">
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {advancedCount > 0 ? <span className="rounded-full bg-primary px-1.5 text-micro text-primary-fg">{advancedCount}</span> : null}
        </Button>

        <div className="ml-auto flex items-end gap-2">
          <div className="w-44">{sort}</div>
          <div role="group" aria-label="View" className="inline-flex h-9 items-center rounded-md border border-line bg-surface p-0.5">
            <ViewButton label="Gallery view" active={view === "gallery"} onClick={() => onViewChange("gallery")}>
              <LayoutGrid aria-hidden="true" className="size-4" />
            </ViewButton>
            <ViewButton label="List view" active={view === "list"} onClick={() => onViewChange("list")}>
              <List aria-hidden="true" className="size-4" />
            </ViewButton>
          </div>
        </div>
      </div>

      {filterCount > 0 ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate({ clear: true })} data-testid="projects-clear-filters">
            <X aria-hidden="true" />
            Clear filters
          </Button>
        </div>
      ) : null}

      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent side="bottom" className="p-5">
          <DrawerTitle className="text-card font-semibold text-fg">Filters</DrawerTitle>
          <DrawerDescription className="mt-1 text-table text-fg-muted">Narrow the projects you see.</DrawerDescription>
          <div className="mt-4 grid gap-3">{filters}</div>
          <div className="mt-5 flex gap-2">
            {advancedCount > 0 ? (
              <Button type="button" variant="secondary" className="flex-1" onClick={() => onNavigate({ company: null, role: null, type: null, location: null })}>
                Reset
              </Button>
            ) : null}
            <DrawerClose asChild>
              <Button type="button" className="flex-1">Show projects</Button>
            </DrawerClose>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | null) => void;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-micro font-medium text-fg-subtle">{label}</label>
      <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className={selectClass}>
        {children}
      </select>
    </div>
  );
}

function ViewButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-hover text-fg" : "text-fg-subtle hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
