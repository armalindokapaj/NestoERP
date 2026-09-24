"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { ChevronLeft, ChevronRight, RotateCcw, SlidersHorizontal } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { plural } from "@/components/project-structure/structure-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { UNIT_CONTRACT_STATUS_LABELS, type ContractStatusKey } from "@/lib/modules/contracts/units/unit-contract.types";
import type { FINANCE_INVENTORY_SORTS } from "@/lib/modules/finance/units/unit-finance.schema";
import { UNIT_FINANCIAL_STATUS_LABELS, type FinanceInventoryDTO, type FinanceInventoryRowDTO, type UnitFinancialStatus } from "@/lib/modules/finance/units/unit-finance.types";
import { formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { amountLabel, FinancialStatusBadge, UnitContractStatusBadge } from "./finance-status";

/**
 * A project's units as Finance sees them (E-05F §45-§48, §92, §127).
 *
 * The canonical units with their live contract's figures, filtered, searched and
 * counted by the server. The totals above the list are the contracts', each once.
 * A row opens the unit's Finance section; on a phone each unit is a card with
 * what decides collection.
 */

type Sort = (typeof FINANCE_INVENTORY_SORTS)[number];

export type FinanceFilters = {
  q: string;
  financialStatus: string;
  buildingId: string;
  floorId: string;
  unitTypeId: string;
  contractStatus: string;
  overdue: string;
  dueFrom: string;
  dueTo: string;
  currency: string;
  sort: Sort;
};

export const EMPTY_FINANCE_FILTERS: FinanceFilters = { q: "", financialStatus: "", buildingId: "", floorId: "", unitTypeId: "", contractStatus: "", overdue: "", dueFrom: "", dueTo: "", currency: "", sort: "structure" };

const PANEL_KEYS = ["buildingId", "floorId", "unitTypeId", "contractStatus", "overdue", "dueFrom", "dueTo", "currency"] as const;
const QUICK: Array<UnitFinancialStatus | ""> = ["", "NO_CONTRACT", "CONTRACT_PENDING", "PAYMENT_PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE", "FINANCIALLY_COMPLETE"];
const SORT_LABELS: Record<Sort, string> = { structure: "Building and floor", code: "Unit code", "-outstanding": "Outstanding, highest first", outstanding: "Outstanding, lowest first", overdue: "Overdue, highest first", nextDue: "Next payment due", value: "Contract value" };
const CONTRACT_STATUSES: ContractStatusKey[] = ["DRAFT", "IN_REVIEW", "PENDING_APPROVAL", "APPROVED", "SENT", "SIGNED", "ACTIVE", "COMPLETED"];

type Place = { id: string; name: string; floors: Array<{ id: string; name: string }> };

function queryString(filters: FinanceFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.financialStatus) params.set("financialStatus", filters.financialStatus);
  for (const key of PANEL_KEYS) if (filters[key]) params.set(key, filters[key]);
  if (filters.sort !== "structure") params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

export function FinanceInventory({ projectId, initial, initialFilters, buildings, unitTypes }: { projectId: string; initial: FinanceInventoryDTO; initialFilters: FinanceFilters; buildings: Place[]; unitTypes: Array<{ id: string; name: string }> }) {
  const [filters, setFilters] = React.useState(initialFilters);
  const [search, setSearch] = React.useState(initialFilters.q);
  const [page, setPage] = React.useState(initial.page);
  const [list, setList] = React.useState(initial);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [panelOpen, setPanelOpen] = React.useState(PANEL_KEYS.some((key) => initialFilters[key]));
  const firstLoad = React.useRef(true);

  const panelCount = PANEL_KEYS.filter((key) => filters[key]).length;
  const active = panelCount + (filters.q.trim() ? 1 : 0) + (filters.financialStatus ? 1 : 0);
  const floors = buildings.find((building) => building.id === filters.buildingId)?.floors ?? buildings.flatMap((building) => building.floors.map((floor) => ({ ...floor, name: `${building.name} · ${floor.name}` })));

  React.useEffect(() => {
    const timer = window.setTimeout(() => setFilters((current) => (current.q === search ? current : { ...current, q: search })), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    const url = new URL(window.location.href);
    url.search = queryString(filters, page);
    window.history.replaceState(window.history.state, "", url.toString());
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    fetch(`/api/projects/${projectId}/finance/units?${queryString(filters, page)}`, { signal: controller.signal })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as { data?: FinanceInventoryDTO; error?: { message?: string } } | null;
        if (!response.ok || !json?.data) throw new Error(json?.error?.message ?? "Could not load the units.");
        setList(json.data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load the units.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, page, projectId, reloadKey]);

  function setFilter(patch: Partial<FinanceFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  const href = (row: FinanceInventoryRowDTO) => `/projects/${projectId}/units/${row.id}/finance`;
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const first = list.total ? (list.page - 1) * list.pageSize + 1 : 0;
  const last = Math.min(list.page * list.pageSize, list.total);

  return (
    <div className="space-y-3">
      <section aria-label="Project finance totals" className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="finance-totals">
        {(["contracted", "collected", "outstanding", "overdue"] as const).map((key) => (
          <div key={key} className="nesto-card p-4">
            <p className="text-table text-fg-muted">{key === "contracted" ? "Contracted" : key === "collected" ? "Collected" : key === "outstanding" ? "Outstanding" : "Overdue"}</p>
            {list.totals.length === 0 ? (
              <p className="mt-2 text-page font-semibold tabular-nums text-fg">—</p>
            ) : (
              list.totals.map((row) => (
                <p key={row.currency} className={cn("mt-2 break-words text-card font-semibold tabular-nums sm:text-page", key === "overdue" && Number(row.overdue) > 0 ? "text-danger-strong" : "text-fg")} data-testid={`finance-total-${key}`}>
                  {amountLabel(row[key], row.currency)}
                </p>
              ))
            )}
          </div>
        ))}
      </section>

      <div className="-mx-1 overflow-x-auto">
        <div className="flex min-w-max gap-1.5 px-1" role="group" aria-label="Financial status">
          {QUICK.map((status) => {
            const pressed = filters.financialStatus === status;
            return (
              <button
                key={status || "ALL"}
                type="button"
                aria-pressed={pressed}
                data-testid="finance-quick-filter"
                data-status={status || "ALL"}
                onClick={() => setFilter({ financialStatus: status })}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-table font-medium transition-colors", pressed ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg")}
              >
                {status ? UNIT_FINANCIAL_STATUS_LABELS[status] : "All"}
                <span className={cn("tabular-nums", pressed ? "opacity-90" : "text-fg-subtle")}>{list.counts[status || "ALL"]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField className="w-full sm:w-auto sm:min-w-0 sm:max-w-xs sm:flex-1" placeholder={list.canSeeClients ? "Search unit, client or contract" : "Search unit or contract"} value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search units" />
        <Button variant="secondary" onClick={() => setPanelOpen((open) => !open)} aria-expanded={panelOpen}>
          <SlidersHorizontal aria-hidden="true" />
          Filters{panelCount ? ` (${panelCount})` : ""}
        </Button>
        <select aria-label="Sort units" className={cn(selectClass, "w-auto")} value={filters.sort} onChange={(event) => setFilter({ sort: event.target.value as Sort })}>
          {(Object.keys(SORT_LABELS) as Sort[]).map((sort) => (
            <option key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </option>
          ))}
        </select>
        {active ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setFilters({ ...EMPTY_FINANCE_FILTERS, sort: filters.sort });
              setPage(1);
            }}
          >
            <RotateCcw aria-hidden="true" />
            Clear filters
          </Button>
        ) : null}
      </div>

      {panelOpen ? (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-line bg-surface-muted p-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="finance-filters">
          <FilterSelect label="Building" value={filters.buildingId} onChange={(buildingId) => setFilter({ buildingId, floorId: "" })} options={buildings.map((building) => ({ value: building.id, label: building.name }))} />
          <FilterSelect label="Floor" value={filters.floorId} onChange={(floorId) => setFilter({ floorId })} options={floors.map((floor) => ({ value: floor.id, label: floor.name }))} />
          <FilterSelect label="Unit type" value={filters.unitTypeId} onChange={(unitTypeId) => setFilter({ unitTypeId })} options={unitTypes.map((type) => ({ value: type.id, label: type.name }))} />
          <FilterSelect label="Contract status" value={filters.contractStatus} onChange={(contractStatus) => setFilter({ contractStatus })} options={CONTRACT_STATUSES.map((status) => ({ value: status, label: UNIT_CONTRACT_STATUS_LABELS[status] }))} />
          <FilterSelect label="Overdue" value={filters.overdue} onChange={(overdue) => setFilter({ overdue })} options={[{ value: "1", label: "Only overdue" }]} />
          <FilterSelect label="Currency" value={filters.currency} onChange={(currency) => setFilter({ currency })} options={["EUR", "ALL", "USD", "GBP"].map((code) => ({ value: code, label: code }))} />
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="finance-due-from" className="text-meta font-medium text-fg-muted">
              Next due from
            </label>
            <Input id="finance-due-from" type="date" className="h-9" value={filters.dueFrom} onChange={(event) => setFilter({ dueFrom: event.target.value })} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="finance-due-to" className="text-meta font-medium text-fg-muted">
              Next due to
            </label>
            <Input id="finance-due-to" type="date" className="h-9" value={filters.dueTo} onChange={(event) => setFilter({ dueTo: event.target.value })} />
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong" role="alert">
          <span>{loadError}</span>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </Button>
        </div>
      ) : list.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center text-table text-fg-muted" data-testid="finance-none">
          {active ? "No units match these filters." : "This project has no units yet."}
        </p>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : undefined} aria-busy={loading}>
          {active ? <p className="mb-2 text-table text-fg-muted">{plural(list.total, "unit")}</p> : null}
          <div className="hidden lg:block">
            <Table data-testid="finance-table">
              <TableHead>
                <tr>
                  <TableHeaderCell>Unit</TableHeaderCell>
                  {list.canSeeClients ? <TableHeaderCell>Client</TableHeaderCell> : null}
                  <TableHeaderCell>Contract</TableHeaderCell>
                  <TableHeaderCell className="text-right">Value</TableHeaderCell>
                  <TableHeaderCell className="text-right">Paid</TableHeaderCell>
                  <TableHeaderCell className="text-right">Outstanding</TableHeaderCell>
                  <TableHeaderCell className="text-right">Overdue</TableHeaderCell>
                  <TableHeaderCell>Next due</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {list.items.map((row) => (
                  <TableRow key={row.id} data-testid="finance-row" data-unit-code={row.unitCode}>
                    <TableCell className="whitespace-nowrap">
                      <Link href={href(row)} className="font-medium text-fg hover:text-accent-strong">
                        {row.unitCode}
                      </Link>
                      <span className="block text-meta text-fg-subtle">
                        {row.building} · {row.floor}
                      </span>
                    </TableCell>
                    {list.canSeeClients ? <TableCell className="max-w-[10rem] truncate">{row.client ? <Link href={`/clients/${row.client.id}`} className="hover:underline">{row.client.name}</Link> : "—"}</TableCell> : null}
                    <TableCell className="whitespace-nowrap">
                      {row.contract ? (
                        <>
                          {row.contract.number}
                          <span className="mt-0.5 block">
                            <UnitContractStatusBadge status={row.contract.status} />
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{amountLabel(row.contractValue, row.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-fg-muted">{amountLabel(row.paidAmount, row.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{amountLabel(row.outstandingAmount, row.currency)}</TableCell>
                    <TableCell className={cn("whitespace-nowrap text-right tabular-nums", Number(row.overdueAmount ?? 0) > 0 ? "text-danger-strong" : "text-fg-muted")}>{amountLabel(row.overdueAmount, row.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-fg-muted">
                      {row.nextDue ? (
                        <>
                          <span className="tabular-nums">{amountLabel(row.nextDue.amount, row.currency)}</span>
                          <span className="block text-meta text-fg-subtle">{formatDate(row.nextDue.dueDate)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <FinancialStatusBadge status={row.financialStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="space-y-2 lg:hidden" data-testid="finance-cards">
            {list.items.map((row) => (
              <li key={row.id} className="nesto-card p-3" data-testid="finance-card" data-unit-code={row.unitCode}>
                <Link href={href(row)} className="block min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-semibold text-fg">{row.unitCode}</span>
                    <FinancialStatusBadge status={row.financialStatus} />
                    <span className="ml-auto text-body font-medium tabular-nums text-fg">{amountLabel(row.outstandingAmount, row.currency)}</span>
                  </span>
                  <span className="mt-0.5 block text-meta text-fg-subtle">
                    {row.building} · {row.floor}
                    {row.contract ? ` · ${row.contract.number} · ${UNIT_CONTRACT_STATUS_LABELS[row.contract.status as ContractStatusKey] ?? row.contract.status}` : ""}
                  </span>
                  {row.contract ? (
                    <span className="mt-1 block text-meta text-fg-muted">
                      Paid {amountLabel(row.paidAmount, row.currency)} of {amountLabel(row.contractValue, row.currency)}
                      {Number(row.overdueAmount ?? 0) > 0 ? ` · ${amountLabel(row.overdueAmount, row.currency)} overdue` : ""}
                      {row.nextDue ? ` · next ${formatDate(row.nextDue.dueDate)}` : ""}
                    </span>
                  ) : null}
                  {row.client ? <span className="mt-0.5 block text-meta text-fg-muted">{row.client.name}</span> : null}
                </Link>
              </li>
            ))}
          </ul>

          {list.total > list.pageSize ? (
            <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-table text-fg-muted">
                <span className="tabular-nums">
                  {first}–{last}
                </span>{" "}
                of <span className="tabular-nums">{list.total}</span>
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={list.page <= 1 || loading} onClick={() => setPage(list.page - 1)}>
                  <ChevronLeft aria-hidden="true" />
                  Previous
                </Button>
                <span className="text-table tabular-nums text-fg-subtle">
                  Page {list.page} of {pages}
                </span>
                <Button variant="secondary" size="sm" disabled={list.page >= pages || loading} onClick={() => setPage(list.page + 1)}>
                  Next
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  const id = `finance-filter-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-meta font-medium text-fg-muted">
        {label}
      </label>
      <select id={id} className={cn(selectClass, "h-9")} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
