"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { Inbox, ListFilter, Rows3, Rows4, SlidersHorizontal, TriangleAlert, UserRoundCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WhatIsThis } from "@/components/help/what-is-this";
import { SearchField } from "@/components/ui/search-field";
import { useToast } from "@/components/ui/toast";
import { GuardedRoot } from "@/components/unsaved/guarded-root";
import { UnsavedScope } from "@/components/unsaved/use-unsaved";
import { useMediaQuery } from "@/components/ui/use-breakpoint";
import { unsaved } from "@/lib/unsaved/coordinator";
import type {
  ApprovalDecision,
  ApprovalDecisionResult,
  ApprovalQueueResult,
  ApprovalSort,
  ApprovalTab,
  UnifiedApprovalDetail,
  UnifiedApprovalItem,
} from "@/lib/modules/approvals/approvals.types";
import { cn } from "@/lib/utils/cn";
import { ApprovalDetailView } from "./approval-detail";
import { ApprovalDraftProvider } from "./approval-drafts";
import { activeFilterCount, EMPTY_FILTERS, FilterChips, FilterDrawer, type ApprovalFilters } from "./approval-filters";
import { ApprovalList, ListSkeleton, type Density } from "./approval-list";
import { approvalsApi, failureMessage, isFailure, newIdempotencyKey } from "./approvals-api";
import { DelegationDialog } from "./delegation-dialog";
import { HelpEntry } from "@/components/help/help-entry";

/**
 * The Approvals Center (PRD #41 §6, §7, §74-§102, §197-§205).
 *
 * A quiet decision workspace: the queue on the left, the review on the right,
 * and on a phone the review as a full-screen sheet with the decision bar under
 * the thumb. Everything that shapes the list lives in the URL, so a filtered
 * queue or an open review is a link. The list and the review are read from
 * the server every time they matter — nothing is shown as decided until the
 * server says so.
 *
 * In the Group workspace (`group`) the Center is a read view across the
 * companies the person works in (Workspace Context §33, §45): the header says
 * how many wait in each, every row names its company and opens inside it, and
 * the review, the decision and the delegation are not offered — they belong to
 * one company's workspace.
 */

const TABS: Array<{ key: ApprovalTab; label: string }> = [
  { key: "waiting", label: "Waiting for me" },
  { key: "requested", label: "Requested by me" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "returned", label: "Returned" },
  { key: "history", label: "All history" },
];

const SORTS: Array<{ key: ApprovalSort; label: string }> = [
  { key: "urgency", label: "Most urgent" },
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "due", label: "Due date" },
  { key: "amount", label: "Amount" },
];

const DEFAULT_SORT: Record<ApprovalTab, ApprovalSort> = { waiting: "urgency", requested: "newest", approved: "newest", rejected: "newest", returned: "newest", history: "newest" };

const EMPTY: Record<ApprovalTab, { title: string; body: string }> = {
  waiting: { title: "You’re all caught up.", body: "No approvals require your decision." },
  requested: { title: "No approval requests yet.", body: "What you submit for approval, anywhere in NESTO, is tracked here." },
  approved: { title: "Nothing approved yet.", body: "Approvals you give appear here." },
  rejected: { title: "Nothing rejected.", body: "Requests you reject appear here, with your reason." },
  returned: { title: "Nothing returned.", body: "Requests returned for revision, by you or to you, appear here." },
  history: { title: "No approvals match.", body: "Try a wider date range or fewer filters." },
};

export type ApprovalsState = {
  tab: ApprovalTab;
  q: string;
  sort: ApprovalSort;
  filters: ApprovalFilters;
  returned: "by" | "to" | "all";
};

