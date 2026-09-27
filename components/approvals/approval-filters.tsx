"use client";

import * as React from "react";
import { X } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { compareDecimal, decimalRule, parseOptionalDecimal } from "@/lib/forms/decimal";
import {
  DUE_STATES,
  type ApprovalCompany,
  type ApprovalPriority,
  type ApprovalProviderSummary,
  type ApprovalTab,
  type DueState,
  type UnifiedApprovalStatus,
} from "@/lib/modules/approvals/approvals.types";
import { useApprovalsTranslations, useApprovalsWord } from "./approvals-text";

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
const STATUS_OPTIONS: UnifiedApprovalStatus[] = ["PENDING", "APPROVED", "REJECTED", "RETURNED", "CANCELLED"];
/** Money, as the queue filter reads it on the server: up to 15 whole digits and 2 decimals, not negative (approvals.schema). */
const AMOUNT_RULE = (label: string) => decimalRule("money", label, { maxIntegerDigits: 15 });

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
  const t = useApprovalsTranslations();
  const word = useApprovalsWord();
  const [draft, setDraft] = React.useState(filters);
  // The amounts as typed: read with the shared decimal rule on Apply, never
  // stripped of characters as they are typed (AUD-09 §4; AUD-04 §6, MW-09).
  const [amounts, setAmounts] = React.useState({ min: filters.amountMin ?? "", max: filters.amountMax ?? "" });
  const [amountError, setAmountError] = React.useState<{ field: "min" | "max"; message: string } | null>(null);
  const minRef = React.useRef<HTMLInputElement>(null);
  const maxRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!open) return;
    setDraft(filters);
    setAmounts({ min: filters.amountMin ?? "", max: filters.amountMax ?? "" });
    setAmountError(null);
  }, [open, filters]);

  /** The staged filters with the amounts read, or null when an amount is refused (and said why). */
  function readAmounts(): ApprovalFilters | null {
    const min = parseOptionalDecimal(amounts.min, AMOUNT_RULE(t("filters.minimumAmount")));
    const max = parseOptionalDecimal(amounts.max, AMOUNT_RULE(t("filters.maximumAmount")));
    const refuse = (field: "min" | "max", message: string) => {
      setAmountError({ field, message });
      (field === "min" ? minRef : maxRef).current?.focus();
      return null;
    };
    if (!min.ok) return refuse("min", min.message);
    if (!max.ok) return refuse("max", max.message);
    if (min.value !== null && max.value !== null && compareDecimal(min.value, max.value) > 0) {
      return refuse("max", t("filters.maxBelowMin"));
    }
    setAmountError(null);
    return { ...draft, amountMin: min.value, amountMax: max.value };
  }

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
            <DrawerTitle className="text-card font-semibold text-fg">{t("filters.title")}</DrawerTitle>
            <DrawerDescription className="text-meta text-fg-muted">{t("filters.description")}</DrawerDescription>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label={t("filters.close")}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const next = readAmounts();
            if (!next) return;
            onApply(next);
            onOpenChange(false);
          }}
        >
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            {companies && companies.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="filter-company">{t("filters.company")}</Label>
                <select id="filter-company" className={selectClass} value={draft.company ?? ""} onChange={(event) => setDraft({ ...draft, company: event.target.value || null })}>
                  <option value="">{t("filters.allCompanies")}</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {providers.length > 1 ? (
              <Group legend={t("filters.module")}>
                {providers.map((provider) => (
                  <CheckRow key={provider.key} label={word(provider.label)} checked={draft.provider.includes(provider.key)} onChange={() => toggle("provider", provider.key)} />
                ))}
              </Group>
            ) : null}
            {showStatus ? (
              <Group legend={t("filters.status")}>
                {STATUS_OPTIONS.map((status) => (
                  <CheckRow key={status} label={t(`status.${status}`)} checked={draft.status.includes(status)} onChange={() => toggle("status", status)} />
                ))}
              </Group>
            ) : null}
            <Group legend={t("filters.priority")}>
              {PRIORITIES.map((priority) => (
                <CheckRow key={priority} label={t(`priority.${priority}`)} checked={draft.priority.includes(priority)} onChange={() => toggle("priority", priority)} />
              ))}
            </Group>
            {tab === "waiting" || tab === "requested" || tab === "history" ? (
              <Group legend={t("filters.due")}>
                {DUE_STATES.map((state) => (
                  <CheckRow key={state} label={t(`due.${state}`)} checked={draft.dueState.includes(state)} onChange={() => toggle("dueState", state)} />
                ))}
              </Group>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="filter-project">{t("filters.project")}</Label>
              <select id="filter-project" className={selectClass} value={draft.projectId ?? ""} onChange={(event) => setDraft({ ...draft, projectId: event.target.value || null })}>
                <option value="">{t("filters.anyProject")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.label}
                  </option>
                ))}
              </select>
            </div>
            {tab !== "requested" ? (
              <div className="space-y-1.5">
                <Label htmlFor="filter-requester">{t("filters.requester")}</Label>
                <select id="filter-requester" className={selectClass} value={draft.requesterId ?? ""} onChange={(event) => setDraft({ ...draft, requesterId: event.target.value || null })}>
                  <option value="">{t("filters.anyone")}</option>
                  {requesters.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <fieldset className="space-y-1.5">
              <legend className="text-table font-medium text-fg">{tab === "approved" || tab === "rejected" || tab === "returned" ? t("filters.decidedBetween") : t("filters.requestedBetween")}</legend>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" aria-label={t("filters.from")} value={draft.from ?? ""} onChange={(event) => setDraft({ ...draft, from: event.target.value || null })} />
                <Input type="date" aria-label={t("filters.to")} value={draft.to ?? ""} onChange={(event) => setDraft({ ...draft, to: event.target.value || null })} />
              </div>
            </fieldset>
            <fieldset className="space-y-1.5">
              <legend className="text-table font-medium text-fg">{t("filters.amount")}</legend>
              <p id="filter-amount-hint" className="text-meta text-fg-subtle">{t("filters.amountHint")}</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  ref={minRef}
                  inputMode="decimal"
                  aria-label={t("filters.minimumAmount")}
                  placeholder={t("filters.min")}
                  value={amounts.min}
                  aria-invalid={amountError?.field === "min" || undefined}
                  aria-describedby={amountError?.field === "min" ? "filter-amount-error" : "filter-amount-hint"}
                  onChange={(event) => {
                    setAmounts({ ...amounts, min: event.target.value });
                    setAmountError(null);
                  }}
                />
                <Input
                  ref={maxRef}
                  inputMode="decimal"
                  aria-label={t("filters.maximumAmount")}
                  placeholder={t("filters.max")}
                  value={amounts.max}
                  aria-invalid={amountError?.field === "max" || undefined}
                  aria-describedby={amountError?.field === "max" ? "filter-amount-error" : "filter-amount-hint"}
                  onChange={(event) => {
                    setAmounts({ ...amounts, max: event.target.value });
                    setAmountError(null);
                  }}
                />
              </div>
              {amountError ? (
                <p id="filter-amount-error" role="alert" className="text-meta font-medium text-danger-strong" data-testid="filter-amount-error">
                  {amountError.message}
                </p>
              ) : null}
            </fieldset>
          </div>
          <div className="flex gap-2 border-t border-line px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                setAmounts({ min: "", max: "" });
                setAmountError(null);
              }}
            >
              {t("filters.reset")}
            </Button>
            <Button type="submit" className="ml-auto">
              {t("filters.showResults")}
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
    // The label fills the row, so the whole row is the target on a touch screen (AUD-04 §3, MW-19).
    <div className="flex items-center gap-2 touch:min-h-11">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="flex min-w-0 flex-1 items-center self-stretch text-table text-fg">
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
  const t = useApprovalsTranslations();
  const word = useApprovalsWord();
  const chips: Array<{ key: string; label: string; clear: () => ApprovalFilters }> = [];
  if (filters.company) chips.push({ key: "company", label: companies?.find((company) => company.id === filters.company)?.name ?? t("filters.company"), clear: () => ({ ...filters, company: null }) });
  for (const key of filters.provider) chips.push({ key: `provider:${key}`, label: word(providers.find((provider) => provider.key === key)?.label ?? key), clear: () => ({ ...filters, provider: filters.provider.filter((entry) => entry !== key) }) });
  for (const status of filters.status) chips.push({ key: `status:${status}`, label: t(`status.${status}`), clear: () => ({ ...filters, status: filters.status.filter((entry) => entry !== status) }) });
  for (const priority of filters.priority) chips.push({ key: `priority:${priority}`, label: t("filters.chipPriority", { priority: t(`priority.${priority}`) }), clear: () => ({ ...filters, priority: filters.priority.filter((entry) => entry !== priority) }) });
  for (const state of filters.dueState) chips.push({ key: `due:${state}`, label: t(`due.${state}`), clear: () => ({ ...filters, dueState: filters.dueState.filter((entry) => entry !== state) }) });
  if (filters.projectId) chips.push({ key: "project", label: projects.find((project) => project.id === filters.projectId)?.label ?? t("filters.project"), clear: () => ({ ...filters, projectId: null }) });
  if (filters.requesterId) chips.push({ key: "requester", label: t("filters.chipBy", { name: requesters.find((person) => person.id === filters.requesterId)?.label ?? t("filters.chipRequester") }), clear: () => ({ ...filters, requesterId: null }) });
  if (filters.from || filters.to) chips.push({ key: "dates", label: `${filters.from ?? "…"} – ${filters.to ?? "…"}`, clear: () => ({ ...filters, from: null, to: null }) });
  if (filters.amountMin || filters.amountMax) chips.push({ key: "amount", label: t("filters.chipAmount", { min: filters.amountMin ?? "0", max: filters.amountMax ?? "∞" }), clear: () => ({ ...filters, amountMin: null, amountMax: null }) });
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 touch:gap-2" role="group" aria-label={t("filters.active")}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onChange(chip.clear())}
          // 44px tall on a touch screen, like every chip (AUD-04 §3, MW-06).
          className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-line bg-surface pl-2.5 pr-1.5 text-meta font-medium text-fg transition-colors hover:border-line-strong touch:h-11 touch:pl-3.5 touch:pr-2.5"
          aria-label={t("filters.remove", { label: chip.label })}
        >
          <span className="min-w-0 truncate">{chip.label}</span>
          <X aria-hidden="true" className="size-3 shrink-0 text-fg-subtle" />
        </button>
      ))}
      <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="ml-1 text-meta font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline touch:min-h-11 touch:px-2">
        {t("filters.clearAll")}
      </button>
    </div>
  );
}
