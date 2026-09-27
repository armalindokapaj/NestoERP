"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import type { WorkspaceCompanyDTO, WorkspacesDTO } from "@/lib/workspace/workspace.service";
import { cn } from "@/lib/utils/cn";

export type WorkspaceOption =
  | { key: "group"; scopeType: "GROUP"; companyId: null; name: string; isCurrent: boolean }
  | { key: string; scopeType: "COMPANY"; companyId: string; name: string; isCurrent: boolean; company: WorkspaceCompanyDTO; groupName: string | null };

type CompanyOption = Extract<WorkspaceOption, { scopeType: "COMPANY" }>;

/** From this many companies on, the list gets a search field (OW §25; the PRD's example has five). */
export const WORKSPACE_SEARCH_FROM = 5;

/** Case and accents folded, so "ndertim" finds NDËRTIM. */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/**
 * The workspace popup's content (OW §20-§27, §53-§55), loaded when the popup
 * first opens or is about to (NAV-03 PANEL-01). It draws from the list the
 * shell already streamed: opening it reads nothing.
 *
 * The Group sits above the companies and only when it may be entered; the
 * companies are the ones the server returned, in alphabetical order — nothing
 * the person may not enter is listed, disabled or counted (§24). The current
 * workspace is the selected option. Search appears once the list is long and
 * narrows the companies, never the Group.
 *
 * Keyboard (a listbox, driven through `aria-activedescendant`): focus starts
 * in the search field when there is one, otherwise on the list, with the
 * current workspace active; the arrow keys, Home and End move, Enter chooses.
 * Escape and a click outside belong to the popup around it.
 */
