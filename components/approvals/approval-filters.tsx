"use client";

import * as React from "react";
import { X } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DUE_STATE_LABELS,
  DUE_STATES,
  STATUS_LABELS,
  type ApprovalCompany,
  type ApprovalPriority,
  type ApprovalProviderSummary,
  type ApprovalTab,
  type DueState,
  type UnifiedApprovalStatus,
} from "@/lib/modules/approvals/approvals.types";

/**
 * Filters and their chips (PRD #41 §92, §93).
 *
 * Only filters that mean something on the current tab appear: status is the
 * tab itself on Approved, Rejected and Returned. Project and requester choices
 * are the ones present in what this reader can already see — a filter list is
 * never a directory of things they cannot open. In the Group workspace, and only
 * there, Company is a filter too, chosen among the companies they may read (§87).
 */

export type ApprovalFilters = {
  provider: string[];
  status: UnifiedApprovalStatus[];
  priority: ApprovalPriority[];
  dueState: DueState[];
  projectId: string | null;
  requesterId: string | null;
  /** Group workspace only. */
  company: string | null;
  from: string | null;
  to: string | null;
  amountMin: string | null;
  amountMax: string | null;
};

export const EMPTY_FILTERS: ApprovalFilters = {
  provider: [],
  status: [],
  priority: [],
  dueState: [],
  projectId: null,
  requesterId: null,
  company: null,
  from: null,
  to: null,
  amountMin: null,
  amountMax: null,
};

const PRIORITIES: ApprovalPriority[] = ["CRITICAL", "HIGH", "NORMAL", "LOW"];
const PRIORITY_LABELS: Record<ApprovalPriority, string> = { CRITICAL: "Critical", HIGH: "High", NORMAL: "Normal", LOW: "Low" };
const STATUS_OPTIONS: UnifiedApprovalStatus[] = ["PENDING", "APPROVED", "REJECTED", "RETURNED", "CANCELLED"];

export function activeFilterCount(filters: ApprovalFilters): number {
  return (
    filters.provider.length +
    filters.status.length +
    filters.priority.length +
    filters.dueState.length +
    (filters.projectId ? 1 : 0) +
    (filters.requesterId ? 1 : 0) +
    (filters.company ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0) +
    (filters.amountMin || filters.amountMax ? 1 : 0)
  );
}

type Option = { id: string; label: string };

