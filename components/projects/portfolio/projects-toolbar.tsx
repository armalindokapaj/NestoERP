"use client";

import * as React from "react";
import { LayoutGrid, List, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
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

const STATUS_LABELS: Record<string, string> = { ACTIVE: "Active", PENDING: "Pending", FINISHED: "Finished" };

const selectClass =
  "h-9 w-full rounded-md border border-line bg-surface px-2.5 text-table text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20 md:w-auto md:min-w-[10.5rem]";

/** The four filters and the sort — what the desktop row and the phone sheet both edit. */
type FilterValues = { company?: string; role?: string; type?: string; location?: string; sort?: string };

function valuesOf(query: PortfolioQuery): FilterValues {
  return {
    company: query.companyId,
    role: query.role,
    type: query.projectType,
    location: query.location,
    sort: query.sort === "recommended" ? undefined : query.sort,
  };
}

/**
 * Search, quick filters, filters, sort and view (E-05A §25-§34, §38, §39).
 *
 * Every value lives in the URL, so a filtered page can be shared, refreshed and
 * returned to with Back. On a wide screen a filter applies as it is chosen. On
 * a phone the filters and the sort open in a bottom sheet that applies them
 * together, so the page does not reload behind the sheet at every choice. What
 * is active shows as chips, each removable on its own, with Clear filters
 * beside them only while there is something to clear.
 */
export function ProjectsToolbar({
  query,
  options,
  view,
  filterCount,
  matchingCount,
  onNavigate,
  onViewChange,
}: {
  query: PortfolioQuery;
  options: PortfolioFilterOptionsDTO;
  view: ProjectsView;
  /** Values that narrow the collection; a sort is not one of them. */
  filterCount: number;
  /** What the current search and filters match (E-05A §53). */
  matchingCount: number;
  onNavigate: (update: PortfolioUrlUpdate, mode?: "push" | "replace") => void;
  onViewChange: (view: ProjectsView) => void;
}) {
  const [text, setText] = React.useState(query.q ?? "");
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<FilterValues>(() => valuesOf(query));
  const lastSent = React.useRef(query.q ?? "");

  // A search cleared or changed from outside (Clear filters, a chip, Back) shows here.
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

  function openSheet() {
    setDraft(valuesOf(query));
    setSheetOpen(true);
  }

  function applySheet() {
    onNavigate({ company: draft.company ?? null, role: draft.role ?? null, type: draft.type ?? null, location: draft.location ?? null, sort: draft.sort ?? null });
    setSheetOpen(false);
  }

  const activeQuick = query.favorites ? "favorites" : (query.status ?? "all");
  const sheetCount = Object.values(valuesOf(query)).filter(Boolean).length;
  const chips = activeChips(query, options);

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
        <div className="hidden flex-wrap items-end gap-2 md:flex">
          <FilterFields
            values={valuesOf(query)}
            options={options}
            onChange={(key, value) => onNavigate({ [key]: value })}
          />
        </div>

        <Button type="button" variant="secondary" size="sm" className="md:hidden" onClick={openSheet} data-testid="projects-filters-open">
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {sheetCount > 0 ? <span className="rounded-full bg-primary px-1.5 text-micro text-primary-fg">{sheetCount}</span> : null}
        </Button>

        <div className="ml-auto flex items-end gap-2">
          <div className="w-40 sm:w-44">
            <SortSelect value={query.sort === "recommended" ? undefined : query.sort} onChange={(value) => onNavigate({ sort: value })} />
          </div>
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

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="projects-active-filters">
          {filterCount > 0 ? (
            <p className="mr-1 text-table font-medium text-fg" data-testid="projects-result-count">
              {matchingCount} {matchingCount === 1 ? "result" : "results"}
            </p>
          ) : null}
          <ul className="contents">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  onClick={() => onNavigate(chip.remove)}
                  aria-label={`Remove ${chip.label}: ${chip.value}`}
                  className="inline-flex h-7 max-w-[16rem] items-center gap-1 rounded-full border border-line bg-surface-muted pl-2.5 pr-1.5 text-meta text-fg transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="shrink-0 text-fg-subtle">{chip.label}:</span>
                  <span className="truncate font-medium">{chip.value}</span>
                  <X aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
                </button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate({ clear: true })} data-testid="projects-clear-filters">
            Clear filters
          </Button>
        </div>
      ) : null}

      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent side="bottom" className="p-5">
          <DrawerTitle className="text-card font-semibold text-fg">Filters</DrawerTitle>
          <DrawerDescription className="mt-1 text-table text-fg-muted">Narrow and order the projects you see.</DrawerDescription>
          <div className="mt-4 grid gap-3">
            <FilterFields values={draft} options={options} onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value ?? undefined }))} />
            <SortSelect value={draft.sort} onChange={(value) => setDraft((current) => ({ ...current, sort: value ?? undefined }))} />
          </div>
          <div className="mt-5 flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setDraft({})} disabled={Object.values(draft).every((value) => !value)}>
              Reset
            </Button>
            <Button type="button" className="flex-1" onClick={applySheet} data-testid="projects-filters-apply">
              Apply
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

