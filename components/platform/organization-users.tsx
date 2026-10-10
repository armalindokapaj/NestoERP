"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi, failureMessage, isFailure } from "@/components/engineering/engineering-api";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { FormSelect } from "@/components/ui/form-select";

type Option = { value: string; label: string };
type ProjectOption = Option & { companyId: string };
type Account = { id: string; name: string; username: string; email: string | null };
type Added = { userId: string; membershipId: string; username: string; temporaryPassword?: string };

const field = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

async function command<T>(body: Record<string, unknown>) {
  return engineeringApi<T>("/api/platform-admin/command", { body });
}

function ProjectPicker({ projects, value, onChange }: { projects: ProjectOption[]; value: string[]; onChange: (next: string[]) => void }) {
  const t = useTranslations("adminOrgs");
  if (projects.length === 0) return <p className="text-meta text-fg-subtle">{t("users.noOpenProjects")}</p>;
  return (
    <fieldset className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
      <legend className="sr-only">{t("users.projectsLegend")}</legend>
      {projects.map((project) => (
        <label key={project.value} className="flex items-center gap-2 text-table text-fg">
          <input type="checkbox" checked={value.includes(project.value)} onChange={(event) => onChange(event.target.checked ? [...value, project.value] : value.filter((id) => id !== project.value))} />
          {project.label}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Add User from inside an organization (Organization-Scoped PRD #7 §14-§18):
 * a new account or an existing one, the company already known. A new address
 * that already has an account is offered as that account instead.
 */
export function AddOrganizationUser({ organizationName, companies, roles, projects, label: labelProp }: { organizationName: string; companies: Option[]; roles: Option[]; projects: ProjectOption[]; label?: string }) {
  const t = useTranslations("adminOrgs");
  const label = labelProp ?? t("users.add.button");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"new" | "existing">("new");
  const [companyId, setCompanyId] = React.useState(companies.length === 1 ? companies[0].value : "");
  const [form, setForm] = React.useState({ firstName: "", lastName: "", email: "", roleKey: "" });
  const [projectIds, setProjectIds] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Account[]>([]);
  const [chosen, setChosen] = React.useState<Account | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [existingOffer, setExistingOffer] = React.useState<{ userId: string; name: string } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [created, setCreated] = React.useState<Added | null>(null);
  const target = companies.find((row) => row.value === companyId)?.label ?? organizationName;
  const companyProjects = projects.filter((project) => project.companyId === companyId);

  function reset() {
    setMode("new"); setForm({ firstName: "", lastName: "", email: "", roleKey: "" }); setProjectIds([]); setQuery(""); setResults([]); setChosen(null); setError(null); setExistingOffer(null);
    if (companies.length !== 1) setCompanyId("");
  }

  React.useEffect(() => {
    if (!open || mode !== "existing" || !companyId || chosen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      engineeringApi<Account[]>(`/api/platform-admin/organizations/${encodeURIComponent(companyId)}/eligible-users?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(setResults, (failure: unknown) => { if (!controller.signal.aborted) setError(failureMessage(failure)); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, mode, companyId, query, chosen]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setExistingOffer(null);
    if (!companyId) return setError(t("users.add.chooseCompany"));
    if (!form.roleKey) return setError(t("users.add.chooseRole"));
    if (mode === "existing" && !chosen) return setError(t("users.add.chooseAccount"));
    setPending(true);
    try {
      const body = mode === "new"
        ? { action: "organization.user.add", mode, companyId, roleKey: form.roleKey, projectIds, firstName: form.firstName, lastName: form.lastName, email: form.email }
        : { action: "organization.user.add", mode, companyId, roleKey: form.roleKey, projectIds, userId: chosen!.id };
      const result = await command<Added>(body);
      toast({ title: t("users.add.toast", { target }), tone: "success" });
      setOpen(false);
      reset();
      if (result.temporaryPassword) setCreated(result);
      router.refresh();
    } catch (failure) {
      if (isFailure(failure) && failure.details && typeof failure.details === "object" && (failure.details as { code?: string }).code === "ACCOUNT_EXISTS") {
        const details = failure.details as { userId: string; name: string };
        setExistingOffer({ userId: details.userId, name: details.name });
      }
      // Nothing was applied: the whole add is one transaction (§92-§94).
      setError(`${failureMessage(failure, t("users.add.failed", { target }))}${isFailure(failure) && failure.code !== "CONFLICT" ? ` ${t("users.add.noChanges")}` : ""}`);
    } finally {
      setPending(false);
    }
  }

  function useExisting() {
    if (!existingOffer) return;
    setMode("existing");
    setChosen({ id: existingOffer.userId, name: existingOffer.name, username: "", email: form.email });
    setExistingOffer(null);
    setError(null);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="org-add-user">{label}</Button>
      <Dialog open={open} locked={pending} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
        <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto" data-testid="org-add-user-dialog">
          <DialogTitle>{t("users.add.title", { target })}</DialogTitle>
          <DialogDescription>{t("users.add.description")}</DialogDescription>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <div role="radiogroup" aria-label={t("users.add.accountGroup")} className="flex flex-wrap gap-4 text-table">
              <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "new"} onChange={() => { setMode("new"); setChosen(null); }} />{t("users.add.createNew")}</label>
              <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "existing"} onChange={() => setMode("existing")} />{t("users.add.addExisting")}</label>
            </div>
            {companies.length > 1 ? (
              <label className="block space-y-1 text-meta text-fg-subtle">{t("users.add.company")}
                <FormSelect className={field} value={companyId} onChange={(event) => { setCompanyId(event.target.value); setProjectIds([]); setChosen(null); }} required>
                  <option value="">{t("users.add.chooseCompanyOption")}</option>
                  {companies.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
                </FormSelect>
              </label>
            ) : null}
            {mode === "new" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 text-meta text-fg-subtle">{t("users.add.firstName")}<input className={field} value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} required maxLength={80} /></label>
                <label className="block space-y-1 text-meta text-fg-subtle">{t("users.add.lastName")}<input className={field} value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} required maxLength={80} /></label>
                <label className="block space-y-1 text-meta text-fg-subtle sm:col-span-2">{t("users.add.email")}<input type="email" className={field} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required maxLength={200} /></label>
              </div>
            ) : chosen ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-line p-2.5 text-table">
                <span><span className="font-medium text-fg">{chosen.name}</span>{chosen.email ? <span className="block text-meta text-fg-subtle">{chosen.email}</span> : null}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setChosen(null)}>{t("users.add.change")}</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <input className={field} placeholder={t("users.add.searchPlaceholder")} aria-label={t("users.add.searchAria")} value={query} onChange={(event) => setQuery(event.target.value)} disabled={!companyId} />
                <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label={t("users.add.accountsAria")}>
                  {results.length === 0 ? <li className="p-2.5 text-meta text-fg-subtle">{companyId ? t("users.add.noEligible") : t("users.add.chooseCompanyFirst")}</li> : results.map((row) => (
                    <li key={row.id}><button type="button" className="w-full px-2.5 py-2 text-left text-table hover:bg-hover" onClick={() => setChosen(row)}><span className="font-medium text-fg">{row.name}</span><span className="block text-meta text-fg-subtle">{row.email ?? row.username}</span></button></li>
                  ))}
                </ul>
              </div>
            )}
            <label className="block space-y-1 text-meta text-fg-subtle">{t("users.add.role")}
              <FormSelect className={field} value={form.roleKey} onChange={(event) => setForm({ ...form, roleKey: event.target.value })} required>
                <option value="">{t("users.add.selectRole")}</option>
                {roles.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
              </FormSelect>
            </label>
            {companyId ? <div className="space-y-1"><p className="text-meta text-fg-subtle">{t("users.add.projectsOptional")}</p><ProjectPicker projects={companyProjects} value={projectIds} onChange={setProjectIds} /></div> : null}
            {error ? <p role="alert" className="text-table text-danger">{error}</p> : null}
            {existingOffer ? <Button type="button" size="sm" variant="secondary" onClick={useExisting}>{t("users.add.addExistingUser")}</Button> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={pending}>{t("users.add.cancel")}</Button>
              <Button type="submit" disabled={pending}>{mode === "new" ? t("users.add.createUser") : t("users.add.addUser")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={created !== null} onOpenChange={(next) => !next && setCreated(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t("users.add.createdTitle")}</DialogTitle>
          <DialogDescription>{t("users.add.createdDescription")}</DialogDescription>
          {created ? <dl className="mt-4 space-y-3"><div><dt className="text-meta text-fg-subtle">{t("users.add.username")}</dt><dd className="flex items-center gap-2 font-mono text-body">{created.username}<CopyButton value={created.username} label={t("users.add.copyUsername")} /></dd></div><div><dt className="text-meta text-fg-subtle">{t("users.add.temporaryPassword")}</dt><dd className="flex items-center gap-2 font-mono text-body">{created.temporaryPassword}<CopyButton value={created.temporaryPassword ?? ""} label={t("users.add.copyPassword")} /></dd></div></dl> : null}
          <DialogFooter><Button onClick={() => setCreated(null)}>{t("users.add.done")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Member = { id: string; name: string; roleKey: string; projectIds: string[]; active: boolean; /** The company CEO changes only through Change / Remove CEO (Admin PRD #12 §81). */ isCeo?: boolean };

/**
 * One membership's row menu (§19-§24): every action is this company's only.
 * Suspending the account is not here — it lives on the platform account (§22).
 */
export function OrganizationMemberActions({ companyId, companyName, member, roles, projects, detailHref, accountHref }: { companyId: string; companyName: string; member: Member; roles: Option[]; projects: ProjectOption[]; detailHref: string; accountHref: string }) {
  const t = useTranslations("adminOrgs");
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = React.useState<"role" | "projects" | "remove" | null>(null);
  const [roleKey, setRoleKey] = React.useState(member.roleKey);
  const [projectIds, setProjectIds] = React.useState(member.projectIds);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  function openDialog(next: "role" | "projects" | "remove") {
    setRoleKey(member.roleKey); setProjectIds(member.projectIds); setError(null); setDialog(next);
  }

  async function run(body: Record<string, unknown>, success: string) {
    setPending(true);
    setError(null);
    try {
      await command({ ...body, companyId, membershipId: member.id });
      toast({ title: success, tone: "success" });
      setDialog(null);
      router.refresh();
    } catch (failure) {
      setError(`${failureMessage(failure)} ${t("users.member.noChanges")}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="ghost" aria-label={t("users.member.actionsFor", { name: member.name })} data-testid="org-member-actions"><MoreHorizontal aria-hidden="true" className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild><Link href={detailHref}>{t("users.member.viewUser")}</Link></DropdownMenuItem>
          {member.active ? (
            <>
              {member.isCeo ? null : <DropdownMenuItem onSelect={() => openDialog("role")}>{t("users.member.changeRole")}</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => openDialog("projects")}>{t("users.member.manageProjects")}</DropdownMenuItem>
              {member.isCeo ? null : <DropdownMenuItem onSelect={() => openDialog("remove")} className="text-danger">{t("users.member.removeFromCompany")}</DropdownMenuItem>}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link href={accountHref}>{t("users.member.viewAccount")}</Link></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={dialog !== null} locked={pending} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent className="max-w-md">
          {dialog === "remove" ? (
            <>
              <DialogTitle>{t("users.member.removeTitle", { name: member.name, company: companyName })}</DialogTitle>
              <DialogDescription>{t("users.member.removeDescription", { name: member.name, company: companyName })}</DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle>{dialog === "role" ? t("users.member.roleTitle", { company: companyName }) : t("users.member.projectsTitle", { company: companyName })}</DialogTitle>
              <DialogDescription>{dialog === "role" ? t("users.member.roleDescription", { name: member.name }) : t("users.member.projectsDescription", { company: companyName })}</DialogDescription>
            </>
          )}
          <div className="mt-4 space-y-3">
            {dialog === "role" ? (
              <label className="block space-y-1 text-meta text-fg-subtle">{t("users.member.role")}
                <FormSelect className={field} value={roleKey} onChange={(event) => setRoleKey(event.target.value)}>
                  {roles.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
                </FormSelect>
              </label>
            ) : null}
            {dialog === "projects" ? <ProjectPicker projects={projects.filter((project) => project.companyId === companyId)} value={projectIds} onChange={setProjectIds} /> : null}
            {error ? <p role="alert" className="text-table text-danger">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)} disabled={pending}>{t("users.member.cancel")}</Button>
            {dialog === "role" ? <Button disabled={pending || roleKey === member.roleKey} onClick={() => run({ action: "organization.member.role", roleKey }, t("users.member.roleChanged"))}>{t("users.member.changeRole")}</Button> : null}
            {dialog === "projects" ? <Button disabled={pending} onClick={() => run({ action: "organization.member.projects", projectIds }, t("users.member.projectsUpdated"))}>{t("users.member.saveProjects")}</Button> : null}
            {dialog === "remove" ? <Button variant="danger" disabled={pending} onClick={() => run({ action: "organization.member.remove" }, t("users.member.removed", { company: companyName }))}>{t("users.member.removeAccess")}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
