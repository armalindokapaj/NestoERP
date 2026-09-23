"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Building2, Check, ChevronDown, Layers, Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { requestWorkspaceSwitch } from "@/lib/workspace/client";
import type { WorkspaceCompanyDTO, WorkspacesDTO } from "@/lib/workspace/workspace.service";
import { cn } from "@/lib/utils/cn";

/** Case and accents folded, so "ndertim" finds NDËRTIM. */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type Option =
  | { key: "group"; scopeType: "GROUP"; companyId: null; name: string; isCurrent: boolean }
  | { key: string; scopeType: "COMPANY"; companyId: string; name: string; isCurrent: boolean; company: WorkspaceCompanyDTO; groupName: string | null };

/**
 * The workspace switcher (Workspace Context §5, §9, §49-§53).
 *
 * One control for where the person works: the parent group first — always the
 * top option, and visually the strongest, when they have group-level standing —
 * then the companies they may enter. It replaces the company switcher.
 *
 * Choosing an entry asks the server (POST /api/workspace), which validates it
 * against the person's own access; the browser's choice is a request, never
 * state (§14, §15). On success the whole page is loaded again behind a
 * "switching" cover: no dashboard, sidebar or list of the old workspace — and
 * no client cache — survives to sit under the new header (§29, §93). A failure
 * keeps the previous workspace and says so (§89).
 *
 * Keyboard: the search field owns focus (a combobox over a listbox), the arrow
 * keys move, Enter chooses, Escape closes (§52). On a phone it is a bottom
 * sheet, on a desktop a panel under the button (§53).
 */
export function WorkspaceSwitcher({ workspaces }: { workspaces: WorkspacesDTO }) {
  const t = useTranslations("workspace");
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [switchingTo, setSwitchingTo] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

  const { parentGroup, active: current } = workspaces;
  const inGroup = current.scopeType === "GROUP";
  const currentCompany = workspaces.companies.find((company) => company.id === current.companyId)
    ?? workspaces.otherGroups.flatMap((group) => group.companies).find((company) => company.id === current.companyId);
  const currentName = inGroup ? parentGroup.name : (currentCompany?.name ?? parentGroup.name);

  React.useEffect(() => {
    setSwitchingTo(null);
  }, [current.scopeType, current.companyId]);

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

  // Nothing to choose between: one company and no group to enter.
  const total = (parentGroup.groupViewAllowed ? 1 : 0) + workspaces.companies.length + workspaces.otherGroups.reduce((sum, group) => sum + group.companies.length, 0);
  if (total < 2) return null;

  const optionId = (option: Option) => `${listId}-${option.key}`;

  async function choose(option: Option) {
    if (switchingTo) return;
    if (option.isCurrent) {
      setOpen(false);
      return;
    }
    setSwitchingTo(option.name);
    const result = await requestWorkspaceSwitch({
      scopeType: option.scopeType,
      companyId: option.companyId,
      currentPathname: pathname,
      currentSearch: searchParams.size ? `?${searchParams.toString()}` : "",
    });
    if (!result.ok) {
      if (result.stale) return;
      setSwitchingTo(null);
      setOpen(false);
      toast({ title: t("switchFailed", { name: currentName }), tone: "danger" });
      return;
    }
    setOpen(false);
    const navigation = result.data.navigation;
    if (navigation.reason === "RECORD_NOT_AVAILABLE") {
      toast({ title: t("recordFallback", { name: option.name }) });
    } else if (navigation.resolution !== "KEEP_EXACT") {
      toast({ title: t("moduleFallback", { name: option.name }) });
    }

    const currentDestination = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
    if (navigation.destination === currentDestination) router.refresh();
    else router.replace(navigation.destination);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (options.length === 0) return;
    const last = options.length - 1;
    if (event.key === "ArrowDown") setActive((index) => (index >= last ? 0 : index + 1));
    else if (event.key === "ArrowUp") setActive((index) => (index <= 0 ? last : index - 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Enter") {
      const option = options[Math.min(active, last)];
      if (option) void choose(option);
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
          onClick={() => void choose(option)}
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
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setQuery("");
            setActive(0);
          }
        }}
      >
        <DialogTrigger
          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover data-[state=open]:bg-hover"
          aria-label={t("switcherLabel", { name: inGroup ? `${parentGroup.name} — ${t("groupWorkspaceName")}` : currentName })}
          data-testid="workspace-switcher"
          data-scope={current.scopeType}
          disabled={Boolean(switchingTo)}
        >
          {inGroup ? (
            <Layers aria-hidden="true" className="size-4 shrink-0 text-accent-strong" />
          ) : (
            <Building2 aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
          )}
          <span className="hidden min-w-0 flex-col leading-tight xl:flex">
            <span className="max-w-[11rem] truncate text-micro text-fg-subtle">{parentGroup.name}</span>
            <span className="max-w-[11rem] truncate text-table font-medium text-fg" data-testid="workspace-label">
              {inGroup ? t("groupWorkspaceName") : currentName}
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
        </DialogTrigger>

        <DialogContent
          data-testid="workspace-panel"
          className={cn(
            "flex max-h-[80dvh] flex-col gap-3 p-4",
            // A panel under the button on a desktop (§53)…
            "sm:left-auto sm:right-6 sm:top-16 sm:w-[22rem] sm:max-w-none sm:translate-x-0 sm:translate-y-0",
            // …and a bottom sheet, full width, on a phone.
            "max-sm:inset-x-0 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl",
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
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
                  onClick={() => void choose(groupOption)}
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
        </DialogContent>
      </Dialog>

      {/* Over everything while the next workspace loads, so nothing of this one
          can be read or clicked under the new header (§29). In a portal: the
          top bar's own blur would otherwise contain it. */}
      {switchingTo && typeof document !== "undefined"
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              data-testid="workspace-switching"
              className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-canvas/95 backdrop-blur-sm"
            >
              <Loader2 aria-hidden="true" className="size-6 animate-spin text-accent-strong" />
              <p className="text-body font-medium text-fg">{t("switching", { name: switchingTo })}</p>
              <div aria-hidden="true" className="w-64 space-y-2">
                <div className="h-3 animate-pulse rounded bg-surface-muted" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-surface-muted" />
                <div className="h-3 w-3/5 animate-pulse rounded bg-surface-muted" />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