function toParams(state: ApprovalsState, extra: { approval?: string | null; panel?: string | null; cursor?: string | null; limit?: number } = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (state.tab !== "waiting") params.set("tab", state.tab);
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.sort !== DEFAULT_SORT[state.tab]) params.set("sort", state.sort);
  if (state.tab === "returned" && state.returned !== "all") params.set("returned", state.returned);
  const { filters } = state;
  for (const value of filters.provider) params.append("provider", value);
  for (const value of filters.status) params.append("status", value);
  for (const value of filters.priority) params.append("priority", value);
  for (const value of filters.dueState) params.append("dueState", value);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.requesterId) params.set("requesterId", filters.requesterId);
  if (filters.company) params.set("company", filters.company);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.amountMin) params.set("amountMin", filters.amountMin);
  if (filters.amountMax) params.set("amountMax", filters.amountMax);
  if (extra.cursor) params.set("cursor", extra.cursor);
  if (extra.limit) params.set("limit", String(extra.limit));
  if (extra.approval) params.set("approval", extra.approval);
  if (extra.panel) params.set("panel", extra.panel);
  return params;
}

/** The editors of the approval under review — its decision note, a reason, its discussion. */
const DETAIL_SCOPE = "approval-detail";

export function ApprovalsShell({
  initialState,
  initial,
  initialSelection,
  initialDetail,
  initialDetailError,
  openDelegation,
  group = false,
}: {
  initialState: ApprovalsState;
  initial: ApprovalQueueResult;
  initialSelection: string | null;
  initialDetail: UnifiedApprovalDetail | null;
  initialDetailError: string | null;
  openDelegation: boolean;
  /** The Group workspace: a read view, company by company. */
  group?: boolean;
}) {
  // The URL only mirrors this page's own state — tab, filters, the selected
  // approval — and never unmounts it: Next's router, not the guarded one, or a
  // filter change would ask about a note it keeps (AUD-03 §5). A change that
  // does destroy the review in place asks first, below.
  const router = useRouter();
  const toast = useToast();
  // The review is a side panel from 1024px and a full-screen sheet below it.
  // `undefined` until the browser has answered: neither is drawn then, so a
  // desktop link no longer flashes the sheet first (AUD-04 SP-15, D-08-03).
  const desktop = useMediaQuery("(min-width: 1024px)");
  // What is typed into the review, kept while it moves between the panel and
  // the sheet on a rotation (AUD-04 MW-16); forgotten with the selection.
  const drafts = React.useRef(new Map<string, unknown>()).current;
  // A second tap lands before the disabled bar renders: dropped, never sent (MW-15).
  const deciding = React.useRef(false);

  const [state, setState] = React.useState(initialState);
  const [data, setData] = React.useState(initial);
  const [items, setItems] = React.useState(initial.items);
  const [cursor, setCursor] = React.useState(initial.nextCursor);
  const [listLoading, setListLoading] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const [selectedId, setSelectedId] = React.useState<string | null>(initialSelection);
  const [detail, setDetail] = React.useState<UnifiedApprovalDetail | null>(initialDetail);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailFailure, setDetailFailure] = React.useState<{ message: string; stale: boolean } | null>(initialDetailError ? { message: initialDetailError, stale: false } : null);
  const [pending, setPending] = React.useState<ApprovalDecision | null>(null);
  const attemptKey = React.useRef<string | null>(null);

  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [delegationOpen, setDelegationOpen] = React.useState(openDelegation && !group);
  const [density, setDensity] = React.useState<Density>("comfortable");
  const [search, setSearch] = React.useState(initialState.q);

  // Options for project and requester filters, gathered from what this reader has seen.
  const seen = React.useRef({ projects: new Map<string, string>(), requesters: new Map<string, string>() });
  for (const item of items) {
    // In the Group workspace the same name can be a project or a person in two companies.
    const where = group && item.company ? ` · ${item.company.name}` : "";
    if (item.project) seen.current.projects.set(item.project.id, `${item.project.code ? `${item.project.code} · ${item.project.name}` : item.project.name}${where}`);
    seen.current.requesters.set(item.requester.memberId, `${item.requester.name}${where}`);
  }
  const projectOptions = [...seen.current.projects.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  const requesterOptions = [...seen.current.requesters.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem("nesto.approvals.density");
      if (stored === "compact" || stored === "comfortable") setDensity(stored);
    } catch {
      // Density is a preference, not a requirement.
    }
  }, []);

  const syncUrl = React.useCallback(
    (next: ApprovalsState, approval: string | null, panel: string | null) => {
      const params = toParams(next, { approval, panel });
      router.replace(params.size ? `/approvals?${params}` : "/approvals", { scroll: false });
    },
    [router],
  );

  const loadList = React.useCallback(async (next: ApprovalsState) => {
    setListLoading(true);
    setListError(null);
    try {
      const result = await approvalsApi<ApprovalQueueResult>(`/api/approvals?${toParams(next)}`);
      setData(result);
      setItems(result.items);
      setCursor(result.nextCursor);
      return result;
    } catch (failure) {
      setListError(failureMessage(failure, "Approvals could not be loaded."));
      return null;
    } finally {
      setListLoading(false);
    }
  }, []);

  /*
   * Another tab — or the module's own page — may have decided something here.
   * Coming back to this tab re-reads the list and its counts, so they converge on
   * the committed state without a real-time channel (AUD-10 §4, CW-20). Never
   * while a decision is in flight, and not more than every few seconds; the
   * review itself is left alone so a note being written is not replaced.
   */
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const pendingRef = React.useRef(pending);
  pendingRef.current = pending;
  React.useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || pendingRef.current || Date.now() - last < 5_000) return;
      last = Date.now();
      void loadList(stateRef.current);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadList]);

  const loadDetail = React.useCallback(async (id: string) => {
    const [providerKey, approvalId] = id.split(":");
    setDetailLoading(true);
    try {
      const result = await approvalsApi<UnifiedApprovalDetail>(`/api/approvals/${providerKey}/${approvalId}`);
      setDetail(result);
      setDetailFailure(null);
      return result;
    } catch (failure) {
      setDetail(null);
      setDetailFailure({ message: failureMessage(failure, "This approval could not be opened."), stale: false });
      return null;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function update(patch: Partial<ApprovalsState>) {
    const next = { ...state, ...patch };
    if (patch.tab && patch.tab !== state.tab) {
      next.sort = DEFAULT_SORT[patch.tab];
      next.filters = { ...next.filters, status: [] };
    }
    setState(next);
    syncUrl(next, selectedId, delegationOpen ? "delegation" : null);
    void loadList(next);
  }

  // Search waits for a pause in typing.
  React.useEffect(() => {
    if (search === state.q) return;
    const handle = window.setTimeout(() => update({ q: search }), 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  /**
   * Another approval, or none, replaces the one under review: its note, a
   * reason being written, a comment in its discussion go with it. Asks about
   * those first (AUD-03 §5); a selection that follows a recorded decision
   * does not, the input was used.
   */
  function select(item: UnifiedApprovalItem | null) {
    if ((item?.id ?? null) === selectedId) {
      applySelect(item);
      return;
    }
    const intent = { kind: "dismiss", scope: DETAIL_SCOPE } as const;
    if (!unsaved.hasBlocking(intent)) {
      applySelect(item);
      return;
    }
    void unsaved.requestDeparture(intent).then((approval) => {
      // The page stays: the approval covers this change and nothing after it.
      if (approval?.run(() => applySelect(item))) approval.release();
    });
  }

  function applySelect(item: UnifiedApprovalItem | null) {
    const id = item?.id ?? null;
    if (id !== selectedId) drafts.clear();
    setSelectedId(id);
    setDetailFailure(null);
    attemptKey.current = null;
    if (!id) setDetail(null);
    else if (detail?.item.id !== id) {
      setDetail(null);
      void loadDetail(id);
    }
    syncUrl(state, id, delegationOpen ? "delegation" : null);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const params = toParams(state, { cursor });
      const result = await approvalsApi<ApprovalQueueResult>(`/api/approvals?${params}`);
      setItems((current) => [...current, ...result.items.filter((item) => !current.some((row) => row.id === item.id))]);
      setCursor(result.nextCursor);
    } catch (failure) {
      toast({ title: failureMessage(failure, "More approvals could not be loaded."), tone: "danger" });
    } finally {
      setLoadingMore(false);
    }
  }

  async function decide(decision: ApprovalDecision, note: string | null): Promise<boolean> {
    if (!detail || pending || deciding.current) return false;
    deciding.current = true;
    const item = detail.item;
    const path = decision === "APPROVE" ? "approve" : decision === "REJECT" ? "reject" : "return";
    attemptKey.current ??= newIdempotencyKey();
    setPending(decision);
    setDetailFailure(null);
    try {
      const result = await approvalsApi<ApprovalDecisionResult>(`/api/approvals/${item.providerKey}/${item.approvalId}/${path}`, {
        body: { note: note ?? undefined, expectedVersion: item.version },
        idempotencyKey: attemptKey.current,
      });
      attemptKey.current = null;
      const next = result.item;
      toast({
        title:
          result.outcome === "STEP_APPROVED"
            ? next?.stepLabel
              ? `Step approved — now with ${next.stepLabel}`
              : "Step approved"
            : result.outcome === "APPROVED"
              ? `${item.sourceLabel} approved`
              : result.outcome === "REJECTED"
                ? `${item.sourceLabel} rejected`
                : `${item.sourceLabel} returned for revision`,
        description: result.alreadyApplied ? "It had already been recorded." : `${item.requester.name} is told.`,
        tone: "success",
      });
      const index = items.findIndex((row) => row.id === item.id);
      const refreshed = await loadList(state);
      if (state.tab === "waiting") {
        const remaining = refreshed?.items ?? [];
        const following = remaining.find((row, position) => position >= index && row.id !== item.id) ?? remaining.find((row) => row.id !== item.id) ?? null;
        if (desktop && following) applySelect(following);
        else {
          applySelect(null);
        }
      } else {
        void loadDetail(item.id);
      }
      return true;
    } catch (failure) {
      const network = isFailure(failure) && failure.code === "NETWORK";
      if (!network) attemptKey.current = null;
      const code = isFailure(failure) ? failure.detailCode : undefined;
      const stale = code === "APPROVAL_ALREADY_DECIDED" || code === "APPROVAL_SOURCE_CHANGED";
      setDetailFailure({ message: failureMessage(failure, "The decision could not be recorded."), stale });
      toast({ title: failureMessage(failure, "The decision could not be recorded."), tone: "danger" });
      return false;
    } finally {
      deciding.current = false;
      setPending(null);
    }
  }

  const counts = data.counts;
  // "ARLIS 7 · IDEAL 4": only the companies where something waits, or whose figure is incomplete (§33, AUD-10 §4).
  const byCompany = (counts.byCompany ?? []).filter((row) => row.waiting > 0 || row.partial);
  // Every source missing from what is shown — from the list read or from the header's —
  // named once; with any of them the total is incomplete, never "all caught up" (AUD-10 §4, CW-03).
  const unavailable = [...data.failedProviders, ...(counts.unavailable ?? [])].filter(
    (source, index, all) => all.findIndex((other) => other.key === source.key && other.company?.id === source.company?.id) === index,
  );
  const partial = Boolean(counts.partial) || unavailable.length > 0;
  const unavailableNames = unavailable.map((provider) => (provider.company ? `${provider.label} (${provider.company.name})` : provider.label)).join(", ");
  const waitingText = partial ? (counts.waiting > 0 ? `${counts.waiting}+` : "?") : `${counts.waiting}${counts.capped ? "+" : ""}`;
  const filterCount = activeFilterCount(state.filters);
  const visibleTabs = TABS.filter((tab) => tab.key !== "history" || data.canViewHistory);
  const empty =
    group && data.companies?.length === 0
      ? { title: "No accessible data for this module.", body: "None of your companies offers approvals to you." }
      : partial
        ? { title: "Nothing to show from the sources that loaded.", body: `${unavailableNames} could not be loaded, so there may be approvals this list cannot show yet.` }
        : EMPTY[state.tab];
  const sheetOpen = !group && desktop === false && selectedId !== null;

  return (
    <ApprovalDraftProvider store={drafts}>
    <div className="flex flex-col gap-5" data-testid="approvals-center">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-fg-subtle">Approvals</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg md:text-[30px]" data-testid="approvals-heading" aria-live="polite">
            {partial
              ? counts.waiting > 0
                ? `At least ${counts.waiting} waiting for you`
                : "Some approvals could not be loaded"
              : counts.waiting === 0
                ? "You’re all caught up"
                : `${counts.waiting}${counts.capped ? "+" : ""} waiting for you`}
          </h1>
          <p className="mt-1 flex flex-wrap gap-x-3 text-table text-fg-muted">
            {counts.overdue > 0 ? <span className="font-medium text-danger-strong">{counts.overdue} overdue</span> : null}
            {counts.critical > 0 ? <span className="font-medium text-warning-strong">{counts.critical} critical</span> : null}
            {partial ? (
              <span className="font-medium text-warning-strong" data-testid="approvals-incomplete">
                The total is incomplete: {unavailableNames} could not be loaded.
              </span>
            ) : counts.overdue === 0 && counts.critical === 0 ? (
              <span>{group ? "Every decision waiting in the companies you work in, in one place." : "Every decision from every module you work in, in one place."}</span>
            ) : null}
          </p>
          {group && byCompany.length > 0 ? (
            <p className="mt-1 text-table text-fg-muted" data-testid="approvals-by-company">
              {byCompany.map((row) => `${row.company.name} ${row.partial ? (row.waiting > 0 ? `${row.waiting}+` : "?") : `${row.waiting}${row.capped ? "+" : ""}`}`).join(" · ")}
            </p>
          ) : null}
          {/* The queue is the high-confusion point of first use (AUD-05 §7, UX-15). */}
          <WhatIsThis id="approvals.queue" title="The approvals queue" className="mt-2">
            <p>
              {group
                ? "Decisions waiting for you in each company you work in. Open one in its company to decide it; the Group view only counts and lists them."
                : "Every request that needs your decision, from every module you work in. “Waiting for me” is yours to decide now; the other tabs show what you asked for and what was already decided."}
            </p>
            <p>The decision buttons on an approval are the action: Approve, Reject or Return for revision. You never see them on a request you submitted yourself.</p>
          </WhatIsThis>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {group ? null : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setDelegationOpen(true);
                syncUrl(state, selectedId, "delegation");
              }}
            >
              <UserRoundCog aria-hidden="true" />
              Delegation
            </Button>
          )}
          <HelpEntry moduleKey="approvals" moduleLabel="Approvals" />
        </div>
      </header>

      <div role="tablist" aria-label="Approval views" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {visibleTabs.map((tab) => {
          const active = tab.key === state.tab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="approvals-panel"
              onClick={() => {
                if (active) return;
                if (selectedId === null) {
                  update({ tab: tab.key });
                  return;
                }
                // Leaving the tab closes the review: asked about first, like any selection.
                const intent = { kind: "dismiss", scope: DETAIL_SCOPE } as const;
                const apply = () => {
                  applySelect(null);
                  update({ tab: tab.key });
                };
                if (!unsaved.hasBlocking(intent)) apply();
                else void unsaved.requestDeparture(intent).then((approval) => (approval?.run(apply) ? approval.release() : undefined));
              }}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-table font-medium transition-colors touch:h-11",
                active ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              {tab.label}
              {tab.key === "waiting" && (counts.waiting > 0 || partial) ? (
                <span
                  className={cn("rounded-full px-1.5 text-micro tabular-nums", active ? "bg-primary-fg/15" : "bg-surface-muted text-fg")}
                  aria-label={partial ? `${counts.waiting > 0 ? `At least ${counts.waiting}` : "An unknown number"}, some sources could not be loaded` : undefined}
                >
                  {waitingText}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          className="min-w-0 flex-1 sm:max-w-sm"
          placeholder="Search number, title, requester, project"
          aria-label="Search approvals"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label className="sr-only" htmlFor="approvals-sort">
          Sort
        </label>
        <select
          id="approvals-sort"
          className="h-10 min-w-0 rounded-md border border-line bg-surface px-3 text-table text-fg hover:border-line-strong focus:border-accent focus:outline-none touch:h-11"
          value={state.sort}
          onChange={(event) => update({ sort: event.target.value as ApprovalSort })}
        >
          {SORTS.map((sort) => (
            <option key={sort.key} value={sort.key}>
              {sort.label}
            </option>
          ))}
        </select>
        {state.tab === "returned" ? (
          <select
            aria-label="Returned by or to me"
            className="h-10 min-w-0 rounded-md border border-line bg-surface px-3 text-table text-fg hover:border-line-strong focus:border-accent focus:outline-none touch:h-11"
            value={state.returned}
            onChange={(event) => update({ returned: event.target.value as ApprovalsState["returned"] })}
          >
            <option value="all">By me or to me</option>
            <option value="by">Returned by me</option>
            <option value="to">Returned to me</option>
          </select>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => setFiltersOpen(true)} aria-label={filterCount ? `Filters, ${filterCount} active` : "Filters"}>
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {filterCount > 0 ? <span className="rounded-full bg-primary px-1.5 text-micro tabular-nums text-primary-fg">{filterCount}</span> : null}
        </Button>
        <div className="hidden items-center rounded-md border border-line p-0.5 sm:flex" role="group" aria-label="Row density">
          {(["comfortable", "compact"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={density === value}
              aria-label={value === "comfortable" ? "Comfortable rows" : "Compact rows"}
              onClick={() => {
                setDensity(value);
                try {
                  window.localStorage.setItem("nesto.approvals.density", value);
                } catch {
                  // Not remembered; still applied.
                }
              }}
              className={cn("rounded p-1.5 text-fg-subtle transition-colors", density === value ? "bg-hover text-fg" : "hover:text-fg")}
            >
              {value === "comfortable" ? <Rows3 aria-hidden="true" className="size-4" /> : <Rows4 aria-hidden="true" className="size-4" />}
            </button>
          ))}
        </div>
      </div>

      <FilterChips
        filters={state.filters}
        providers={data.providers}
        projects={projectOptions}
        requesters={requesterOptions}
        companies={group ? data.companies : undefined}
        onChange={(filters) => update({ filters })}
      />

      {unavailable.length > 0 ? (
        <div role="status" className="flex flex-wrap items-start gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3" data-testid="approvals-unavailable">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-strong" />
          <p className="min-w-0 flex-1 text-table text-fg">
            Some approval sources could not be loaded: {unavailableNames}. Their items are not shown, so the list and the total are incomplete.
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => void loadList(state)} disabled={listLoading}>
            Try again
          </Button>
        </div>
      ) : null}

      <div id="approvals-panel" role="tabpanel" className={cn("grid items-start gap-5", group ? "" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
        <section className="overflow-hidden rounded-2xl border border-line bg-surface" aria-busy={listLoading}>
          {listError ? (
            <div className="px-6 py-10 text-center" role="alert">
              <p className="text-body font-medium text-fg">{listError}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => void loadList(state)}>
                Try again
              </Button>
            </div>
          ) : listLoading && items.length === 0 ? (
            <ListSkeleton />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center" data-testid="approvals-empty">
              <span className="flex size-12 items-center justify-center rounded-full border border-line bg-surface-muted text-fg-subtle">
                {filterCount || state.q ? <ListFilter aria-hidden="true" className="size-5" /> : <Inbox aria-hidden="true" className="size-5" />}
              </span>
              <p className="mt-3 text-body font-semibold text-fg">{filterCount || state.q ? "Nothing matches these filters." : empty.title}</p>
              <p className="mt-1 max-w-sm text-table text-fg-muted">{filterCount || state.q ? "Remove a filter or search for something else." : empty.body}</p>
              {filterCount || state.q ? (
                // No results offers the way back to the queue, never "create" (AUD-05 §6, UX-11).
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setSearch("");
                    update({ filters: EMPTY_FILTERS, q: "" });
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : (
            <div className={cn(listLoading && "opacity-60 transition-opacity")}>
              <ApprovalList items={items} tab={state.tab} selectedId={selectedId} density={density} onSelect={(item) => select(item)} group={group} />
              {cursor || data.windowed ? (
                <div className="flex flex-col items-center gap-2 border-t border-line px-4 py-3">
                  {cursor ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                      {loadingMore ? "Loading…" : "Show more"}
                    </Button>
                  ) : null}
                  {data.windowed ? <p className="text-meta text-fg-subtle">Showing the most recent approvals from each source. Narrow the dates to reach older ones.</p> : null}
                </div>
              ) : null}
            </div>
          )}
        </section>

        {group ? null : (
          <aside
            aria-label="Approval review"
            className="hidden overflow-hidden rounded-2xl border border-line bg-surface lg:sticky lg:top-[calc(var(--nesto-topbar-height)+1rem)] lg:flex lg:h-[calc(100dvh-var(--nesto-topbar-height)-2rem)] lg:flex-col"
          >
            {desktop ? (
              <UnsavedScope id={DETAIL_SCOPE}>
                <ApprovalDetailView
                  detail={detail}
                  loading={detailLoading}
                  failure={detailFailure}
                  pending={pending}
                  onDecide={decide}
                  onReload={() => (selectedId ? void loadDetail(selectedId).then(() => loadList(state)) : undefined)}
                  onClose={() => select(null)}
                  variant="panel"
                />
              </UnsavedScope>
            ) : null}
          </aside>
        )}
      </div>

      {/* Guarded: closing the sheet asks about the note or reason inside it (AUD-03 §5); once approved, the selection goes. Clear of the notch and rounded corners (AUD-04 §3). */}
      <GuardedRoot open={sheetOpen} onOpenChange={(open) => (open ? null : applySelect(null))}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            className="fixed inset-0 z-[55] flex flex-col bg-surface pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] outline-none data-[state=open]:animate-[nesto-slide-in-bottom_180ms_var(--nesto-ease)]"
            aria-describedby={undefined}
            data-testid="approval-sheet"
          >
            <DialogPrimitive.Title className="sr-only">{detail?.item.title ?? "Approval"}</DialogPrimitive.Title>
            {desktop === false ? (
              <UnsavedScope id={DETAIL_SCOPE}>
                <ApprovalDetailView
                  detail={detail}
                  loading={detailLoading}
                  failure={detailFailure}
                  pending={pending}
                  onDecide={decide}
                  onReload={() => (selectedId ? void loadDetail(selectedId) : undefined)}
                  onClose={() => select(null)}
                  variant="sheet"
                />
              </UnsavedScope>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </GuardedRoot>

      <FilterDrawer
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        tab={state.tab}
        filters={state.filters}
        providers={data.providers}
        projects={projectOptions}
        requesters={requesterOptions}
        companies={group ? data.companies : undefined}
        onApply={(filters) => update({ filters })}
      />
      {group ? null : (
        <DelegationDialog
          open={delegationOpen}
          providers={data.providers}
          onOpenChange={(open) => {
            setDelegationOpen(open);
            syncUrl(state, selectedId, open ? "delegation" : null);
          }}
        />
      )}
    </div>
    </ApprovalDraftProvider>
  );
}

export { EMPTY_FILTERS };
