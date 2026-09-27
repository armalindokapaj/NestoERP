"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { ChevronLeft, ChevronRight, RotateCcw, SlidersHorizontal } from "lucide-react";

import { useFinanceTranslations } from "@/components/finance/finance-text";
import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { UNIT_CONTRACT_STATUS_LABELS, type ContractStatusKey } from "@/lib/modules/contracts/units/unit-contract.types";
import type { FINANCE_INVENTORY_SORTS } from "@/lib/modules/finance/units/unit-finance.schema";
import { type FinanceInventoryDTO, type FinanceInventoryRowDTO, type UnitFinancialStatus } from "@/lib/modules/finance/units/unit-finance.types";
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
const SORT_KEYS = { structure: "structure", code: "code", "-outstanding": "outstandingDesc", outstanding: "outstandingAsc", overdue: "overdue", nextDue: "nextDue", value: "value" } as const satisfies Record<Sort, string>;
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
  const t = useFinanceTranslations();
  const [filters, setFilters] = React.useState(initialFilters);
  const [search, setSearch] = React.useState(initialFilters.q);
  const [page, setPage] = React.useState(initial.page);
  const [list, setList] = React.useState(initial);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [panelOpen, setPanelOpen] = React.useState(PANEL_KEYS.some((key) => initialFilters[key]));
  const firstLoad = React.useRef(true);
  const settledPage = React.useRef<number | null>(null);

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
    if (settledPage.current === page) {
      settledPage.current = null;
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    fetch(`/api/projects/${projectId}/finance/units?${queryString(filters, page)}`, { signal: controller.signal })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as { data?: FinanceInventoryDTO; error?: { message?: string } } | null;
        if (!response.ok || !json?.data) throw new Error(json?.error?.message ?? t("inventory.loadFailed"));
        setList(json.data);
        // A page past the end came back as the last real page: the address follows it once, with no second request (AUD-08 §4, DT-05).
        if (json.data.page !== page) {
          settledPage.current = json.data.page;
          setPage(json.data.page);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : t("inventory.loadFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` changes only with the language
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
      <section aria-label={t("inventory.totals")} className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="finance-totals">
        {(["contracted", "collected", "outstanding", "overdue"] as const).map((key) => (
          <div key={key} className="nesto-card p-4">
            <p className="text-table text-fg-muted">{t(`inventory.${key}`)}</p>
            {/* Every unit the filters match, not this page; one line per currency, never added across them (AUD-08 §4, DT-07). */}
            <p className="text-meta text-fg-subtle">{t("inventory.filteredTotal")}</p>
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
        <div className="flex min-w-max gap-1.5 px-1" role="group" aria-label={t("inventory.financialStatus")}>
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
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-table font-medium transition-colors touch:h-11", pressed ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg")}
              >
                {status ? t(`unitStatus.${status}`) : t("inventory.all")}
                <span className={cn("tabular-nums", pressed ? "opacity-90" : "text-fg-subtle")}>{list.counts[status || "ALL"]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField className="w-full sm:w-auto sm:min-w-0 sm:max-w-xs sm:flex-1" placeholder={list.canSeeClients ? t("inventory.searchClients") : t("inventory.search")} value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t("inventory.searchLabel")} />
        <Button variant="secondary" onClick={() => setPanelOpen((open) => !open)} aria-expanded={panelOpen}>
          <SlidersHorizontal aria-hidden="true" />
          {t("inventory.filters")}{panelCount ? ` (${panelCount})` : ""}
        </Button>
        <select aria-label={t("inventory.sortLabel")} className={cn(selectClass, "w-auto")} value={filters.sort} onChange={(event) => setFilter({ sort: event.target.value as Sort })}>
          {(Object.keys(SORT_KEYS) as Sort[]).map((sort) => (
            <option key={sort} value={sort}>
              {t(`inventory.sort.${SORT_KEYS[sort]}`)}
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
            {t("inventory.clearFilters")}
          </Button>
        ) : null}
      </div>

      {panelOpen ? (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-line bg-surface-muted p-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="finance-filters">
          <FilterSelect idKey="building" label={t("inventory.building")} value={filters.buildingId} onChange={(buildingId) => setFilter({ buildingId, floorId: "" })} options={buildings.map((building) => ({ value: building.id, label: building.name }))} />
          <FilterSelect idKey="floor" label={t("inventory.floor")} value={filters.floorId} onChange={(floorId) => setFilter({ floorId })} options={floors.map((floor) => ({ value: floor.id, label: floor.name }))} />
          <FilterSelect idKey="unit-type" label={t("inventory.unitType")} value={filters.unitTypeId} onChange={(unitTypeId) => setFilter({ unitTypeId })} options={unitTypes.map((type) => ({ value: type.id, label: type.name }))} />
          <FilterSelect idKey="contract-status" label={t("inventory.contractStatus")} value={filters.contractStatus} onChange={(contractStatus) => setFilter({ contractStatus })} options={CONTRACT_STATUSES.map((status) => ({ value: status, label: UNIT_CONTRACT_STATUS_LABELS[status] }))} />
          <FilterSelect idKey="overdue" label={t("inventory.overdue")} value={filters.overdue} onChange={(overdue) => setFilter({ overdue })} options={[{ value: "1", label: t("inventory.onlyOverdue") }]} />
          <FilterSelect idKey="currency" label={t("inventory.currency")} value={filters.currency} onChange={(currency) => setFilter({ currency })} options={["EUR", "ALL", "USD", "GBP"].map((code) => ({ value: code, label: code }))} />
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="finance-due-from" className="text-meta font-medium text-fg-muted">
              {t("inventory.nextDueFrom")}
            </label>
            <Input id="finance-due-from" type="date" className="h-9" value={filters.dueFrom} onChange={(event) => setFilter({ dueFrom: event.target.value })} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="finance-due-to" className="text-meta font-medium text-fg-muted">
              {t("inventory.nextDueTo")}
            </label>
            <Input id="finance-due-to" type="date" className="h-9" value={filters.dueTo} onChange={(event) => setFilter({ dueTo: event.target.value })} />
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong" role="alert">
          <span>{loadError}</span>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            {t("inventory.retry")}
          </Button>
        </div>
      ) : list.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center text-table text-fg-muted" data-testid="finance-none">
          {active ? t("inventory.noMatch") : t("inventory.noUnits")}
        </p>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : undefined} aria-busy={loading}>
          {active ? <p className="mb-2 text-table text-fg-muted">{t("inventory.unitCount", { count: list.total })}</p> : null}
          <div className="hidden lg:block">
            <Table label={t("inventory.tableLabel")} data-testid="finance-table">
              <TableHead>
                <tr>
                  <TableHeaderCell>{t("inventory.unit")}</TableHeaderCell>
                  {list.canSeeClients ? <TableHeaderCell>{t("inventory.client")}</TableHeaderCell> : null}
                  <TableHeaderCell>{t("inventory.contract")}</TableHeaderCell>
                  <TableHeaderCell className="text-right">{t("inventory.value")}</TableHeaderCell>
                  <TableHeaderCell className="text-right">{t("inventory.paid")}</TableHeaderCell>
                  <TableHeaderCell className="text-right">{t("inventory.outstanding")}</TableHeaderCell>
                  <TableHeaderCell className="text-right">{t("inventory.overdue")}</TableHeaderCell>
                  <TableHeaderCell>{t("inventory.nextDue")}</TableHeaderCell>
                  <TableHeaderCell>{t("inventory.status")}</TableHeaderCell>
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
                      {t("inventory.paidOf", { paid: amountLabel(row.paidAmount, row.currency), value: amountLabel(row.contractValue, row.currency) })}
                      {Number(row.overdueAmount ?? 0) > 0 ? t("inventory.overdueSuffix", { amount: amountLabel(row.overdueAmount, row.currency) }) : ""}
                      {row.nextDue ? t("inventory.nextSuffix", { date: formatDate(row.nextDue.dueDate) }) : ""}
                    </span>
                  ) : null}
                  {row.client ? <span className="mt-0.5 block text-meta text-fg-muted">{row.client.name}</span> : null}
                </Link>
              </li>
            ))}
          </ul>

          {list.total > list.pageSize ? (
            <nav aria-label={t("inventory.pagination")} className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-table text-fg-muted">
                <span className="tabular-nums">
                  {first}–{last}
                </span>{" "}
                {t("inventory.of")} <span className="tabular-nums">{list.total}</span>
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={list.page <= 1 || loading} onClick={() => setPage(list.page - 1)}>
                  <ChevronLeft aria-hidden="true" />
                  {t("inventory.previous")}
                </Button>
                <span className="text-table tabular-nums text-fg-subtle">
                  {t("inventory.pageOf", { page: list.page, total: pages })}
                </span>
                <Button variant="secondary" size="sm" disabled={list.page >= pages || loading} onClick={() => setPage(list.page + 1)}>
                  {t("inventory.next")}
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

function FilterSelect({ idKey, label, value, onChange, options }: { idKey: string; label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  const t = useFinanceTranslations();
  const id = `finance-filter-${idKey}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-meta font-medium text-fg-muted">
        {label}
      </label>
      <select id={id} className={cn(selectClass, "h-9")} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("inventory.any")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
