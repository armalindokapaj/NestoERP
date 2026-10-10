"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi, failureMessage, isFailure } from "@/components/engineering/engineering-api";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { adminRoleName } from "@/components/platform/admin-roles";
import { CompanyUserDrawer, type CompanyUserOptions, type CompanyUsersApi } from "@/components/platform/company-user-drawer";
import { useGroupUserNav } from "@/components/platform/group-user-drawer";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import type { CompanyUserAdded, CompanyUserBulkResult, CompanyUserRow } from "@/lib/modules/platform/company-users.service";
import { FormSelect } from "@/components/ui/form-select";

const field = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export const PLATFORM_COMPANY_API: CompanyUsersApi = { command: "/api/platform-admin/command" };
export const GROUP_COMPANY_API: CompanyUsersApi = { command: "/api/group/command" };

type Candidate = { id: string; name: string; username: string; email: string | null; groupRole: string | null; viaGroup: boolean };

function useSourceLabel(groupName: string | null) {
  const t = useTranslations("adminOrgs");
  return (source: CompanyUserRow["source"]) => (source === "DIRECT" ? t("companyUsers.sourceDirect") : source === "BOTH" ? t("companyUsers.sourceBoth") : t("companyUsers.sourceGroup", { group: groupName ?? "" }));
}

/**
 * Add User (PRD #13 §18-§36): the company is fixed. A new account, or someone
 * already in this organization — people the group already gives access to come
 * first. A person already reaching the company through the group simply gains
 * a direct source on the same row.
 */
