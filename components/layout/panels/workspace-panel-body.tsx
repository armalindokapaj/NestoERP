"use client";

import * as React from "react";
import { Building2, Check, Layers } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { WorkspaceCompanyDTO, WorkspacesDTO } from "@/lib/workspace/workspace.service";
import { cn } from "@/lib/utils/cn";
import type { WorkspaceOption as Option } from "@/components/layout/workspace-switcher";

/**
 * The workspace chooser's search and list, loaded when it first opens
 * (Workspace Context §49-§53; NAV-03 PANEL-01, PANEL-05). It draws from the
 * list NAV-02 already streamed into the shell: opening reads nothing.
 */

/** Case and accents folded, so "ndertim" finds NDËRTIM. */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function WorkspacePanelBody({ workspaces, choose }: { workspaces: WorkspacesDTO; choose: (option: Option) => void }) {
  const t = useTranslations("workspace");
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();
  const { parentGroup, active: current } = workspaces;
  const inGroup = current.scopeType === "GROUP";

  React.useEffect(() => inputRef.current?.focus(), []);

  const options = React.useMemo<Option[]>(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const matches = (company: WorkspaceCompanyDTO, group: string | null) => {
      const text = fold([company.name, company.role.label, company.department ?? "", group ?? ""].join(" "));
      return words.every((word) => text.includes(word));
    };
    const list: Option[] = [];
    // Pinned: the search narrows the companies, never the group (§49).
    if (parentGroup.groupViewAllowed) {
      list.push({ key: "group", scopeType: "GROUP", companyId: null, name: parentGroup.name, isCurrent: inGroup });
    }
    for (const company of workspaces.companies.filter((candidate) => matches(candidate, null))) {
      list.push({ key: company.id, scopeType: "COMPANY", companyId: company.id, name: company.name, isCurrent: !inGroup && company.id === current.companyId, company, groupName: null });
    }
    for (const group of workspaces.otherGroups) {
      for (const company of group.companies.filter((candidate) => matches(candidate, group.name))) {
        list.push({ key: company.id, scopeType: "COMPANY", companyId: company.id, name: company.name, isCurrent: !inGroup && company.id === current.companyId, company, groupName: group.name });
      }
    }
    return list;
  }, [query, workspaces, parentGroup, inGroup, current.companyId]);

  const optionId = (option: Option) => `${listId}-${option.key}`;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (options.length === 0) return;
    const last = options.length - 1;
    if (event.key === "ArrowDown") setActive((index) => (index >= last ? 0 : index + 1));
    else if (event.key === "ArrowUp") setActive((index) => (index <= 0 ? last : index - 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Enter") {
      const option = options[Math.min(active, last)];
      if (option) choose(option);
    } else return;
    event.preventDefault();
  }

  const activeOption = options[Math.min(active, options.length - 1)];
  const companyOptions = options.filter((option): option is Extract<Option, { scopeType: "COMPANY" }> => option.scopeType === "COMPANY");

  function renderCompany(option: Extract<Option, { scopeType: "COMPANY" }>) {
    const isActive = activeOption?.key === option.key;
    return (
      <li key={option.key} role="presentation">
        <button
          type="button"
          role="option"
          id={optionId(option)}
          aria-selected={option.isCurrent}
          tabIndex={-1}
          data-testid="workspace-option"
          data-scope="COMPANY"
          data-company-id={option.companyId}
          onMouseMove={() => setActive(options.indexOf(option))}
          onClick={() => choose(option)}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
            isActive ? "bg-hover" : "bg-transparent",
          )}
        >
          <Building2 aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-table font-medium text-fg">{option.name}</span>
            <span className="truncate text-micro text-fg-muted">
              {[option.company.role.label, option.company.department].filter(Boolean).join(" · ")}
            </span>
          </span>
          {option.isCurrent ? <Check aria-label={t("current")} className="size-4 shrink-0 text-accent-strong" /> : null}
        </button>
      </li>
    );
  }

  const groupOption = options.find((option) => option.scopeType === "GROUP");
  const ownCompanies = companyOptions.filter((option) => option.groupName === null);
  const otherGroupNames = [...new Set(companyOptions.map((option) => option.groupName).filter((name): name is string => name !== null))];

  return (
    <>
          <div className="pr-8">
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </div>

          <input
            ref={inputRef}
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
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg placeholder:text-fg-subtle hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20"
          />

          <div id={listId} role="listbox" aria-label={t("title")} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            {groupOption ? (
              <div className="mb-3">
                <p className="nesto-eyebrow px-1 pb-1 text-fg-subtle">{t("groupHeading")}</p>
                <button
                  type="button"
                  role="option"
                  id={optionId(groupOption)}
                  aria-selected={groupOption.isCurrent}
                  tabIndex={-1}
                  data-testid="workspace-option"
                  data-scope="GROUP"
                  onMouseMove={() => setActive(options.indexOf(groupOption))}
                  onClick={() => choose(groupOption)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    groupOption.isCurrent ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-muted",
                    activeOption?.key === "group" && "ring-2 ring-ring/30",
                  )}
                >
                  <Layers aria-hidden="true" className="size-5 shrink-0 text-accent-strong" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body font-semibold text-fg">{groupOption.name}</span>
                    <span className="truncate text-micro text-fg-muted">{t("groupOptionHint")}</span>
                  </span>
                  {groupOption.isCurrent ? <Check aria-label={t("current")} className="size-4 shrink-0 text-accent-strong" /> : null}
                </button>
              </div>
            ) : null}

            <p className="nesto-eyebrow px-1 pb-1 text-fg-subtle">{t("companiesHeading")}</p>
            <ul role="presentation" className="space-y-0.5">
              {ownCompanies.map(renderCompany)}
            </ul>
            {ownCompanies.length === 0 && otherGroupNames.length === 0 ? (
              <p className="px-3 py-4 text-table text-fg-muted" role="status">
                {t("noMatches")}
              </p>
            ) : null}

            {otherGroupNames.map((name) => (
              <div key={name} className="mt-3">
                <p className="nesto-eyebrow px-1 pb-1 text-fg-subtle">{name}</p>
                <ul role="presentation" className="space-y-0.5">
                  {companyOptions.filter((option) => option.groupName === name).map(renderCompany)}
                </ul>
              </div>
            ))}
          </div>
    </>
  );
}