export function FilterDrawer({
  open,
  onOpenChange,
  tab,
  filters,
  providers,
  projects,
  requesters,
  companies,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: ApprovalTab;
  filters: ApprovalFilters;
  providers: ApprovalProviderSummary[];
  projects: Option[];
  requesters: Option[];
  /** Present only in the Group workspace: the companies whose approvals this person may read. */
  companies?: ApprovalCompany[];
  onApply: (filters: ApprovalFilters) => void;
}) {
  const [draft, setDraft] = React.useState(filters);
  React.useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const toggle = <K extends "provider" | "status" | "priority" | "dueState">(key: K, value: ApprovalFilters[K][number]) => {
    setDraft((current) => {
      const list = current[key] as string[];
      return { ...current, [key]: list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value] };
    });
  };
  const showStatus = tab === "requested" || tab === "history";

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="bg-surface sm:max-w-[400px]" data-testid="approval-filters">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <DrawerTitle className="text-card font-semibold text-fg">Filter approvals</DrawerTitle>
            <DrawerDescription className="text-meta text-fg-muted">Narrow the list; the counts above stay yours.</DrawerDescription>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label="Close filters">
            <X aria-hidden="true" />
          </Button>
        </div>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onApply(draft);
            onOpenChange(false);
          }}
        >
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            {companies && companies.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="filter-company">Company</Label>
                <select id="filter-company" className={selectClass} value={draft.company ?? ""} onChange={(event) => setDraft({ ...draft, company: event.target.value || null })}>
                  <option value="">All companies</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {providers.length > 1 ? (
              <Group legend="Module">
                {providers.map((provider) => (
                  <CheckRow key={provider.key} label={provider.label} checked={draft.provider.includes(provider.key)} onChange={() => toggle("provider", provider.key)} />
                ))}
              </Group>
            ) : null}
            {showStatus ? (
              <Group legend="Status">
                {STATUS_OPTIONS.map((status) => (
                  <CheckRow key={status} label={STATUS_LABELS[status]} checked={draft.status.includes(status)} onChange={() => toggle("status", status)} />
                ))}
              </Group>
            ) : null}
            <Group legend="Priority">
              {PRIORITIES.map((priority) => (
                <CheckRow key={priority} label={PRIORITY_LABELS[priority]} checked={draft.priority.includes(priority)} onChange={() => toggle("priority", priority)} />
              ))}
            </Group>
            {tab === "waiting" || tab === "requested" || tab === "history" ? (
              <Group legend="Due">
                {DUE_STATES.map((state) => (
                  <CheckRow key={state} label={DUE_STATE_LABELS[state]} checked={draft.dueState.includes(state)} onChange={() => toggle("dueState", state)} />
                ))}
              </Group>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="filter-project">Project</Label>
              <select id="filter-project" className={selectClass} value={draft.projectId ?? ""} onChange={(event) => setDraft({ ...draft, projectId: event.target.value || null })}>
                <option value="">Any project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.label}
                  </option>
                ))}
              </select>
            </div>
            {tab !== "requested" ? (
              <div className="space-y-1.5">
                <Label htmlFor="filter-requester">Requester</Label>
                <select id="filter-requester" className={selectClass} value={draft.requesterId ?? ""} onChange={(event) => setDraft({ ...draft, requesterId: event.target.value || null })}>
                  <option value="">Anyone</option>
                  {requesters.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <fieldset className="space-y-1.5">
              <legend className="text-table font-medium text-fg">{tab === "approved" || tab === "rejected" || tab === "returned" ? "Decided between" : "Requested between"}</legend>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" aria-label="From" value={draft.from ?? ""} onChange={(event) => setDraft({ ...draft, from: event.target.value || null })} />
                <Input type="date" aria-label="To" value={draft.to ?? ""} onChange={(event) => setDraft({ ...draft, to: event.target.value || null })} />
              </div>
            </fieldset>
            <fieldset className="space-y-1.5">
              <legend className="text-table font-medium text-fg">Amount</legend>
              <p className="text-meta text-fg-subtle">In each record&apos;s own currency. Records without an amount drop out.</p>
              <div className="grid grid-cols-2 gap-2">
                <Input inputMode="decimal" aria-label="Minimum amount" placeholder="Min" value={draft.amountMin ?? ""} onChange={(event) => setDraft({ ...draft, amountMin: event.target.value.replace(/[^\d.]/g, "") || null })} />
                <Input inputMode="decimal" aria-label="Maximum amount" placeholder="Max" value={draft.amountMax ?? ""} onChange={(event) => setDraft({ ...draft, amountMax: event.target.value.replace(/[^\d.]/g, "") || null })} />
              </div>
            </fieldset>
          </div>
          <div className="flex gap-2 border-t border-line px-5 py-3">
            <Button type="button" variant="ghost" onClick={() => setDraft(EMPTY_FILTERS)}>
              Reset
            </Button>
            <Button type="submit" className="ml-auto">
              Show results
            </Button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function Group({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-table font-medium text-fg">{legend}</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">{children}</div>
    </fieldset>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  const id = React.useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="text-table text-fg">
        {label}
      </label>
    </div>
  );
}

export function FilterChips({
  filters,
  providers,
  projects,
  requesters,
  companies,
  onChange,
}: {
  filters: ApprovalFilters;
  providers: ApprovalProviderSummary[];
  projects: Option[];
  requesters: Option[];
  companies?: ApprovalCompany[];
  onChange: (filters: ApprovalFilters) => void;
}) {
  const chips: Array<{ key: string; label: string; clear: () => ApprovalFilters }> = [];
  if (filters.company) chips.push({ key: "company", label: companies?.find((company) => company.id === filters.company)?.name ?? "Company", clear: () => ({ ...filters, company: null }) });
  for (const key of filters.provider) chips.push({ key: `provider:${key}`, label: providers.find((provider) => provider.key === key)?.label ?? key, clear: () => ({ ...filters, provider: filters.provider.filter((entry) => entry !== key) }) });
  for (const status of filters.status) chips.push({ key: `status:${status}`, label: STATUS_LABELS[status], clear: () => ({ ...filters, status: filters.status.filter((entry) => entry !== status) }) });
  for (const priority of filters.priority) chips.push({ key: `priority:${priority}`, label: `${PRIORITY_LABELS[priority]} priority`, clear: () => ({ ...filters, priority: filters.priority.filter((entry) => entry !== priority) }) });
  for (const state of filters.dueState) chips.push({ key: `due:${state}`, label: DUE_STATE_LABELS[state], clear: () => ({ ...filters, dueState: filters.dueState.filter((entry) => entry !== state) }) });
  if (filters.projectId) chips.push({ key: "project", label: projects.find((project) => project.id === filters.projectId)?.label ?? "Project", clear: () => ({ ...filters, projectId: null }) });
  if (filters.requesterId) chips.push({ key: "requester", label: `By ${requesters.find((person) => person.id === filters.requesterId)?.label ?? "requester"}`, clear: () => ({ ...filters, requesterId: null }) });
  if (filters.from || filters.to) chips.push({ key: "dates", label: `${filters.from ?? "…"} – ${filters.to ?? "…"}`, clear: () => ({ ...filters, from: null, to: null }) });
  if (filters.amountMin || filters.amountMax) chips.push({ key: "amount", label: `Amount ${filters.amountMin ?? "0"}–${filters.amountMax ?? "∞"}`, clear: () => ({ ...filters, amountMin: null, amountMax: null }) });
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onChange(chip.clear())}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface pl-2.5 pr-1.5 text-meta font-medium text-fg transition-colors hover:border-line-strong"
          aria-label={`Remove filter ${chip.label}`}
        >
          {chip.label}
          <X aria-hidden="true" className="size-3 text-fg-subtle" />
        </button>
      ))}
      <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="ml-1 text-meta font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline">
        Clear all
      </button>
    </div>
  );
}