export function AddCompanyUserButton({ companyId, companyName, groupName, api, options }: { companyId: string; companyName: string; groupName: string | null; api: CompanyUsersApi; options: CompanyUserOptions }) {
  const t = useTranslations("adminOrgs");
  const tr = useTranslations("roles");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"new" | "existing">("new");
  const [form, setForm] = React.useState({ firstName: "", lastName: "", email: "", roleKey: "", departmentId: "", jobTitle: "" });
  const [projectIds, setProjectIds] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Candidate[]>([]);
  const [chosen, setChosen] = React.useState<Candidate | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [offer, setOffer] = React.useState<{ userId: string; name: string } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [created, setCreated] = React.useState<CompanyUserAdded | null>(null);

  function reset() {
    setMode("new"); setForm({ firstName: "", lastName: "", email: "", roleKey: "", departmentId: "", jobTitle: "" }); setProjectIds([]); setQuery(""); setResults([]); setChosen(null); setError(null); setOffer(null);
  }

  React.useEffect(() => {
    if (!open || mode !== "existing" || chosen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      engineeringApi<Candidate[]>(api.command, { body: { action: "company.users.candidates", companyId, q: query }, signal: controller.signal })
        .then(setResults, (failure: unknown) => { if (!controller.signal.aborted) setError(failureMessage(failure)); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, mode, chosen, query, api.command, companyId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null); setOffer(null);
    if (!form.roleKey) return setError(t("companyUsers.chooseRole"));
    if (mode === "existing" && !chosen) return setError(t("companyUsers.chooseAccount"));
    setPending(true);
    const shared = { action: "company.users.add", companyId, roleKey: form.roleKey, departmentId: form.departmentId || null, jobTitle: form.jobTitle.trim() || undefined, projectIds };
    try {
      const result = await engineeringApi<CompanyUserAdded>(api.command, { body: mode === "new" ? { ...shared, mode, firstName: form.firstName, lastName: form.lastName, email: form.email } : { ...shared, mode, userId: chosen!.id } });
      toast({ title: t("companyUsers.added", { company: companyName }), tone: "success" });
      setOpen(false);
      reset();
      if (result.temporaryPassword) setCreated(result);
      router.refresh();
    } catch (failure) {
      const details = isFailure(failure) ? (failure.details as { code?: string; userId?: string; name?: string } | undefined) : undefined;
      if (details?.code === "ACCOUNT_EXISTS" && details.userId && details.name) setOffer({ userId: details.userId, name: details.name });
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="company-add-user">{t("companyUsers.add")}</Button>
      <Dialog open={open} locked={pending} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
        <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto" data-testid="company-add-user-dialog">
          <DialogTitle>{t("companyUsers.addTitle", { company: companyName })}</DialogTitle>
          <DialogDescription>{t("companyUsers.addDescription")}</DialogDescription>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <div role="radiogroup" aria-label={t("companyUsers.addTitle", { company: companyName })} className="flex flex-wrap gap-4 text-table">
              <label className="flex items-center gap-2"><input type="radio" name="cu-mode" checked={mode === "new"} onChange={() => { setMode("new"); setChosen(null); }} />{t("companyUsers.createNew")}</label>
              <label className="flex items-center gap-2"><input type="radio" name="cu-mode" checked={mode === "existing"} onChange={() => setMode("existing")} />{t("companyUsers.selectExisting")}</label>
            </div>
            {mode === "new" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 text-meta text-fg-subtle">{t("companyUsers.firstName")}<input className={field} value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} required maxLength={80} /></label>
                <label className="block space-y-1 text-meta text-fg-subtle">{t("companyUsers.lastName")}<input className={field} value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} required maxLength={80} /></label>
                <label className="block space-y-1 text-meta text-fg-subtle sm:col-span-2">{t("companyUsers.email")}<input type="email" className={field} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required maxLength={200} /></label>
              </div>
            ) : chosen ? (
              <div className="space-y-1 rounded-lg border border-line p-2.5 text-table">
                <div className="flex items-center justify-between gap-2">
                  <span><span className="font-medium text-fg">{chosen.name}</span><span className="block text-meta text-fg-subtle">{chosen.email ?? chosen.username}</span></span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setChosen(null)}>{t("users.add.change")}</Button>
                </div>
                {chosen.viaGroup && chosen.groupRole ? <p className="text-meta text-fg-muted">{t("companyUsers.viaGroupNow", { role: adminRoleName(tr, chosen.groupRole) })}</p> : null}
                {form.roleKey ? <p className="text-meta text-fg-muted">{t("companyUsers.willAdd", { company: companyName, role: adminRoleName(tr, options.roles.find((row) => row.key === form.roleKey)?.name ?? form.roleKey) })}</p> : null}
              </div>
            ) : (
              <div className="space-y-2">
                <input className={field} placeholder={t("companyUsers.searchExisting")} aria-label={t("companyUsers.searchExistingAria")} value={query} onChange={(event) => setQuery(event.target.value)} />
                <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label={t("companyUsers.searchExistingAria")}>
                  {results.length === 0 ? <li className="p-2.5 text-meta text-fg-subtle">{t("companyUsers.noCandidates")}</li> : results.map((row) => (
                    <li key={row.id}>
                      <button type="button" className="w-full px-2.5 py-2 text-left text-table hover:bg-hover" onClick={() => setChosen(row)}>
                        <span className="font-medium text-fg">{row.name}</span>
                        <span className="block text-meta text-fg-subtle">{row.groupRole ? `${adminRoleName(tr, row.groupRole)}${groupName ? ` · ${groupName}` : ""}` : t("companyUsers.existingAccount")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label className="block space-y-1 text-meta text-fg-subtle">{t("companyUsers.companyRole")}
              <FormSelect className={field} value={form.roleKey} onChange={(event) => setForm({ ...form, roleKey: event.target.value })} required>
                <option value="">{t("companyUsers.selectRole")}</option>
                {options.roles.map((row) => <option key={row.key} value={row.key}>{adminRoleName(tr, row.name)}</option>)}
              </FormSelect>
              <span className="block text-meta text-fg-muted">{t("companyUsers.ceoNote")}</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-meta text-fg-subtle">{t("companyUsers.departmentOptional")}
                <FormSelect className={field} value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })}>
                  <option value="">{t("companyUsers.noDepartment")}</option>
                  {options.departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </FormSelect>
              </label>
              <label className="block space-y-1 text-meta text-fg-subtle">{t("companyUsers.position")}<input className={field} value={form.jobTitle} maxLength={120} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })} /></label>
            </div>
            <fieldset className="space-y-1">
              <legend className="text-meta text-fg-subtle">{t("companyUsers.projectsOptional")}</legend>
              {options.projects.length === 0 ? <p className="text-meta text-fg-subtle">{t("companyUsers.noProjects")}</p> : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                  {options.projects.map((project) => (
                    <label key={project.id} className="flex items-center gap-2 text-table text-fg">
                      <input type="checkbox" checked={projectIds.includes(project.id)} onChange={(event) => setProjectIds(event.target.checked ? [...projectIds, project.id] : projectIds.filter((id) => id !== project.id))} />
                      {project.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            {error ? <p role="alert" className="text-table text-danger">{error}</p> : null}
            {offer ? <Button type="button" size="sm" variant="secondary" onClick={() => { setMode("existing"); setChosen({ id: offer.userId, name: offer.name, username: "", email: form.email, groupRole: null, viaGroup: false }); setOffer(null); setError(null); }}>{t("companyUsers.useExisting")}</Button> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={pending}>{t("companyUsers.cancel")}</Button>
              <Button type="submit" disabled={pending}>{mode === "new" ? t("companyUsers.createUser") : t("companyUsers.addUser")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={created !== null} onOpenChange={(next) => !next && setCreated(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t("companyUsers.createdTitle")}</DialogTitle>
          <DialogDescription>{t("companyUsers.createdDescription")}</DialogDescription>
          {created ? (
            <dl className="mt-4 space-y-3">
              <div><dt className="text-meta text-fg-subtle">{t("companyUsers.username")}</dt><dd className="flex items-center gap-2 font-mono text-body">{created.username}<CopyButton value={created.username} label={t("users.add.copyUsername")} /></dd></div>
              <div><dt className="text-meta text-fg-subtle">{t("companyUsers.temporaryPassword")}</dt><dd className="flex items-center gap-2 font-mono text-body">{created.temporaryPassword}<CopyButton value={created.temporaryPassword ?? ""} label={t("users.add.copyPassword")} /></dd></div>
            </dl>
          ) : null}
          <DialogFooter><Button onClick={() => setCreated(null)}>{t("companyUsers.done")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type ListState = { rows: CompanyUserRow[]; next: string | null };

/**
 * The company's effective users (PRD #13 §9-§16, §82-§90): one row per
 * person, the access source from the server's resolver, selection with
 * permission-aware bulk actions, and more rows fetched from the server rather
 * than the whole directory downloaded. The first page, the filters and the
 * count come from the page itself, so a refresh or a shared link shows the same.
 */
export function CompanyUsersTable({ companyId, companyName, groupName, api, initial, total, query, options, canManage, platform = true, leadershipHref }: {
  companyId: string; companyName: string; groupName: string | null; api: CompanyUsersApi;
  initial: ListState; total: number; query: Record<string, string>; options: CompanyUserOptions; canManage: boolean; platform?: boolean; leadershipHref?: string;
}) {
  const t = useTranslations("adminOrgs");
  const tr = useTranslations("roles");
  const router = useRouter();
  const toast = useToast();
  const nav = useGroupUserNav();
  const sourceLabel = useSourceLabel(groupName);
  const [state, setState] = React.useState<ListState>(initial);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [moreError, setMoreError] = React.useState<string | null>(null);
  const [bulk, setBulk] = React.useState<{ type: "department" | "project" | "suspend"; value: string } | null>(null);
  const [bulkPending, setBulkPending] = React.useState(false);

  // A refresh brings a new first page: start from it.
  React.useEffect(() => { setState(initial); setSelected(new Set()); }, [initial]);

  async function showMore() {
    if (!state.next || loadingMore) return;
    setLoadingMore(true); setMoreError(null);
    try {
      const page = await engineeringApi<{ rows: CompanyUserRow[]; nextCursor: string | null }>(api.command, { body: { action: "company.users.list", companyId, ...query, cursor: state.next } });
      setState({ rows: [...state.rows, ...page.rows], next: page.nextCursor });
    } catch (failure) {
      setMoreError(failureMessage(failure, t("companyUsers.loadError")));
    } finally {
      setLoadingMore(false);
    }
  }

  const rows = state.rows;
  const changeable = (row: CompanyUserRow) => row.source !== "GROUP";
  const selectedRows = rows.filter((row) => selected.has(row.userId));
  const groupOnlySelected = selectedRows.filter((row) => !changeable(row)).length;
  const toggle = (userId: string, on: boolean) => setSelected((current) => { const next = new Set(current); if (on) next.add(userId); else next.delete(userId); return next; });

  async function runBulk() {
    if (!bulk || bulkPending || selectedRows.length === 0) return;
    const operation = bulk.type === "department" ? { type: "department", departmentId: bulk.value } : bulk.type === "project" ? { type: "project", projectId: bulk.value } : { type: "suspend" };
    if (bulk.type !== "suspend" && !bulk.value) return;
    setBulkPending(true);
    try {
      const result = await engineeringApi<CompanyUserBulkResult>(api.command, { body: { action: "company.users.bulk", companyId, userIds: selectedRows.filter(changeable).map((row) => row.userId), operation } });
      toast({ title: t("companyUsers.bulkResult", { done: result.done.length, skipped: result.skipped.length + groupOnlySelected }), tone: result.skipped.length ? "danger" : "success" });
      setBulk(null); setSelected(new Set());
      router.refresh();
    } catch (failure) {
      toast({ title: failureMessage(failure, t("companyUsers.bulkFailed")), tone: "danger" });
    } finally {
      setBulkPending(false);
    }
  }

  const allOn = rows.length > 0 && rows.every((row) => selected.has(row.userId));

  return (
    <div data-testid="company-users">
      {canManage && selected.size > 0 ? (
        <div className="space-y-2 border-b border-line bg-hover px-5 py-3" role="region" aria-label={t("companyUsers.selected", { count: selected.size })} data-testid="company-bulk-bar">
          <div className="flex flex-wrap items-center gap-2 text-table">
            <span className="font-medium text-fg" aria-live="polite">{t("companyUsers.selected", { count: selected.size })}</span>
            <Button size="sm" variant="secondary" onClick={() => setBulk({ type: "department", value: "" })}>{t("companyUsers.bulkDepartment")}</Button>
            <Button size="sm" variant="secondary" onClick={() => setBulk({ type: "project", value: "" })}>{t("companyUsers.bulkProject")}</Button>
            <Button size="sm" variant="secondary" onClick={() => setBulk({ type: "suspend", value: "" })}>{t("companyUsers.bulkSuspend")}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setSelected(new Set()); setBulk(null); }}>{t("companyUsers.bulkCancel")}</Button>
          </div>
          {groupOnlySelected > 0 ? <p className="text-meta text-fg-muted" role="status">{t("companyUsers.bulkSkippedGroup", { count: groupOnlySelected, group: groupName ?? "" })}</p> : null}
          {bulk ? (
            <div className="flex flex-wrap items-center gap-2">
              {bulk.type === "department" ? (
                <FormSelect className={`${field} max-w-60`} aria-label={t("companyUsers.bulkDepartment")} value={bulk.value} onChange={(event) => setBulk({ ...bulk, value: event.target.value })}>
                  <option value="">{t("companyUsers.bulkChoose")}</option>
                  {options.departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </FormSelect>
              ) : null}
              {bulk.type === "project" ? (
                <FormSelect className={`${field} max-w-60`} aria-label={t("companyUsers.bulkProject")} value={bulk.value} onChange={(event) => setBulk({ ...bulk, value: event.target.value })}>
                  <option value="">{t("companyUsers.bulkChoose")}</option>
                  {options.projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </FormSelect>
              ) : null}
              <Button size="sm" disabled={bulkPending || (bulk.type !== "suspend" && !bulk.value)} onClick={() => void runBulk()}>{t("companyUsers.bulkApply")}</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="relative overflow-x-auto">
        <table className="w-full text-table" aria-label={t("companyUsers.title")}>
          <thead>
            <tr className="border-b border-line text-left text-meta font-medium text-fg-subtle">
              {canManage ? <th scope="col" className="w-10 px-3 py-2"><input type="checkbox" aria-label={t("companyUsers.selectAll")} checked={allOn} onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.userId)) : new Set())} /></th> : null}
              <th scope="col" className="px-3 py-2">{t("companyUsers.user")}</th>
              <th scope="col" className="px-3 py-2">{t("companyUsers.role")}</th>
              <th scope="col" className="px-3 py-2 max-md:hidden">{t("companyUsers.department")}</th>
              <th scope="col" className="px-3 py-2">{t("companyUsers.access")}</th>
              <th scope="col" className="px-3 py-2 text-right max-md:hidden">{t("companyUsers.projects")}</th>
              <th scope="col" className="px-3 py-2">{t("companyUsers.status")}</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">{t("common.actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.membershipId} className="border-b border-line last:border-0" data-testid="company-user" data-source={row.source}>
                {canManage ? <td className="px-3 py-2"><input type="checkbox" aria-label={t("companyUsers.selectRow", { name: row.name })} checked={selected.has(row.userId)} onChange={(event) => toggle(row.userId, event.target.checked)} /></td> : null}
                <td className="px-3 py-2">
                  <button type="button" data-company-user={row.userId} aria-label={t("companyUsers.open", { name: row.name })} onClick={() => nav.open(row.userId)} className="text-left font-medium text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">{row.name}</button>
                  <p className="font-mono text-micro text-fg-subtle">{row.email ?? row.username}</p>
                </td>
                <td className="px-3 py-2">
                  {adminRoleName(tr, row.directRole ?? row.groupRole)}
                  {row.isCeo ? <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-micro font-medium text-fg-muted" data-testid="ceo-badge">{t("companyUsers.ceoBadge")}</span> : null}
                  {row.source === "BOTH" && row.groupRole ? <span className="block text-meta text-fg-subtle">+ {adminRoleName(tr, row.groupRole)}</span> : null}
                  {row.jobTitle ? <span className="block text-meta text-fg-subtle">{row.jobTitle}</span> : null}
                </td>
                <td className="px-3 py-2 max-md:hidden">{row.department?.name ?? "—"}</td>
                <td className="px-3 py-2" data-testid="company-user-source-cell">{sourceLabel(row.source)}</td>
                <td className="px-3 py-2 text-right tabular-nums max-md:hidden">{row.projects}</td>
                <td className="px-3 py-2"><AdminStatusBadge status={row.accountStatus !== "ACTIVE" ? row.accountStatus : row.membershipStatus} /></td>
                <td className="px-3 py-2 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost" aria-label={t("companyUsers.actionsFor", { name: row.name })} data-testid="company-user-actions"><MoreHorizontal aria-hidden="true" className="size-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => nav.open(row.userId)}>{t("companyUsers.menuView")}</DropdownMenuItem>
                      {canManage && row.source !== "GROUP" ? <DropdownMenuItem onSelect={() => nav.open(row.userId)}>{t("companyUsers.menuEdit")}</DropdownMenuItem> : null}
                      {row.isCeo && leadershipHref ? <DropdownMenuItem asChild><Link href={leadershipHref}>{t("companyUsers.menuChangeCeo")}</Link></DropdownMenuItem> : null}
                      {row.source === "GROUP" ? <DropdownMenuItem disabled>{t("companyUsers.groupManaged", { group: groupName ?? "" })}</DropdownMenuItem> : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-meta text-fg-subtle">
        <span aria-live="polite">{t("companyUsers.showing", { shown: rows.length, total })}</span>
        {state.next ? <Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => void showMore()}>{t("companyUsers.showMore")}</Button> : null}
      </div>
      {moreError ? <p role="alert" className="px-5 pb-3 text-table text-danger">{moreError}</p> : null}

      <CompanyUserDrawer companyId={companyId} companyName={companyName} groupName={groupName} api={api} options={options} platform={platform} leadershipHref={leadershipHref} />
    </div>
  );
}