type Chip = { key: string; label: string; value: string; remove: PortfolioUrlUpdate };

/** Each active value, named as the person chose it, with what removing it alone does (E-05A §32). */
function activeChips(query: PortfolioQuery, options: PortfolioFilterOptionsDTO): Chip[] {
  const chips: Chip[] = [];
  if (query.q) chips.push({ key: "q", label: "Search", value: `“${query.q}”`, remove: { q: null } });
  if (query.status) chips.push({ key: "status", label: "Status", value: STATUS_LABELS[query.status] ?? query.status, remove: { status: null } });
  if (query.favorites) chips.push({ key: "favorites", label: "Show", value: "Favorites", remove: { favorites: null } });
  if (query.companyId) {
    // A company id the person cannot see is never named — the list is already empty for it.
    const company = options.companies.find((candidate) => candidate.id === query.companyId);
    chips.push({ key: "company", label: "Company", value: company?.name ?? "Not available", remove: { company: null } });
  }
  if (query.role) chips.push({ key: "role", label: "My role", value: query.role === ASSIGNED_ROLE_VALUE ? "All my assignments" : query.role, remove: { role: null } });
  if (query.projectType) chips.push({ key: "type", label: "Type", value: query.projectType, remove: { type: null } });
  if (query.location) {
    const place = [...options.locations.cities, ...options.locations.countries].find((candidate) => candidate.value === query.location);
    chips.push({ key: "location", label: "Location", value: place?.label ?? query.location.slice(query.location.indexOf(":") + 1), remove: { location: null } });
  }
  if (query.sort !== "recommended") {
    chips.push({ key: "sort", label: "Sort", value: SORTS.find((sort) => sort.value === query.sort)?.label ?? query.sort, remove: { sort: null } });
  }
  return chips;
}

function FilterFields({
  values,
  options,
  onChange,
}: {
  values: FilterValues;
  options: PortfolioFilterOptionsDTO;
  onChange: (key: "company" | "role" | "type" | "location", value: string | null) => void;
}) {
  return (
    <>
      {options.companies.length > 1 ? (
        <FilterSelect label="Company" value={values.company} onChange={(value) => onChange("company", value)}>
          <option value="">All companies</option>
          {options.companies.map((company) => (
            <option key={company.id} value={company.id}>{company.name}</option>
          ))}
        </FilterSelect>
      ) : null}
      <FilterSelect label="My role" value={values.role} onChange={(value) => onChange("role", value)}>
        <option value="">Any role</option>
        <option value={ASSIGNED_ROLE_VALUE}>All my assignments</option>
        {options.roles.map((role) => (
          <option key={role.value} value={role.value}>{role.label}</option>
        ))}
      </FilterSelect>
      <FilterSelect label="Project type" value={values.type} onChange={(value) => onChange("type", value)}>
        <option value="">All types</option>
        {options.projectTypes.map((type) => (
          <option key={type.value} value={type.value}>{type.label}</option>
        ))}
      </FilterSelect>
      <FilterSelect label="Location" value={values.location} onChange={(value) => onChange("location", value)}>
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
}

function SortSelect({ value, onChange }: { value: string | undefined; onChange: (value: string | null) => void }) {
  return (
    <FilterSelect label="Sort" value={value} onChange={onChange}>
      {SORTS.map((option) => (
        <option key={option.value} value={option.value === "recommended" ? "" : option.value}>{option.label}</option>
      ))}
    </FilterSelect>
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