export function WorkspacePanelBody({
  workspaces,
  choose,
  titleId,
}: {
  workspaces: WorkspacesDTO;
  choose: (option: WorkspaceOption) => void;
  /** The popup's accessible name comes from this heading (§53). */
  titleId: string;
}) {
  const t = useTranslations("workspace");
  const [query, setQuery] = React.useState("");
  const listId = React.useId();
  const searchRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const { parentGroup, active: current } = workspaces;
  const inGroup = current.scopeType === "GROUP";
  const companyCount = workspaces.companies.length + workspaces.otherGroups.reduce((sum, group) => sum + group.companies.length, 0);
  const searchable = companyCount >= WORKSPACE_SEARCH_FROM;

  const options = React.useMemo<WorkspaceOption[]>(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const matches = (company: WorkspaceCompanyDTO, group: string | null) => {
      const text = fold([company.name, group ?? ""].join(" "));
      return words.every((word) => text.includes(word));
    };
    const toOption = (company: WorkspaceCompanyDTO, groupName: string | null): CompanyOption => ({
      key: company.id,
      scopeType: "COMPANY",
      companyId: company.id,
      name: company.name,
      isCurrent: !inGroup && company.id === current.companyId,
      company,
      groupName,
    });
    const list: WorkspaceOption[] = [];
    if (parentGroup.groupViewAllowed) {
      list.push({ key: "group", scopeType: "GROUP", companyId: null, name: parentGroup.name, isCurrent: inGroup });
    }
    list.push(...workspaces.companies.filter((company) => matches(company, null)).map((company) => toOption(company, null)).sort(byName));
    for (const group of workspaces.otherGroups) {
      list.push(...group.companies.filter((company) => matches(company, group.name)).map((company) => toOption(company, group.name)).sort(byName));
    }
    return list;
  }, [query, workspaces, parentGroup, inGroup, current.companyId]);

  // The option the keys act on. Unset, it is the current workspace — or, while
  // searching, the first company found, so Enter never lands on the pinned Group.
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const fallbackIndex = query
    ? Math.max(0, options.findIndex((option) => option.scopeType === "COMPANY"))
    : Math.max(0, options.findIndex((option) => option.isCurrent));
  const chosenIndex = options.findIndex((option) => option.key === activeKey);
  const activeIndex = chosenIndex >= 0 ? chosenIndex : fallbackIndex;
  const activeOption = options[activeIndex];
  const optionId = (option: WorkspaceOption) => `${listId}-${option.key}`;

  // Focus the first logical control, with the current workspace active (§55).
  React.useEffect(() => {
    (searchable ? searchRef.current : listRef.current)?.focus();
  }, [searchable]);

  // Keep the active option in view as the keys move it.
  React.useEffect(() => {
    if (!activeOption) return;
    document.getElementById(optionId(activeOption))?.scrollIntoView({ block: "nearest" });
  });

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (options.length === 0) return;
    const last = options.length - 1;
    const move = (index: number) => setActiveKey(options[index]!.key);
    if (event.key === "ArrowDown") move(activeIndex >= last ? 0 : activeIndex + 1);
    else if (event.key === "ArrowUp") move(activeIndex <= 0 ? last : activeIndex - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(last);
    else if (event.key === "Enter" || (event.key === " " && event.currentTarget === listRef.current)) {
      if (activeOption) choose(activeOption);
    } else if (searchable && event.currentTarget === listRef.current && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Typing on the list goes to the search field.
      searchRef.current?.focus();
      return;
    } else return;
    event.preventDefault();
  }

  function renderOption(option: WorkspaceOption) {
    const isActive = activeOption?.key === option.key;
    const isGroup = option.scopeType === "GROUP";
    return (
      <div
        key={option.key}
        role="option"
        id={optionId(option)}
        aria-selected={option.isCurrent}
        data-testid="workspace-option"
        data-scope={option.scopeType}
        data-company-id={option.companyId ?? undefined}
        data-current={option.isCurrent || undefined}
        onMouseMove={() => setActiveKey(option.key)}
        // Keep focus where it is: the list or the search field drives the keys.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors touch:min-h-11",
          isActive ? "bg-hover" : "bg-transparent",
        )}
      >
        {/* The selected indicator (§26): filled for the current workspace, hollow otherwise. */}
        <span
          aria-hidden="true"
          data-testid="workspace-option-indicator"
          className={cn(
            "grid size-3.5 shrink-0 place-items-center rounded-full border",
            option.isCurrent ? "border-accent-strong" : "border-line-strong",
          )}
        >
          {option.isCurrent ? <span className="size-1.5 rounded-full bg-accent-strong" /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-table text-fg", option.isCurrent ? "font-semibold" : "font-medium")} title={option.name}>
            {option.name}
          </span>
          {isGroup ? <span className="truncate text-micro text-fg-muted">{t("groupOptionHint")}</span> : null}
        </span>
      </div>
    );
  }

  const groupOption = options.find((option) => option.scopeType === "GROUP");
  const companyOptions = options.filter((option): option is CompanyOption => option.scopeType === "COMPANY");
  const ownCompanies = companyOptions.filter((option) => option.groupName === null);
  const otherGroupNames = [...new Set(companyOptions.map((option) => option.groupName).filter((name): name is string => name !== null))];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <h2 id={titleId} className="px-1 text-card font-semibold text-fg">
        {t("title")}
      </h2>

      {searchable ? (
        <input
          ref={searchRef}
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
          aria-label={t("searchLabel")}
          placeholder={t("searchPlaceholder")}
          autoComplete="off"
          value={query}
          data-testid="workspace-search"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveKey(null);
          }}
          onKeyDown={onKeyDown}
          className="h-9 w-full rounded-md border border-line bg-surface px-3 text-table text-fg placeholder:text-fg-subtle hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring touch:h-11"
        />
      ) : null}

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-labelledby={titleId}
        aria-activedescendant={!searchable && activeOption ? optionId(activeOption) : undefined}
        tabIndex={searchable ? -1 : 0}
        onKeyDown={searchable ? undefined : onKeyDown}
        data-testid="workspace-list"
        className="-mx-1 min-h-0 flex-1 overflow-y-auto rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {groupOption ? (
          <div role="group" aria-label={t("groupHeading")} className="mb-2">
            <p aria-hidden="true" className="nesto-eyebrow px-2.5 pb-1 text-fg-subtle">{t("groupHeading")}</p>
            {renderOption(groupOption)}
          </div>
        ) : null}

        {ownCompanies.length > 0 || query ? (
          <div role="group" aria-label={t("companiesHeading")}>
            <p aria-hidden="true" className="nesto-eyebrow px-2.5 pb-1 text-fg-subtle">{t("companiesHeading")}</p>
            {ownCompanies.map(renderOption)}
          </div>
        ) : null}
        {companyOptions.length === 0 && query ? (
          <p className="px-2.5 py-3 text-table text-fg-muted" role="status">
            {t("noMatches")}
          </p>
        ) : null}

        {otherGroupNames.map((name) => (
          <div key={name} role="group" aria-label={name} className="mt-2">
            <p aria-hidden="true" className="nesto-eyebrow px-2.5 pb-1 text-fg-subtle">{name}</p>
            {companyOptions.filter((option) => option.groupName === name).map(renderOption)}
          </div>
        ))}
      </div>
    </div>
  );
}
